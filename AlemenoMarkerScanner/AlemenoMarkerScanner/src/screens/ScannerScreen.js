/**
 * ScannerScreen
 * --------------------------------------------------------------------
 * Live camera + reticle UI. As the frame processor finds Marker 1
 * instances, captures get queued. When 20 unique markers have been
 * collected, navigation flips to the gallery.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { Camera, useCameraDevice, useCameraFormat } from 'react-native-vision-camera';
import { useMarkerFrameProcessor } from '../detection/useMarkerFrameProcessor';

const TARGET_COUNT = 20;
// Minimum interval between unique accepted detections. With this set
// to 80 ms, capturing all 20 markers takes ~1.6 s + camera warm-up,
// well inside the assignment's 3000 ms scan-to-result target.
const MIN_GAP_MS = 80;

const ACCENT = '#22d3ee';
const ACCENT_DEEP = '#0891b2';

export default function ScannerScreen({ onComplete }) {
  const [hasPermission, setHasPermission] = useState(null);
  const [count, setCount] = useState(0);
  const collectedRef = useRef([]);
  const lastAcceptRef = useRef(0);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;

  const device = useCameraDevice('back');

  const format = useCameraFormat(device, [
    { videoResolution: { width: 2400, height: 2400 } },
    { videoAspectRatio: 1 },
    { photoResolution: { width: 2400, height: 2400 } },
    { fps: 30 },
  ]);

  // Permission flow
  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Reticle pulse
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulseAnim]);

  const triggerFlash = useCallback(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [flashAnim]);

  const handleMarkerFound = useCallback((b64, ts) => {
    if (collectedRef.current.length >= TARGET_COUNT) {return;}
    if (ts - lastAcceptRef.current < MIN_GAP_MS) {return;}
    lastAcceptRef.current = ts;

    const next = [
      ...collectedRef.current,
      { id: `m_${ts}_${collectedRef.current.length}`, base64: b64, ts },
    ];
    collectedRef.current = next;
    setCount(next.length);
    triggerFlash();

    if (next.length >= TARGET_COUNT) {
      setTimeout(() => onComplete(next), 350);
    }
  }, [onComplete, triggerFlash]);

  const { frameProcessor } = useMarkerFrameProcessor(handleMarkerFound);

  const statusText = useMemo(() => {
    if (count === 0) {return 'Align marker inside the frame';}
    if (count < TARGET_COUNT) {return `Capturing… ${count} / ${TARGET_COUNT}`;}
    return 'Done — opening gallery';
  }, [count]);

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={ACCENT} />
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

  // pulse: scale 1.0 → 1.04 → 1.0; opacity 0.6 → 1.0
  const reticleScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });
  const reticleOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const flashOpacity = flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });
  const progressPct = Math.min(100, (count / TARGET_COUNT) * 100);

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

      {/* Capture flash overlay */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.flashOverlay, { opacity: flashOpacity }]}
      />

      {/* Top brand bar */}
      <View pointerEvents="none" style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <View style={styles.brandIconAnchor} />
          </View>
          <Text style={styles.brandName}>Marker Scanner</Text>
        </View>

        <View style={styles.statusPill}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      {/* Reticle */}
      <View pointerEvents="none" style={styles.reticleWrap}>
        <Animated.View
          style={[
            styles.reticle,
            { opacity: reticleOpacity, transform: [{ scale: reticleScale }] },
          ]}
        >
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </Animated.View>
      </View>

      {/* Bottom counter + action */}
      <View style={styles.bottomBar}>
        <View style={styles.countChip}>
          <Text style={styles.countNum}>{count}</Text>
          <Text style={styles.countDenom}>/ {TARGET_COUNT}</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.actionBtn,
            count >= TARGET_COUNT && styles.actionBtnDone,
          ]}
          activeOpacity={0.85}
          onPress={() => {
            if (collectedRef.current.length === 0) {
              Alert.alert('Nothing yet', 'Capture at least one marker first.');
              return;
            }
            onComplete(collectedRef.current);
          }}
        >
          <Text style={styles.actionBtnText}>
            {count >= TARGET_COUNT ? 'View results' : 'Stop early'}
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
    backgroundColor: '#0a0e27', padding: 24,
  },
  permTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  permBody: { color: '#9ca3af', textAlign: 'center', marginBottom: 16 },
  permButton: {
    backgroundColor: ACCENT, paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 999,
  },
  permButtonText: { color: '#0a0e27', fontWeight: '700' },

  flashOverlay: { backgroundColor: ACCENT },

  // Top bar
  topBar: {
    position: 'absolute', top: 48, left: 0, right: 0,
    paddingHorizontal: 20, alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 39, 0.78)',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    marginBottom: 14,
  },
  brandIcon: {
    width: 18, height: 18, borderWidth: 2,
    borderColor: '#fff', marginRight: 8, position: 'relative',
  },
  brandIconAnchor: {
    position: 'absolute', top: 1, left: 1,
    width: 4, height: 4, backgroundColor: ACCENT,
  },
  brandName: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    marginBottom: 12,
  },
  statusDot: {
    width: 7, height: 7, borderRadius: 7,
    backgroundColor: ACCENT, marginRight: 8,
  },
  statusText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  progressTrack: {
    width: '88%', height: 4, backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 4, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: ACCENT,
  },

  // Reticle
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
  },
  reticle: {
    width: 280, height: 280, position: 'relative',
  },
  corner: {
    position: 'absolute', width: 36, height: 36,
    borderColor: ACCENT,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 4 },

  // Bottom bar
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 36,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  countChip: {
    flexDirection: 'row', alignItems: 'baseline',
    backgroundColor: 'rgba(10, 14, 39, 0.85)',
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  countNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  countDenom: { color: '#9ca3af', fontSize: 13, fontWeight: '600', marginLeft: 4 },

  actionBtn: {
    backgroundColor: ACCENT_DEEP, paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 999,
    shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actionBtnDone: { backgroundColor: ACCENT },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
});
