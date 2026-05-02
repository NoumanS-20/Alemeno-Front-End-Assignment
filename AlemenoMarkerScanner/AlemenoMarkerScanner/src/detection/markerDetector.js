/**
 * Marker Detector — Core Algorithm
 * ============================================================
 * Detects "Marker 1" (140x140 square frame with a 20x20 anchor
 * square in the top-left of the inner white area) inside a
 * camera frame and returns a tightly-cropped, orientation-
 * corrected 300x300 image.
 *
 * Pipeline:
 *   1. Convert frame → grayscale
 *   2. Adaptive threshold (handles uneven lighting much better
 *      than Otsu for live camera feeds)
 *   3. Find external contours
 *   4. For each contour: approx polygon → must have 4 vertices
 *      and be convex → must be "square enough"
 *   5. Order the 4 corners (TL, TR, BR, BL) and warp the patch
 *      to a normalized N×N image
 *   6. Validate the warped patch against the marker template:
 *        • outer black frame is present and roughly the right
 *          thickness
 *        • inside the inner area there is exactly ONE small
 *          black square
 *        • that small square is the right SIZE
 *        • that small square sits in a CORNER region, not
 *          the center
 *   7. If the anchor isn't in the canonical (top-left) corner,
 *      rotate the patch 90/180/270° so it is. This gives us
 *      the orientation correction the assignment asks for.
 *   8. Return the final 300×300 patch.
 *
 * This module is designed to run inside a vision-camera frame
 * processor worklet, so all OpenCV calls go through
 * `react-native-fast-opencv`'s synchronous worklet API.
 *
 * NOTE: All `OpenCV.invoke(...)` calls are synchronous and
 * worklet-safe. The OpenCV instance is passed in so this file
 * stays testable.
 */

import {
  MARKER_OUTPUT_SIZE,
  CORNER_ZONE_RATIO,
  MIN_MARKER_PIXEL_SIZE,
  SQUARENESS_TOLERANCE,
  POLY_APPROX_EPSILON,
} from './markerGeometry';

/**
 * Order four corner points into [TL, TR, BR, BL].
 * Standard trick: TL has the smallest (x+y), BR the largest;
 * TR has the smallest (y-x), BL the largest.
 */
export function orderCorners(pts) {
  'worklet';
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minSum = Infinity, maxSum = -Infinity;
  let minDiff = Infinity, maxDiff = -Infinity;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const s = p.x + p.y;
    const d = p.y - p.x;
    if (s < minSum) { minSum = s; tl = p; }
    if (s > maxSum) { maxSum = s; br = p; }
    if (d < minDiff) { minDiff = d; tr = p; }
    if (d > maxDiff) { maxDiff = d; bl = p; }
  }
  return [tl, tr, br, bl];
}

/**
 * Decide whether a 4-vertex polygon is "square enough" — its
 * sides should all be roughly equal and its angles ~90°.
 * Returns the average side length if it qualifies, otherwise null.
 */
export function checkSquareness(corners) {
  'worklet';
  // Side lengths
  const dx0 = corners[1].x - corners[0].x;
  const dy0 = corners[1].y - corners[0].y;
  const dx1 = corners[2].x - corners[1].x;
  const dy1 = corners[2].y - corners[1].y;
  const dx2 = corners[3].x - corners[2].x;
  const dy2 = corners[3].y - corners[2].y;
  const dx3 = corners[0].x - corners[3].x;
  const dy3 = corners[0].y - corners[3].y;

  const s0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
  const s1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const s2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
  const s3 = Math.sqrt(dx3 * dx3 + dy3 * dy3);

  const longest = Math.max(s0, s1, s2, s3);
  const shortest = Math.min(s0, s1, s2, s3);

  if (shortest < MIN_MARKER_PIXEL_SIZE) {
    return null;
  }
  if (longest / shortest > SQUARENESS_TOLERANCE) {
    return null;
  }
  return (s0 + s1 + s2 + s3) / 4;
}

/**
 * After warping the marker into a normalized N×N image, validate
 * that it actually matches the Marker 1 template, identify which
 * corner the anchor square is in, and return a "score" that
 * higher = better match.
 *
 * Returns null if this is NOT a valid Marker 1.
 *
 * Otherwise returns: { rotationSteps, score }
 *   rotationSteps: how many 90° CW rotations to apply to bring
 *                  the anchor into the canonical top-left position
 *                  (0, 1, 2, or 3).
 */
