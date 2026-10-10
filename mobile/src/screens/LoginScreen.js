import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Banner, Button, Card, Field, H, P, Screen } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { getBaseUrl, setBaseUrl } from '../lib/api';
import { colors, FONT } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(getBaseUrl());
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (showServer) await setBaseUrl(server);
      await login(email, password);
    } catch (e) {
      setError(e.network ? "Can't reach the server. Check your connection or the server address." : e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen contentStyle={{ paddingTop: 70 }}>
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 32, color: colors.black }}>
            Nest <Text style={{ color: colors.orange }}>Transport</Text>
          </Text>
          <P muted>Sign in to see your trips.</P>
        </View>
        <Card>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
          {showServer ? <Field label="Server address" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" /> : null}
          <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
          <Pressable onPress={() => setShowServer(v => !v)} style={{ marginTop: 14 }}>
            <Text style={{ fontFamily: FONT.semiBold, textDecorationLine: 'underline', color: colors.black }}>{showServer ? 'Hide server settings' : 'Server settings'}</Text>
          </Pressable>
        </Card>
        <H style={{ fontSize: 14, color: colors.muted }}>Forgot your password? Ask your administrator for a reset link.</H>
      </Screen>
    </KeyboardAvoidingView>
  );
}
