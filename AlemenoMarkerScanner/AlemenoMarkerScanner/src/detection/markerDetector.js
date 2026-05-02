/**
 * Marker 1 detector.
 *
 * The detector runs inside a Vision Camera worklet. It finds square
 * marker candidates, perspective-warps each candidate to 300x300, then
 * validates the warped patch against the Marker 1 template: a black
 * outer frame plus one small filled anchor square in a valid corner.
 */

import {
  AdaptiveThresholdTypes,
  BorderTypes,
  ColorConversionCodes,
  ContourApproximationModes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  LineTypes,
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

export function orderCorners(pts) {
  'worklet';
  let tl = pts[0];
  let tr = pts[0];
  let br = pts[0];
  let bl = pts[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const sum = p.x + p.y;
    const diff = p.y - p.x;

    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      tr = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      bl = p;
    }
  }

  return [tl, tr, br, bl];
}

export function checkSquareness(corners) {
  'worklet';
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

  if (shortest < MIN_MARKER_PIXEL_SIZE) {return null;}
  if (longest / shortest > SQUARENESS_TOLERANCE) {return null;}

  return (s0 + s1 + s2 + s3) / 4;
}

export function validateAndIdentifyOrientation(OpenCV, warpedGray, N) {
  'worklet';
  const binary = mat(OpenCV, N, N, DataTypes.CV_8UC1);
  OpenCV.invoke(
    'threshold',
    warpedGray,
    binary,
    128,
    255,
    ThresholdTypes.THRESH_BINARY_INV,
  );

  if (sampleBorderInkRatio(OpenCV, binary, N) < 0.75) {
    return null;
  }

  if (sampleCenterInkRatio(OpenCV, binary, N) > 0.70) {
    return null;
  }

  const contours = OpenCV.createObject(ObjectType.MatVector);
  OpenCV.invoke(
    'findContours',
    binary,
    contours,
    RetrievalModes.RETR_LIST,
    ContourApproximationModes.CHAIN_APPROX_SIMPLE,
  );

  const total = OpenCV.toJSValue(contours).array.length;
  const sizeMin = 0.09;
  const sizeMax = 0.20;
  const cornerZone = N * CORNER_ZONE_RATIO;
  const frameClear = N * 0.03;
  const anchorCandidates = [];
  let disqualifyingBlobs = 0;

  for (let i = 0; i < total; i++) {
    const contour = OpenCV.copyObjectFromVector(contours, i);
    const rect = OpenCV.toJSValue(OpenCV.invoke('boundingRect', contour));
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;
    const side = (w + h) / 2;

    if (side < N * 0.04) {continue;}
    if (w > N * 0.80 && h > N * 0.80) {continue;}

    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
    const sizeRatio = side / N;
    const mask = mat(OpenCV, N, N, DataTypes.CV_8UC1);
    zeroMat(OpenCV, mask);

    OpenCV.invoke(
      'drawContours',
      mask,
      contours,
      i,
      scalar(OpenCV, 255),
      LineTypes.FILLED,
      LineTypes.LINE_8,
    );

    const boundedMask = cropMat(
      OpenCV,
      mask,
      x,
      y,
      w,
      h,
      DataTypes.CV_8UC1,
    );
    const density = meanValue(OpenCV, boundedMask) / 255;
    const looksLikeAnchor = density >= 0.85 && aspect <= 1.25;

    if (!looksLikeAnchor) {continue;}

    if (sizeRatio > sizeMax) {
      disqualifyingBlobs += 1;
      continue;
    }
    if (sizeRatio < sizeMin) {continue;}

    const cx = x + w / 2;
    const cy = y + h / 2;
    const inLeft = cx < cornerZone;
    const inRight = cx > N - cornerZone;
    const inTop = cy < cornerZone;
    const inBottom = cy > N - cornerZone;

    if (!((inLeft || inRight) && (inTop || inBottom))) {
      disqualifyingBlobs += 1;
      continue;
    }

    if (
      x < frameClear ||
      y < frameClear ||
      x + w > N - frameClear ||
      y + h > N - frameClear
    ) {
      disqualifyingBlobs += 1;
      continue;
    }

    anchorCandidates.push({ side, inTop, inBottom, inLeft, inRight });
  }

  if (anchorCandidates.length !== 1 || disqualifyingBlobs > 0) {
    return null;
  }

  const anchor = anchorCandidates[0];
  let rotationSteps = 3;
  if (anchor.inTop && anchor.inLeft) {rotationSteps = 0;}
  else if (anchor.inTop && anchor.inRight) {rotationSteps = 1;}
  else if (anchor.inBottom && anchor.inRight) {rotationSteps = 2;}

  const expectedAnchorRatio = 20 / 140;
  const sizeDelta = Math.abs(anchor.side / N - expectedAnchorRatio);
  const score = 1 - sizeDelta * 4;

  return { rotationSteps, score };
}

