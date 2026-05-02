/**
 * useMarkerFrameProcessor
 * --------------------------------------------------------------------
 * Wraps the marker detection pipeline in a vision-camera worklet.
 *
 * Important: vision-camera frame processors run on a dedicated
 * worklet thread. We can't access JS state directly from inside, so
 * we use a Worklets shared value + a dispatcher (`onMarkerFound`)
 * created with createRunOnJS to send results back to the React layer.
 *
 * Throttling: detection runs on every frame, but we throttle the JS
 * callback to at most one new marker every ~150ms to avoid flooding
 * the UI thread.
 */

import { useCallback, useRef } from 'react';
import { useFrameProcessor } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { OpenCV, ObjectType } from 'react-native-fast-opencv';
import { useResizePlugin } from 'vision-camera-resize-plugin';

import { detectMarker } from './markerDetector';

const DETECTION_THROTTLE_MS = 150;

export function useMarkerFrameProcessor(onMarkerFound) {
  const lastDetectionRef = useRef(0);
  const { resize } = useResizePlugin();

  // Bridge the JS callback into something callable from a worklet.
  const dispatchFound = Worklets.createRunOnJS(onMarkerFound);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      try {
        // Downscale the frame for analysis. Detection is much faster
        // on a smaller image and accuracy doesn't suffer for markers
        // ≥ ~60 px in the downscaled view.
        const ANALYSIS_SIZE = 720;
        const w = frame.width;
        const h = frame.height;
        const scale = ANALYSIS_SIZE / Math.max(w, h);
        const aw = Math.round(w * scale);
        const ah = Math.round(h * scale);

        const resized = resize(frame, {
          scale: { width: aw, height: ah },
          pixelFormat: 'bgr',
          dataType: 'uint8',
        });

        const mat = OpenCV.frameBufferToMat(ah, aw, 3, resized);

        const patchB64 = detectMarker(OpenCV, mat);

        // Hand off ownership of all temporary OpenCV objects to GC.
        OpenCV.clearBuffers();

        if (patchB64) {
          dispatchFound(patchB64, Date.now());
        }
      } catch (e) {
        // Worklets can't throw across threads cleanly — swallow and
        // let the next frame retry.
      }
    },
    [dispatchFound, resize],
  );

  // Wrap onMarkerFound with JS-side throttling. The actual frame
  // processor will dispatch on every detection; we filter here.
  const wrappedOnFound = useCallback((b64, ts) => {
    const now = Date.now();
    if (now - lastDetectionRef.current < DETECTION_THROTTLE_MS) return;
    lastDetectionRef.current = now;
    onMarkerFound(b64, ts);
  }, [onMarkerFound]);

  return { frameProcessor, wrappedOnFound };
}
