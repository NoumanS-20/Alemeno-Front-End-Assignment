/**
 * Wraps the marker detection pipeline in a Vision Camera frame processor.
 */

import { useCallback, useRef } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { OpenCV } from 'react-native-fast-opencv';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import { detectMarker } from './markerDetector';

// Min interval between accepted detections. Tuned so 20 captures fit
// well under the 3 s scan-to-result target in the assignment.
const DETECTION_THROTTLE_MS = 80;

export function useMarkerFrameProcessor(onMarkerFound) {
  const lastDetectionRef = useRef(0);
  const { resize } = useResizePlugin();

  const wrappedOnFound = useCallback((b64, ts) => {
    const now = Date.now();
    if (now - lastDetectionRef.current < DETECTION_THROTTLE_MS) {return;}
    lastDetectionRef.current = now;
    onMarkerFound(b64, ts);
  }, [onMarkerFound]);

  const dispatchFound = Worklets.createRunOnJS(wrappedOnFound);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      try {
        // The phone streams 4K (3840×2160). Crop a centred square ROI
        // (side = min dimension, ~2160 px) before downscaling — the
        // assignment's "2000–3000 px live camera feed" applies to the
        // square region we actually analyse, not the wider preview.
        const cropSide = Math.min(frame.width, frame.height);
        const cropX = Math.floor((frame.width - cropSide) / 2);
        const cropY = Math.floor((frame.height - cropSide) / 2);

        // Downsample the cropped square for OpenCV speed. 720 keeps
        // marker geometry well-defined while running the full pipeline
        // comfortably within one camera frame at 30 fps.
        const ANALYSIS_SIZE = 720;
        const resized = resize(frame, {
          crop: { x: cropX, y: cropY, width: cropSide, height: cropSide },
          scale: { width: ANALYSIS_SIZE, height: ANALYSIS_SIZE },
          pixelFormat: 'bgr',
          dataType: 'uint8',
        });

        const mat = OpenCV.frameBufferToMat(ANALYSIS_SIZE, ANALYSIS_SIZE, 3, resized);
        const patchB64 = detectMarker(OpenCV, mat, ANALYSIS_SIZE, ANALYSIS_SIZE);
        OpenCV.clearBuffers();

        if (patchB64) {
          dispatchFound(patchB64, Date.now());
        }
      } catch (e) {
        // Transient CV failure — drop the frame, keep the camera running.
      }
    },
    [dispatchFound, resize],
  );

  return { frameProcessor };
}
