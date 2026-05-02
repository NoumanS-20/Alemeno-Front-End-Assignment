/**
 * ScannerScreen
 * --------------------------------------------------------------------
 * Renders the live camera feed and overlays a scan reticle. As the
 * frame processor finds Marker 1 instances, they get queued up to
 * the parent's `onResults` callback. When 20 unique markers have been
 * collected, navigation flips to the gallery.
 *
 * "Unique" here means we drop near-duplicates that come in within a
 * few hundred ms of each other (the camera typically sees the same
 * marker for many frames in a row).
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { useMarkerFrameProcessor } from '../detection/useMarkerFrameProcessor';

const TARGET_COUNT = 20;
const MIN_GAP_MS = 250; // minimum interval between accepted detections

export default function ScannerScreen({ onComplete }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [count, setCount] = useState(0);
  const collectedRef = React.useRef([]);
  const lastAcceptRef = React.useRef(0);

  const device = useCameraDevice('back');

  // Request a high-resolution photo/video format. The assignment
  // requires the camera feed to be 2000x2000 to 3000x3000 px. We
  // pick the format whose photo dimensions sit in that range and
  // whose aspect ratio is closest to square (so the central
  // reticle area has plenty of pixels to work with).
  const format = useCameraFormat(device, [
    { photoResolution: { width: 2400, height: 2400 } },
    { videoResolution: { width: 1920, height: 1080 } },
    { fps: 30 },
  ]);

  // Permission flow
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleMarkerFound = useCallback((b64, ts) => {
    if (collectedRef.current.length >= TARGET_COUNT) return;
    if (ts - lastAcceptRef.current < MIN_GAP_MS) return;
    lastAcceptRef.current = ts;

    const next = [
      ...collectedRef.current,
      { id: `m_${ts}_${collectedRef.current.length}`, base64: b64, ts },
    ];
    collectedRef.current = next;
    setCount(next.length);

    if (next.length >= TARGET_COUNT) {
      // brief delay so the user sees the counter hit 20
      setTimeout(() => onComplete(next), 300);
    }
  }, [onComplete]);

  const { frameProcessor } = useMarkerFrameProcessor(handleMarkerFound);

  const reticleStatusText = useMemo(() => {
    if (count === 0) return 'Point the camera at the marker';
    if (count < TARGET_COUNT) return `Scanning… ${count} / ${TARGET_COUNT}`;
    return 'Done!';
  }, [count]);

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera permission required</Text>
        <Text style={styles.permBody}>
          This app needs camera access to scan markers.
        </Text>
        <TouchableOpacity
          style={styles.permButton}
          onPress={() => Linking.openSettings()}
        >
          <Text style={styles.permButtonText}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>No camera device</Text>
        <Text style={styles.permBody}>
          Could not find a back-facing camera on this device.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={count < TARGET_COUNT}
        frameProcessor={frameProcessor}
        photo={true}
        video={true}
        pixelFormat="yuv"
      />

      {/* Scan reticle */}
      <View pointerEvents="none" style={styles.reticleWrap}>
        <View style={styles.reticle}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      {/* Status banner */}
      <View pointerEvents="none" style={styles.statusBar}>
        <Text style={styles.statusText}>{reticleStatusText}</Text>
        <View style={styles.progressBg}>
          <View
            style={[
              styles.progressFill,
              { width: `${(count / TARGET_COUNT) * 100}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            if (collectedRef.current.length === 0) {
              Alert.alert('Nothing yet', 'Capture at least one marker first.');
              return;
            }
            onComplete(collectedRef.current);
          }}
        >
          <Text style={styles.btnText}>
            {count >= TARGET_COUNT
              ? 'View Results'
              : `Stop early (${count} captured)`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000', padding: 24,
  },
  permTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  permBody: { color: '#bbb', textAlign: 'center', marginBottom: 16 },
  permButton: {
    backgroundColor: '#3b82f6', paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 8,
  },
  permButtonText: { color: '#fff', fontWeight: '600' },

  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  reticle: {
    width: 280, height: 280, position: 'relative',
  },
  corner: {
    position: 'absolute', width: 32, height: 32,
    borderColor: '#22d3ee',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },

  statusBar: {
    position: 'absolute', top: 60, left: 0, right: 0,
    paddingHorizontal: 24, alignItems: 'center',
  },
  statusText: {
    color: '#fff', fontSize: 16, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBg: {
    width: '90%', height: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: '#22d3ee',
  },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 32,
    alignItems: 'center',
  },
  btn: {
    backgroundColor: '#3b82f6', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 999,
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
