import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button, TextField } from './ui';
import { colors, FONT } from '../theme/colors';

const TITLES = { delay_reported: 'Report a delay', breakdown_reported: 'Report a breakdown', incident_reported: 'Report an incident' };

// Bottom sheet in NestSports' SortSheet style: black top border, white body, X to close.
export default function ReportSheet({ kind, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setNote(''); onClose(); };
  return (
    <Modal visible={!!kind} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{TITLES[kind]}</Text>
            <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close"><X size={20} color={colors.black} /></TouchableOpacity>
          </View>
          <Text style={styles.hint}>Describe what happened so dispatch can help.</Text>
          <TextField label="Details" value={note} onChangeText={setNote} multiline placeholder="e.g. Road blocked near the market, about 20 minutes" autoCapitalize="sentences" />
          <Button title="Send report" loading={busy} disabled={note.trim().length < 3}
            onPress={async () => { setBusy(true); try { await onSubmit(note.trim()); setNote(''); onClose(); } finally { setBusy(false); } }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopWidth: 2, borderColor: colors.black, padding: 16, paddingBottom: 30 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontFamily: FONT.bold, fontSize: 16, fontWeight: '700', color: colors.black },
  hint: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginBottom: 12 },
});