export function rotateMat(OpenCV, source, steps, N) {
  'worklet';
  const normalizedSteps = ((steps % 4) + 4) % 4;
  if (normalizedSteps === 0) {return source;}

  const dst = mat(OpenCV, N, N, DataTypes.CV_8UC3);
  if (normalizedSteps === 1) {
    OpenCV.invoke('rotate', source, dst, RotateFlags.ROTATE_90_CLOCKWISE);
  } else if (normalizedSteps === 2) {
    OpenCV.invoke('rotate', source, dst, RotateFlags.ROTATE_180);
  } else {
    OpenCV.invoke('rotate', source, dst, RotateFlags.ROTATE_90_COUNTERCLOCKWISE);
  }
  return dst;
}

export function detectMarker(OpenCV, frameMat, frameRows, frameCols) {
  'worklet';
  const N = MARKER_OUTPUT_SIZE;
  const gray = mat(OpenCV, frameRows, frameCols, DataTypes.CV_8UC1);
  OpenCV.invoke('cvtColor', frameMat, gray, ColorConversionCodes.COLOR_BGR2GRAY);

  const blurred = mat(OpenCV, frameRows, frameCols, DataTypes.CV_8UC1);
  OpenCV.invoke(
    'GaussianBlur',
    gray,
    blurred,
    OpenCV.createObject(ObjectType.Size, 5, 5),
    0,
  );

  const binary = mat(OpenCV, frameRows, frameCols, DataTypes.CV_8UC1);
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

  const contourCount = OpenCV.toJSValue(contours).array.length;
  if (contourCount === 0) {return null;}

  let bestPatchB64 = null;
  let bestScore = -Infinity;

  for (let i = 0; i < contourCount; i++) {
    const contour = OpenCV.copyObjectFromVector(contours, i);
    const area = OpenCV.invoke('contourArea', contour, false).value;
    if (area < MIN_MARKER_PIXEL_SIZE * MIN_MARKER_PIXEL_SIZE) {continue;}

    const perimeter = OpenCV.invoke('arcLength', contour, true).value;
    const approx = OpenCV.createObject(ObjectType.PointVector);
    OpenCV.invoke(
      'approxPolyDP',
      contour,
      approx,
      POLY_APPROX_EPSILON * perimeter,
      true,
    );

    const approxPoints = OpenCV.toJSValue(approx).array;
    if (!approxPoints || approxPoints.length !== 4) {continue;}

    if (!OpenCV.invoke('isContourConvex', approx).value) {continue;}

    const ordered = orderCorners(approxPoints);
    if (checkSquareness(ordered) === null) {continue;}

    const srcPts = point2fVector(OpenCV, [
      ordered[0],
      ordered[1],
      ordered[2],
      ordered[3],
    ]);
    const dstPts = point2fVector(OpenCV, [
      { x: 0, y: 0 },
      { x: N - 1, y: 0 },
      { x: N - 1, y: N - 1 },
      { x: 0, y: N - 1 },
    ]);
    const transform = OpenCV.invoke(
      'getPerspectiveTransform',
      srcPts,
      dstPts,
      DecompTypes.DECOMP_LU,
    );

    const warped = mat(OpenCV, N, N, DataTypes.CV_8UC3);
    OpenCV.invoke(
      'warpPerspective',
      frameMat,
      warped,
      transform,
      OpenCV.createObject(ObjectType.Size, N, N),
      InterpolationFlags.INTER_LINEAR,
      BorderTypes.BORDER_CONSTANT,
      scalar(OpenCV, 0, 0, 0, 0),
    );

    const warpedGray = mat(OpenCV, N, N, DataTypes.CV_8UC1);
    OpenCV.invoke('cvtColor', warped, warpedGray, ColorConversionCodes.COLOR_BGR2GRAY);

    const result = validateAndIdentifyOrientation(OpenCV, warpedGray, N);
    if (result === null) {continue;}

    if (result.score > bestScore) {
      const corrected = rotateMat(OpenCV, warped, result.rotationSteps, N);
      bestScore = result.score;
      bestPatchB64 = OpenCV.toJSValue(corrected, 'png').base64;
    }
  }

  return bestPatchB64;
}

