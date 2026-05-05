/**
 * Marker 1 detector — fully inlined for worklet runtime.
 *
 * Detects square Marker 1 candidates, perspective-warps each to
 * MARKER_OUTPUT_SIZE × MARKER_OUTPUT_SIZE, validates against the
 * Marker 1 template (black frame + one anchor square in a corner),
 * and returns a base64-encoded PNG of the orientation-corrected
 * patch.
 */

import {
  AdaptiveThresholdTypes,
  BorderTypes,
  ColorConversionCodes,
  ContourApproximationModes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  ObjectType,
  RetrievalModes,
  RotateFlags,
  ThresholdTypes,
} from 'react-native-fast-opencv';

import {
  MARKER_OUTPUT_SIZE,
  CORNER_ZONE_RATIO,
  MIN_MARKER_PIXEL_SIZE,
  SQUARENESS_TOLERANCE,
  POLY_APPROX_EPSILON,
} from './markerGeometry';

export function detectMarker(OpenCV, frameMat, frameRows, frameCols) {
  'worklet';
  const N = MARKER_OUTPUT_SIZE;

  const gray = OpenCV.createObject(ObjectType.Mat, frameRows, frameCols, DataTypes.CV_8UC1);
  OpenCV.invoke('cvtColor', frameMat, gray, ColorConversionCodes.COLOR_BGR2GRAY);

  const blurred = OpenCV.createObject(ObjectType.Mat, frameRows, frameCols, DataTypes.CV_8UC1);
  OpenCV.invoke(
    'GaussianBlur',
    gray,
    blurred,
    OpenCV.createObject(ObjectType.Size, 5, 5),
    0,
  );

  const binary = OpenCV.createObject(ObjectType.Mat, frameRows, frameCols, DataTypes.CV_8UC1);
  OpenCV.invoke(
    'adaptiveThreshold',
    blurred,
    binary,
    255,
    AdaptiveThresholdTypes.ADAPTIVE_THRESH_GAUSSIAN_C,
    ThresholdTypes.THRESH_BINARY_INV,
    21,
    10,
  );

  const contours = OpenCV.createObject(ObjectType.MatVector);
  OpenCV.invoke(
    'findContours',
    binary,
    contours,
    RetrievalModes.RETR_EXTERNAL,
    ContourApproximationModes.CHAIN_APPROX_SIMPLE,
  );

  const contoursJS = OpenCV.toJSValue(contours);
  const contourCount = (contoursJS && contoursJS.array) ? contoursJS.array.length : 0;
  if (contourCount === 0) { return null; }

  let bestPatchB64 = null;
  let bestScore = -Infinity;

  for (let i = 0; i < contourCount; i++) {
    const contour = OpenCV.copyObjectFromVector(contours, i);
    const areaResult = OpenCV.invoke('contourArea', contour, false);
    const area = (areaResult && areaResult.value !== undefined) ? areaResult.value : areaResult;
    if (area < MIN_MARKER_PIXEL_SIZE * MIN_MARKER_PIXEL_SIZE) { continue; }

    // Convex hull first: camera frames captured from a screen have
    // jagged contour edges due to subpixel rendering + moiré, which
    // makes a raw approxPolyDP land on tiny zigzag corners instead of
    // the 4 frame corners. The hull strips those concave noise points
    // out so a small epsilon then collapses cleanly to 4 corners.
    const hull = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_32SC2);
    OpenCV.invoke('convexHull', contour, hull);
    const hullPeriResult = OpenCV.invoke('arcLength', hull, true);
    const perimeter = (hullPeriResult && hullPeriResult.value !== undefined) ? hullPeriResult.value : hullPeriResult;

    let approxPoints = null;
    const epsilonScales = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08];
    for (let e = 0; e < epsilonScales.length; e++) {
      const a = OpenCV.createObject(ObjectType.PointVector);
      OpenCV.invoke('approxPolyDP', hull, a, epsilonScales[e] * perimeter, true);
      const aJS = OpenCV.toJSValue(a);
      const pts = aJS && aJS.array;
      if (pts && pts.length === 4) {
        approxPoints = pts;
        break;
      }
    }
    if (!approxPoints) { continue; }

    // Order corners (TL, TR, BR, BL)
    let tl = approxPoints[0], tr = approxPoints[0], br = approxPoints[0], bl = approxPoints[0];
    let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    for (let k = 0; k < 4; k++) {
      const p = approxPoints[k];
      const s = p.x + p.y;
      const d = p.y - p.x;
      if (s < minSum) { minSum = s; tl = p; }
      if (s > maxSum) { maxSum = s; br = p; }
      if (d < minDiff) { minDiff = d; tr = p; }
      if (d > maxDiff) { maxDiff = d; bl = p; }
    }
    const ordered = [tl, tr, br, bl];

    // Squareness check
    const sx0 = ordered[1].x - ordered[0].x, sy0 = ordered[1].y - ordered[0].y;
    const sx1 = ordered[2].x - ordered[1].x, sy1 = ordered[2].y - ordered[1].y;
    const sx2 = ordered[3].x - ordered[2].x, sy2 = ordered[3].y - ordered[2].y;
    const sx3 = ordered[0].x - ordered[3].x, sy3 = ordered[0].y - ordered[3].y;
    const len0 = Math.sqrt(sx0 * sx0 + sy0 * sy0);
    const len1 = Math.sqrt(sx1 * sx1 + sy1 * sy1);
    const len2 = Math.sqrt(sx2 * sx2 + sy2 * sy2);
    const len3 = Math.sqrt(sx3 * sx3 + sy3 * sy3);
    const longest = Math.max(len0, len1, len2, len3);
    const shortest = Math.min(len0, len1, len2, len3);
    if (shortest < MIN_MARKER_PIXEL_SIZE) { continue; }
    if (longest / shortest > SQUARENESS_TOLERANCE) { continue; }

    // Perspective warp
    const sp0 = OpenCV.createObject(ObjectType.Point2f, ordered[0].x, ordered[0].y);
    const sp1 = OpenCV.createObject(ObjectType.Point2f, ordered[1].x, ordered[1].y);
    const sp2 = OpenCV.createObject(ObjectType.Point2f, ordered[2].x, ordered[2].y);
    const sp3 = OpenCV.createObject(ObjectType.Point2f, ordered[3].x, ordered[3].y);
    const srcPts = OpenCV.createObject(ObjectType.Point2fVector, [sp0, sp1, sp2, sp3]);

    const dp0 = OpenCV.createObject(ObjectType.Point2f, 0, 0);
    const dp1 = OpenCV.createObject(ObjectType.Point2f, N - 1, 0);
    const dp2 = OpenCV.createObject(ObjectType.Point2f, N - 1, N - 1);
    const dp3 = OpenCV.createObject(ObjectType.Point2f, 0, N - 1);
    const dstPts = OpenCV.createObject(ObjectType.Point2fVector, [dp0, dp1, dp2, dp3]);

    const transform = OpenCV.invoke(
      'getPerspectiveTransform',
      srcPts,
      dstPts,
      DecompTypes.DECOMP_LU,
    );

    const warped = OpenCV.createObject(ObjectType.Mat, N, N, DataTypes.CV_8UC3);
    OpenCV.invoke(
      'warpPerspective',
      frameMat,
      warped,
      transform,
      OpenCV.createObject(ObjectType.Size, N, N),
      InterpolationFlags.INTER_LINEAR,
      BorderTypes.BORDER_CONSTANT,
      OpenCV.createObject(ObjectType.Scalar, 0, 0, 0, 0),
    );

    const warpedGray = OpenCV.createObject(ObjectType.Mat, N, N, DataTypes.CV_8UC1);
    OpenCV.invoke('cvtColor', warped, warpedGray, ColorConversionCodes.COLOR_BGR2GRAY);

    // Validate marker template + identify orientation (inlined)
    const wBin = OpenCV.createObject(ObjectType.Mat, N, N, DataTypes.CV_8UC1);
    OpenCV.invoke('threshold', warpedGray, wBin, 128, 255, ThresholdTypes.THRESH_BINARY_INV);

    // Border ink ratio (top/bottom/left/right rings)
    const ringW = Math.max(2, Math.round(N * 0.05));
    const cropTop = OpenCV.createObject(ObjectType.Mat, ringW, N, DataTypes.CV_8UC1);
    OpenCV.invoke('crop', wBin, cropTop, OpenCV.createObject(ObjectType.Rect, 0, 0, N, ringW));
    const cropBot = OpenCV.createObject(ObjectType.Mat, ringW, N, DataTypes.CV_8UC1);
    OpenCV.invoke('crop', wBin, cropBot, OpenCV.createObject(ObjectType.Rect, 0, N - ringW, N, ringW));
    const cropLeft = OpenCV.createObject(ObjectType.Mat, N - 2 * ringW, ringW, DataTypes.CV_8UC1);
    OpenCV.invoke('crop', wBin, cropLeft, OpenCV.createObject(ObjectType.Rect, 0, ringW, ringW, N - 2 * ringW));
    const cropRight = OpenCV.createObject(ObjectType.Mat, N - 2 * ringW, ringW, DataTypes.CV_8UC1);
    OpenCV.invoke('crop', wBin, cropRight, OpenCV.createObject(ObjectType.Rect, N - ringW, ringW, ringW, N - 2 * ringW));
    const meanTop = (OpenCV.toJSValue(OpenCV.invoke('mean', cropTop)).a || 0);
    const meanBot = (OpenCV.toJSValue(OpenCV.invoke('mean', cropBot)).a || 0);
    const meanL = (OpenCV.toJSValue(OpenCV.invoke('mean', cropLeft)).a || 0);
    const meanR = (OpenCV.toJSValue(OpenCV.invoke('mean', cropRight)).a || 0);
    const borderRatio = (meanTop + meanBot + meanL + meanR) / 4 / 255;
    // Loose threshold: approxPolyDP corners often land slightly inside
    // the frame edge, so the sampled ring picks up some interior white
    // pixels and the ratio drops. Anything well above 0.5 still implies
    // a dominant outer black frame; lower values almost always mean we
    // got a non-marker quadrilateral.
    if (borderRatio < 0.55) { continue; }

    // Center ink ratio
    const cm = Math.round(N * 0.25);
    const cropCenter = OpenCV.createObject(ObjectType.Mat, N - 2 * cm, N - 2 * cm, DataTypes.CV_8UC1);
    OpenCV.invoke('crop', wBin, cropCenter, OpenCV.createObject(ObjectType.Rect, cm, cm, N - 2 * cm, N - 2 * cm));
    const centerRatio = (OpenCV.toJSValue(OpenCV.invoke('mean', cropCenter)).a || 0) / 255;
    // Reject only if the center is overwhelmingly dark (would indicate
    // a solid filled square, not a Marker 1). The actual marker test
    // images include content-rich centers (animal faces with outlines),
    // which can register up to ~0.4-0.5 ink ratio under thresholding.
    if (centerRatio > 0.85) { continue; }

    // Find anchor blob inside the warped binary
    const anchorContours = OpenCV.createObject(ObjectType.MatVector);
    OpenCV.invoke(
      'findContours',
      wBin,
      anchorContours,
      RetrievalModes.RETR_LIST,
      ContourApproximationModes.CHAIN_APPROX_SIMPLE,
    );

    const ancJS = OpenCV.toJSValue(anchorContours);
    const ancCount = (ancJS && ancJS.array) ? ancJS.array.length : 0;
    const cornerZone = N * CORNER_ZONE_RATIO;
    const frameClear = N * 0.03;
    let anchorSide = 0, anchorTop = false, anchorBottom = false, anchorLeft = false, anchorRight = false;
    let anchorMatches = 0, disqualifying = 0;

    for (let j = 0; j < ancCount; j++) {
      const ac = OpenCV.copyObjectFromVector(anchorContours, j);
      const rect = OpenCV.toJSValue(OpenCV.invoke('boundingRect', ac));
      const x = rect.x, y = rect.y, w = rect.width, h = rect.height;
      const side = (w + h) / 2;
      if (side < N * 0.04) { continue; }
      if (w > N * 0.80 && h > N * 0.80) { continue; }
      const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
      const sizeRatio = side / N;

      if (aspect > 1.25) { continue; }
      if (sizeRatio > 0.20) { disqualifying++; continue; }
      if (sizeRatio < 0.09) { continue; }

      const cx = x + w / 2;
      const cy = y + h / 2;
      const inLeft = cx < cornerZone;
      const inRight = cx > N - cornerZone;
      const inTop = cy < cornerZone;
      const inBottom = cy > N - cornerZone;
      if (!((inLeft || inRight) && (inTop || inBottom))) { disqualifying++; continue; }
      if (x < frameClear || y < frameClear || x + w > N - frameClear || y + h > N - frameClear) {
        disqualifying++; continue;
      }
      anchorSide = side;
      anchorTop = inTop; anchorBottom = inBottom; anchorLeft = inLeft; anchorRight = inRight;
      anchorMatches++;
    }

    if (anchorMatches !== 1 || disqualifying > 0) { continue; }

    // Pick the rotation that brings the anchor to the canonical TL.
    // cv::ROTATE_90_CLOCKWISE moves what was at BL → TL, so anchor at BL needs CW.
    // cv::ROTATE_180 moves BR → TL.
    // cv::ROTATE_90_COUNTERCLOCKWISE moves TR → TL.
    let rotationSteps = 1; // default: BL → TL (ROTATE_90_CW)
    if (anchorTop && anchorLeft) { rotationSteps = 0; }
    else if (anchorTop && anchorRight) { rotationSteps = 3; }
    else if (anchorBottom && anchorRight) { rotationSteps = 2; }

    const expectedAnchorRatio = 20 / 140;
    const sizeDelta = Math.abs(anchorSide / N - expectedAnchorRatio);
    const score = 1 - sizeDelta * 4;

    if (score > bestScore) {
      let corrected = warped;
      const steps = ((rotationSteps % 4) + 4) % 4;
      if (steps !== 0) {
        const rotated = OpenCV.createObject(ObjectType.Mat, N, N, DataTypes.CV_8UC3);
        if (steps === 1) {
          OpenCV.invoke('rotate', warped, rotated, RotateFlags.ROTATE_90_CLOCKWISE);
        } else if (steps === 2) {
          OpenCV.invoke('rotate', warped, rotated, RotateFlags.ROTATE_180);
        } else {
          OpenCV.invoke('rotate', warped, rotated, RotateFlags.ROTATE_90_COUNTERCLOCKWISE);
        }
        corrected = rotated;
      }
      bestScore = score;
      bestPatchB64 = OpenCV.toJSValue(corrected, 'png').base64;
    }
  }

  return bestPatchB64;
}
