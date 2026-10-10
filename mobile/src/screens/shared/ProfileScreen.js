import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock, Phone, User } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Avatar, Button, Card, Notice, SectionTitle, TextField, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

export default function ProfileScreen() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put('/auth/profile', { name: name.trim(), phone: phone.trim() || undefined });
      await refreshUser();
      toast.success('Profile saved');
    } catch (e) { setError(e.errors?.[0]?.message ?? e.message); } finally { setSaving(false); }
  };
  const changePassword = async () => {
    setChanging(true); setError('');
    try {
      await api.post('/auth/change-password', { current: pw.current, next: pw.next });
      toast.success('Password changed. Please sign in again.');
      await logout();
    } catch (e) { setError(e.errors?.[0]?.message ?? e.message); } finally { setChanging(false); }
  };

  return (
    <ScreenShell title="My profile" edges={[]}>
      <View style={styles.hero}>
        <Avatar name={user?.name} size={64} />
        <View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.sub}>{user?.email}</Text>
          <Text style={styles.sub}>{titleCase(user?.role)}</Text>
        </View>
      </View>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card>
        <SectionTitle title="Details" />
        <TextField label="Name" value={name} onChangeText={setName} icon={User} autoCapitalize="words" />
        <TextField label="Phone" value={phone} onChangeText={setPhone} icon={Phone} keyboardType="phone-pad" placeholder="+91 98765 43210" />
        <Button title="Save profile" onPress={save} loading={saving} disabled={name.trim().length < 2} />
      </Card>
      <Card>
        <SectionTitle title="Change password" sub="You'll be signed out on every device" />
        <TextField label="Current password" value={pw.current} onChangeText={v => setPw({ ...pw, current: v })} secureTextEntry icon={Lock} />
        <TextField label="New password (min 8)" value={pw.next} onChangeText={v => setPw({ ...pw, next: v })} secureTextEntry icon={Lock} />
        <Button title="Change password" variant="outline" onPress={changePassword} loading={changing} disabled={!pw.current || pw.next.length < 8} />
      </Card>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  name: { fontFamily: FONT.bold, fontSize: 20, fontWeight: '800', color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
});
