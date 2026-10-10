import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Button, TextField } from './ui';
import { colors, FONT } from '../theme/colors';

// Generic bottom sheet asking for a short text (reason, note).
export default function ReasonSheet({ visible, title, label = 'Reason', confirmLabel = 'Confirm', danger, optional, onClose, onSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setText(''); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close"><X size={20} color={colors.black} /></TouchableOpacity>
          </View>
          <TextField label={label} value={text} onChangeText={setText} multiline autoCapitalize="sentences" />
          <Button title={confirmLabel} color={danger ? colors.red : colors.blue} loading={busy} disabled={!optional && text.trim().length < 3}
            onPress={async () => { setBusy(true); try { await onSubmit(text.trim()); setText(''); onClose(); } finally { setBusy(false); } }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopWidth: 2, borderColor: colors.black, padding: 16, paddingBottom: 30 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: FONT.bold, fontSize: 16, fontWeight: '700', color: colors.black },
});
