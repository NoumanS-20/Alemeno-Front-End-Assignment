/**
 * Wraps the marker detection pipeline in a Vision Camera frame processor.
 */

import { useCallback, useRef } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { OpenCV } from 'react-native-fast-opencv';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import { detectMarker } from './markerDetector';

const DETECTION_THROTTLE_MS = 150;

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
        const ANALYSIS_SIZE = 720;
        const scale = ANALYSIS_SIZE / Math.max(frame.width, frame.height);
        const width = Math.round(frame.width * scale);
        const height = Math.round(frame.height * scale);

        const resized = resize(frame, {
          scale: { width, height },
          pixelFormat: 'bgr',
          dataType: 'uint8',
        });

        const mat = OpenCV.frameBufferToMat(height, width, 3, resized);
        const patchB64 = detectMarker(OpenCV, mat, height, width);
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
