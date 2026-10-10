import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../lib/api';
import { Button, Notice, TextField } from '../../components/ui';
import AuthBanner from '../../components/AuthBanner';
import { colors, FONT } from '../../theme/colors';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() }, { auth: false });
      setDone(true);
    } catch (e) {
      setError(e.network ? "Can't reach the server." : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.blue }}>
      <AuthBanner />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Forgot password</Text>
          <Text style={styles.subtitle}>Enter your email and we'll send a link to choose a new password.</Text>
          {done ? (
            <Notice tone="ok" title="Check your email">
              If that address has an account, a reset link is on its way and works for 60 minutes. If nothing arrives, ask your administrator for a reset link.
            </Notice>
          ) : (
            <View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
              <Button title="Send reset link" onPress={submit} loading={loading} disabled={!email.includes('@')} />
            </View>
          )}
          <Text style={styles.back} onPress={() => navigation.goBack()}>← Back to login</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  title: { fontFamily: FONT.bold, fontSize: 30, fontWeight: '800', color: colors.black, marginBottom: 4 },
  subtitle: { fontFamily: FONT.regular, color: colors.muted, fontSize: 15, marginBottom: 20 },
  error: { fontFamily: FONT.bold, color: colors.red, marginBottom: 12 },
  back: { fontFamily: FONT.bold, color: colors.blue, fontWeight: '700', marginTop: 24 },
});