export function validateAndIdentifyOrientation(OpenCV, warpedGray, N) {
  'worklet';

  // --- Step 1: Threshold to binary. After THRESH_BINARY_INV,
  // ink (originally black) is now white(255), background is 0.
  const binary = OpenCV.createObject('Mat', N, N, 'CV_8UC1');
  OpenCV.invoke('threshold', warpedGray, binary, 128, 255, 'THRESH_BINARY_INV');

  // --- Step 2: Outer black frame must exist (border ring is ink).
  const borderInkRatio = sampleBorderInkRatio(OpenCV, binary, N);
  if (borderInkRatio < 0.75) {
    return null;
  }

  // --- Step 3: Center sanity check — only used to reject a fully
  // filled solid black square (where the center ratio approaches 1).
  // The marker is allowed to contain decorative content (the spec
  // explicitly says info can be encoded inside), so we use a loose
  // threshold here.
  const centerInkRatio = sampleCenterInkRatio(OpenCV, binary, N);
  if (centerInkRatio > 0.70) {
    return null;
  }

  // --- Step 4: Search the WHOLE warped image for the anchor square.
  // We deliberately don't crop "the inner area" because the warped
  // marker's frame creates artifact contours at the inner-frame
  // boundary; instead we look at every contour in the image and
  // filter to the one (or zero) that looks like an anchor.
  const allContours = OpenCV.createObject('MatVector');
  OpenCV.invoke(
    'findContours',
    binary,
    allContours,
    'RETR_LIST',
    'CHAIN_APPROX_SIMPLE',
  );

  const total = OpenCV.toJSValue(allContours).array.length;

  const SIZE_MIN = 0.09;       // 9% of N — about 27 px on 300
  const SIZE_MAX = 0.20;       // 20% of N — about 60 px on 300
  const CORNER_ZONE = N * CORNER_ZONE_RATIO;
  const FRAME_CLEAR = N * 0.03;

  // Track the single valid anchor and any "disqualifying" filled
  // squares (wrong size or wrong position) — both indicate this
  // is NOT a correct marker.
  const anchorCandidates = [];
  let disqualifyingBlobs = 0;

  // Reusable scratch Mat for density measurement.
  for (let i = 0; i < total; i++) {
    const c = OpenCV.copyObjectFromVector(allContours, i);
    const rect = OpenCV.invoke('boundingRect', c);
    const rJS = OpenCV.toJSValue(rect);
    const x = rJS.x, y = rJS.y, w = rJS.width, h = rJS.height;
    const side = (w + h) / 2;

    if (side < N * 0.04) continue;     // tiny noise speck
    if (w > N * 0.80 && h > N * 0.80) continue; // outer frame itself

    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    const rs = side / N;

    // Density: how solid is this contour? An anchor is fully filled
    // (density ≈ 1.0); illustrations are line-art outlines (density
    // ≈ 0.3 or less). We compute density by drawing the filled
    // contour onto a mask and measuring its bbox coverage.
    const mask = OpenCV.createObject('Mat', N, N, 'CV_8UC1');
    OpenCV.invoke('drawContours', mask, allContours, i, 255, -1);
    const submask = OpenCV.invoke(
      'crop',
      mask,
      OpenCV.createObject('Rect', x, y, w, h),
    );
    const meanRes = OpenCV.toJSValue(OpenCV.invoke('mean', submask));
    // mean returns 0..255 across the bbox; ratio is mean/255.
    const density = (meanRes.a !== undefined ? meanRes.a : meanRes.b) / 255;

    // Only solid + square contours qualify as anchor candidates
    // (or disqualifiers). Decorative content (non-square or hollow)
    // is ignored.
    const looksLikeAnchor = density >= 0.85 && aspect <= 1.25;
    if (!looksLikeAnchor) continue;

    // Now bucket: too-big square → wrong marker (#6, #7);
    // tiny → noise; in valid range → check position.
    if (rs > SIZE_MAX) {
      disqualifyingBlobs += 1;
      continue;
    }
    if (rs < SIZE_MIN) continue;

    const cx = x + w / 2;
    const cy = y + h / 2;
    const inLeft = cx < CORNER_ZONE;
    const inRight = cx > N - CORNER_ZONE;
    const inTop = cy < CORNER_ZONE;
    const inBottom = cy > N - CORNER_ZONE;

    if (!((inLeft || inRight) && (inTop || inBottom))) {
      // Anchor is centered or on an edge midpoint (#5)
      disqualifyingBlobs += 1;
      continue;
    }

    if (
      x < FRAME_CLEAR ||
      y < FRAME_CLEAR ||
      x + w > N - FRAME_CLEAR ||
      y + h > N - FRAME_CLEAR
    ) {
      // Anchor touches the outer frame (#4)
      disqualifyingBlobs += 1;
      continue;
    }

    anchorCandidates.push({ cx, cy, side, inTop, inBottom, inLeft, inRight });
  }

  // Must have exactly one valid anchor and zero disqualifying blobs.
  if (anchorCandidates.length !== 1 || disqualifyingBlobs > 0) {
    return null;
  }

  const a = anchorCandidates[0];
  let rotationSteps;
  if (a.inTop && a.inLeft)         rotationSteps = 0;
  else if (a.inTop && a.inRight)   rotationSteps = 1;
  else if (a.inBottom && a.inRight) rotationSteps = 2;
  else /* bottom-left */           rotationSteps = 3;

  // Score: higher when the anchor size is closer to the spec
  // (20/140 ≈ 0.143).
  const sizeDelta = Math.abs(a.side / N - 20 / 140);
  const score = 1 - sizeDelta * 4;

  return { rotationSteps, score };
}