function mat(OpenCV, rows, cols, type) {
  'worklet';
  return OpenCV.createObject(ObjectType.Mat, rows, cols, type);
}

function scalar(OpenCV, a, b, c, d) {
  'worklet';
  if (d !== undefined) {return OpenCV.createObject(ObjectType.Scalar, a, b, c, d);}
  if (c !== undefined) {return OpenCV.createObject(ObjectType.Scalar, a, b, c);}
  if (b !== undefined) {return OpenCV.createObject(ObjectType.Scalar, a, b);}
  return OpenCV.createObject(ObjectType.Scalar, a);
}

function point2fVector(OpenCV, pts) {
  'worklet';
  const p0 = OpenCV.createObject(ObjectType.Point2f, pts[0].x, pts[0].y);
  const p1 = OpenCV.createObject(ObjectType.Point2f, pts[1].x, pts[1].y);
  const p2 = OpenCV.createObject(ObjectType.Point2f, pts[2].x, pts[2].y);
  const p3 = OpenCV.createObject(ObjectType.Point2f, pts[3].x, pts[3].y);
  return OpenCV.createObject(ObjectType.Point2fVector, [p0, p1, p2, p3]);
}

function cropMat(OpenCV, source, x, y, width, height, type) {
  'worklet';
  const dst = mat(OpenCV, height, width, type);
  const roi = OpenCV.createObject(ObjectType.Rect, x, y, width, height);
  OpenCV.invoke('crop', source, dst, roi);
  return dst;
}

function meanValue(OpenCV, source) {
  'worklet';
  const scalarValue = OpenCV.toJSValue(OpenCV.invoke('mean', source));
  return scalarValue.a || 0;
}

function zeroMat(OpenCV, target) {
  'worklet';
  OpenCV.invoke('bitwise_xor', target, target, target);
}

function sampleBorderInkRatio(OpenCV, binary, N) {
  'worklet';
  const ringW = Math.max(2, Math.round(N * 0.05));
  const top = cropMat(OpenCV, binary, 0, 0, N, ringW, DataTypes.CV_8UC1);
  const bottom = cropMat(OpenCV, binary, 0, N - ringW, N, ringW, DataTypes.CV_8UC1);
  const left = cropMat(OpenCV, binary, 0, ringW, ringW, N - 2 * ringW, DataTypes.CV_8UC1);
  const right = cropMat(OpenCV, binary, N - ringW, ringW, ringW, N - 2 * ringW, DataTypes.CV_8UC1);
  return (
    (meanValue(OpenCV, top) +
      meanValue(OpenCV, bottom) +
      meanValue(OpenCV, left) +
      meanValue(OpenCV, right)) /
    4 /
    255
  );
}

function sampleCenterInkRatio(OpenCV, binary, N) {
  'worklet';
  const margin = Math.round(N * 0.25);
  const center = cropMat(
    OpenCV,
    binary,
    margin,
    margin,
    N - 2 * margin,
    N - 2 * margin,
    DataTypes.CV_8UC1,
  );
  return meanValue(OpenCV, center) / 255;
}
