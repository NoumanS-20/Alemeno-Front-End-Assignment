/**
 * App.js — root component
 *
 * Two-screen app:
 *   1. ScannerScreen — live camera feed, detects up to 20 markers
 *   2. ResultsScreen — grid of all extracted 300x300 markers
 *
 * Navigation is intentionally minimal (a single state flag) — there's
 * no need for a router for a 2-screen flow, and it keeps the APK
 * lighter.
 */

import React, { useState, useCallback } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ScannerScreen from './src/screens/ScannerScreen';
import ResultsScreen from './src/screens/ResultsScreen';

export default function App() {
  const [phase, setPhase] = useState('scan'); // 'scan' | 'results'
  const [markers, setMarkers] = useState([]);

  const handleComplete = useCallback((collected) => {
    setMarkers(collected);
    setPhase('results');
  }, []);

  const handleRescan = useCallback(() => {
    setMarkers([]);
    setPhase('scan');
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.root}>
        {phase === 'scan' ? (
          <ScannerScreen onComplete={handleComplete} />
        ) : (
          <ResultsScreen markers={markers} onRescan={handleRescan} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