/**
 * Helper: average ink ratio along a thin border ring of a binary
 * image. Used to confirm the outer black frame exists.
 */
function sampleBorderInkRatio(OpenCV, binary, N) {
  'worklet';
  const ringW = Math.max(2, Math.round(N * 0.05));

  const top    = OpenCV.invoke('crop', binary, OpenCV.createObject('Rect', 0, 0, N, ringW));
  const bottom = OpenCV.invoke('crop', binary, OpenCV.createObject('Rect', 0, N - ringW, N, ringW));
  const left   = OpenCV.invoke('crop', binary, OpenCV.createObject('Rect', 0, ringW, ringW, N - 2 * ringW));
  const right  = OpenCV.invoke('crop', binary, OpenCV.createObject('Rect', N - ringW, ringW, ringW, N - 2 * ringW));

  const tMean = OpenCV.toJSValue(OpenCV.invoke('mean', top)).a    || OpenCV.toJSValue(OpenCV.invoke('mean', top)).b;
  const bMean = OpenCV.toJSValue(OpenCV.invoke('mean', bottom)).a || OpenCV.toJSValue(OpenCV.invoke('mean', bottom)).b;
  const lMean = OpenCV.toJSValue(OpenCV.invoke('mean', left)).a   || OpenCV.toJSValue(OpenCV.invoke('mean', left)).b;
  const rMean = OpenCV.toJSValue(OpenCV.invoke('mean', right)).a  || OpenCV.toJSValue(OpenCV.invoke('mean', right)).b;

  // Mean is 0..255 in INV-thresholded binary — divide by 255 for ratio.
  return ((tMean + bMean + lMean + rMean) / 4) / 255;
}

function sampleCenterInkRatio(OpenCV, binary, N) {
  'worklet';
  const m = Math.round(N * 0.25);
  const center = OpenCV.invoke('crop', binary, OpenCV.createObject('Rect', m, m, N - 2 * m, N - 2 * m));
  const meanV = OpenCV.toJSValue(OpenCV.invoke('mean', center)).a;
  return meanV / 255;
}

/**
 * Apply N 90° clockwise rotations to a Mat.
 * 0 → unchanged, 1 → 90° CW, 2 → 180°, 3 → 270° CW.
 */
export function rotateMat(OpenCV, mat, steps, N) {
  'worklet';
  let s = ((steps % 4) + 4) % 4;
  if (s === 0) return mat;

  const dst = OpenCV.createObject('Mat', N, N, 'CV_8UC3');
  if (s === 1) {
    OpenCV.invoke('rotate', mat, dst, 'ROTATE_90_CLOCKWISE');
  } else if (s === 2) {
    OpenCV.invoke('rotate', mat, dst, 'ROTATE_180');
  } else {
    OpenCV.invoke('rotate', mat, dst, 'ROTATE_90_COUNTERCLOCKWISE');
  }
  return dst;
}

/**
 * Top-level entry point: detect a Marker 1 in `frame` (BGR Mat)
 * and return a base64-encoded 300x300 PNG of the corrected
 * marker, or null if no marker is found.
 */
