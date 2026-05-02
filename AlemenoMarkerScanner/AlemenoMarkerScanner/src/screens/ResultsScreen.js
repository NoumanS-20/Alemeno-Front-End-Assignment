/**
 * ResultsScreen
 * --------------------------------------------------------------------
 * Displays the (up to 20) extracted, orientation-corrected markers
 * captured from 20 different camera frames. Each thumbnail is
 * exactly 300×300 logical pixels, as required by the assignment.
 *
 * The screen renders a scrollable 2-column grid; tapping a thumbnail
 * opens a full-screen modal preview.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Modal,
  SafeAreaView,
  Dimensions,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const COLS = 2;
const GUTTER = 12;
const TILE = (SCREEN_W - GUTTER * (COLS + 1)) / COLS;

export default function ResultsScreen({ markers, onRescan }) {
  const [preview, setPreview] = useState(null);

  const renderItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => setPreview(item)}
    >
      <Image
        // The frame processor produces a 300×300 PNG, base64-encoded.
        source={{ uri: `data:image/png;base64,${item.base64}` }}
        style={styles.tileImg}
        resizeMode="contain"
      />
      <Text style={styles.tileLabel}>#{index + 1}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Extracted Markers</Text>
        <Text style={styles.subtitle}>
          {markers.length} captured · 300×300 px each
        </Text>
      </View>

      <FlatList
        data={markers}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        numColumns={COLS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
      />

      <TouchableOpacity style={styles.rescanBtn} onPress={onRescan}>
        <Text style={styles.rescanText}>Scan Again</Text>
      </TouchableOpacity>

      <Modal
        visible={preview !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <TouchableOpacity
          style={styles.modalBg}
          activeOpacity={1}
          onPress={() => setPreview(null)}
        >
          {preview && (
            <Image
              source={{ uri: `data:image/png;base64,${preview.base64}` }}
              style={styles.modalImg}
              resizeMode="contain"
            />
          )}
          <Text style={styles.modalHint}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: {
    paddingTop: 12, paddingBottom: 16, paddingHorizontal: GUTTER,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#9ca3af', fontSize: 13, marginTop: 4 },

  grid: { paddingHorizontal: GUTTER, paddingBottom: 100 },
  row: { gap: GUTTER, marginBottom: GUTTER },

  tile: {
    width: TILE, height: TILE,
    backgroundColor: '#1a1a23', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative',
  },
  tileImg: { width: '92%', height: '92%' },
  tileLabel: {
    position: 'absolute', bottom: 6, left: 8,
    color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600',
  },

  rescanBtn: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 999,
  },
  rescanText: { color: '#fff', fontWeight: '600', fontSize: 15 },

  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalImg: { width: '90%', aspectRatio: 1 },
  modalHint: { color: '#9ca3af', marginTop: 24, fontSize: 13 },
});
