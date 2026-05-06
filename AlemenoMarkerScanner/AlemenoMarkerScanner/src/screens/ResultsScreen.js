/**
 * ResultsScreen
 * --------------------------------------------------------------------
 * Displays the (up to 20) extracted, orientation-corrected markers
 * captured from 20 different camera frames. Each thumbnail is shown
 * at the same fixed aspect ratio; the underlying PNGs are exactly
 * 300×300 pixels per the assignment requirement.
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
  StatusBar,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const COLS = 3;
const GUTTER = 10;
const PAGE_PAD = 16;
const TILE = (SCREEN_W - PAGE_PAD * 2 - GUTTER * (COLS - 1)) / COLS;

const ACCENT = '#22d3ee';
const ACCENT_DEEP = '#0891b2';
const BG = '#0a0e27';
const SURFACE = '#141a3a';

export default function ResultsScreen({ markers, onRescan }) {
  const [preview, setPreview] = useState(null);
  const total = markers.length;

  const renderItem = ({ item, index }) => (
    <TouchableOpacity
      style={styles.tile}
      activeOpacity={0.85}
      onPress={() => setPreview(item)}
    >
      <Image
        source={{ uri: `data:image/png;base64,${item.base64}` }}
        style={styles.tileImg}
        resizeMode="contain"
      />
      <View style={styles.tileLabel}>
        <Text style={styles.tileLabelText}>{index + 1}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandIcon}>
            <View style={styles.brandIconAnchor} />
          </View>
          <Text style={styles.brandName}>Marker Scanner</Text>
        </View>

        <Text style={styles.title}>Extracted Markers</Text>
        <View style={styles.metaRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{total} captured</Text>
          </View>
          <Text style={styles.subtitle}>· 300 × 300 px each</Text>
        </View>
      </View>

      <FlatList
        data={markers}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        numColumns={COLS}
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.rescanBtn} onPress={onRescan} activeOpacity={0.85}>
          <Text style={styles.rescanText}>Scan again</Text>
        </TouchableOpacity>
      </View>

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
            <View style={styles.modalCard}>
              <Image
                source={{ uri: `data:image/png;base64,${preview.base64}` }}
                style={styles.modalImg}
                resizeMode="contain"
              />
              <Text style={styles.modalCaption}>300 × 300 px · PNG</Text>
            </View>
          )}
          <Text style={styles.modalHint}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  header: {
    paddingTop: 14, paddingBottom: 18, paddingHorizontal: PAGE_PAD,
  },
  brandRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 14,
  },
  brandIcon: {
    width: 16, height: 16, borderWidth: 2,
    borderColor: '#fff', marginRight: 8, position: 'relative',
  },
  brandIconAnchor: {
    position: 'absolute', top: 1, left: 1,
    width: 3, height: 3, backgroundColor: ACCENT,
  },
  brandName: { color: '#cbd5e1', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },

  title: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: -0.3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  badge: {
    backgroundColor: 'rgba(34, 211, 238, 0.15)',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, marginRight: 8,
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.35)',
  },
  badgeText: { color: ACCENT, fontSize: 12, fontWeight: '700' },
  subtitle: { color: '#9ca3af', fontSize: 12, fontWeight: '500' },

  grid: { paddingHorizontal: PAGE_PAD, paddingBottom: 110 },
  row: { gap: GUTTER, marginBottom: GUTTER },

  tile: {
    width: TILE, height: TILE,
    backgroundColor: SURFACE,
    borderRadius: 10,
    overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  tileImg: { width: '100%', height: '100%' },
  tileLabel: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
  },
  tileLabelText: {
    color: '#fff', fontSize: 10, fontWeight: '700',
  },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 24,
    alignItems: 'center',
  },
  rescanBtn: {
    backgroundColor: ACCENT_DEEP,
    paddingHorizontal: 28, paddingVertical: 13,
    borderRadius: 999,
    shadowColor: ACCENT, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  rescanText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },

  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  modalCard: {
    backgroundColor: SURFACE, borderRadius: 16, padding: 14,
    alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.2)',
  },
  modalImg: { width: SCREEN_W * 0.78, height: SCREEN_W * 0.78, backgroundColor: '#fff', borderRadius: 8 },
  modalCaption: { color: '#9ca3af', marginTop: 10, fontSize: 12, fontWeight: '600' },
  modalHint: { color: '#64748b', marginTop: 18, fontSize: 12 },
});