export function detectMarker(OpenCV, frameMat) {
  'worklet';
  const N = MARKER_OUTPUT_SIZE;

  // 1. Grayscale
  const gray = OpenCV.createObject(
    'Mat', frameMat.rows, frameMat.cols, 'CV_8UC1',
  );
  OpenCV.invoke('cvtColor', frameMat, gray, 'COLOR_BGR2GRAY');

  // 2. Light blur to reduce sensor noise
  const blurred = OpenCV.createObject(
    'Mat', frameMat.rows, frameMat.cols, 'CV_8UC1',
  );
  OpenCV.invoke(
    'GaussianBlur',
    gray,
    blurred,
    OpenCV.createObject('Size', 5, 5),
    0,
  );

  // 3. Adaptive threshold — works far better than Otsu under
  // varied real-world lighting on a phone.
  const bin = OpenCV.createObject(
    'Mat', frameMat.rows, frameMat.cols, 'CV_8UC1',
  );
  OpenCV.invoke(
    'adaptiveThreshold',
    blurred,
    bin,
    255,
    'ADAPTIVE_THRESH_GAUSSIAN_C',
    'THRESH_BINARY_INV',
    21,
    10,
  );

  // 4. Find contours
  const contours = OpenCV.createObject('MatVector');
  OpenCV.invoke(
    'findContours',
    bin,
    contours,
    'RETR_EXTERNAL',
    'CHAIN_APPROX_SIMPLE',
  );

  const count = OpenCV.toJSValue(contours).array.length;
  if (count === 0) return null;

  let bestPatchB64 = null;
  let bestScore = -Infinity;

  for (let i = 0; i < count; i++) {
    const c = OpenCV.copyObjectFromVector(contours, i);

    // Quick reject: too small.
    const area = OpenCV.invoke('contourArea', c, false);
    if (area < MIN_MARKER_PIXEL_SIZE * MIN_MARKER_PIXEL_SIZE) continue;

    // Approximate polygon
    const peri = OpenCV.invoke('arcLength', c, true);
    const approx = OpenCV.createObject('Mat', 0, 0, 'CV_32SC2');
    OpenCV.invoke(
      'approxPolyDP',
      c,
      approx,
      POLY_APPROX_EPSILON * peri,
      true,
    );

    const approxJS = OpenCV.toJSValue(approx);
    if (!approxJS.array || approxJS.array.length !== 4) continue;

    const isConvex = OpenCV.invoke('isContourConvex', approx);
    if (!isConvex) continue;

    // Convert vertices to {x, y}
    const ptsRaw = approxJS.array;
    const pts = [];
    for (let k = 0; k < 4; k++) {
      pts.push({ x: ptsRaw[k].x, y: ptsRaw[k].y });
    }
    const ordered = orderCorners(pts);

    const sideLen = checkSquareness(ordered);
    if (sideLen === null) continue;

    // 5. Perspective warp to N×N
    const srcPts = OpenCV.createObject('Point2fVector');
    OpenCV.invoke(
      'push_back',
      srcPts,
      OpenCV.createObject('Point2f', ordered[0].x, ordered[0].y),
    );
    OpenCV.invoke(
      'push_back',
      srcPts,
      OpenCV.createObject('Point2f', ordered[1].x, ordered[1].y),
    );
    OpenCV.invoke(
      'push_back',
      srcPts,
      OpenCV.createObject('Point2f', ordered[2].x, ordered[2].y),
    );
    OpenCV.invoke(
      'push_back',
      srcPts,
      OpenCV.createObject('Point2f', ordered[3].x, ordered[3].y),
    );

    const dstPts = OpenCV.createObject('Point2fVector');
    OpenCV.invoke('push_back', dstPts, OpenCV.createObject('Point2f', 0, 0));
    OpenCV.invoke('push_back', dstPts, OpenCV.createObject('Point2f', N - 1, 0));
    OpenCV.invoke('push_back', dstPts, OpenCV.createObject('Point2f', N - 1, N - 1));
    OpenCV.invoke('push_back', dstPts, OpenCV.createObject('Point2f', 0, N - 1));

    const M = OpenCV.invoke('getPerspectiveTransform', srcPts, dstPts);
    const warped = OpenCV.createObject('Mat', N, N, 'CV_8UC3');
    OpenCV.invoke(
      'warpPerspective',
      frameMat,
      warped,
      M,
      OpenCV.createObject('Size', N, N),
    );

    // 6. Validate against Marker 1 template
    const warpedGray = OpenCV.createObject('Mat', N, N, 'CV_8UC1');
    OpenCV.invoke('cvtColor', warped, warpedGray, 'COLOR_BGR2GRAY');

    const result = validateAndIdentifyOrientation(OpenCV, warpedGray, N);
    if (result === null) continue;

    // 7. Apply orientation correction
    const corrected = rotateMat(OpenCV, warped, result.rotationSteps, N);

    if (result.score > bestScore) {
      bestScore = result.score;
      // 8. Encode to base64 PNG for the JS thread
      bestPatchB64 = OpenCV.toJSValue(corrected, 'png').base64;
    }
  }

  return bestPatchB64;
}
