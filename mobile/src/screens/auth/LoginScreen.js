import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { getBaseUrl, setBaseUrl } from '../../lib/api';
import { Button } from '../../components/ui';
import AuthBanner from '../../components/AuthBanner';
import { colors, FONT } from '../../theme/colors';

// Layout, spacing and copy follow NestSports' LoginScreen: blue wavy banner, big title, bordered inputs, blue text links.
export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [server, setServer] = useState(getBaseUrl());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      if (showServer) await setBaseUrl(server);
      await login(email, password);
    } catch (e) {
      setError(e.network ? "Can't reach the server. Check your connection or the server address." : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <AuthBanner />
      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/logo_long.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Nest Transport" />
          <Text style={styles.title}>Login</Text>
          <Text style={styles.subtitle}>Sign in with your email and password to continue.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput_ value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={{ justifyContent: 'center' }}>
              <TextInput_ value={password} onChangeText={setPassword} placeholder="••••••••" secure={!show} style={{ paddingRight: 44 }} onSubmitEditing={onSubmit} />
              <TouchableOpacity onPress={() => setShow(p => !p)} style={styles.eye} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff color={colors.muted} size={20} /> : <Eye color={colors.muted} size={20} />}
              </TouchableOpacity>
            </View>
          </View>
          {showServer ? (
            <View style={styles.field}>
              <Text style={styles.label}>Server address</Text>
              <TextInput_ value={server} onChangeText={setServer} placeholder="https://transport.example.org/api/v1" keyboardType="url" />
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Sign In" onPress={onSubmit} loading={loading} disabled={!email || !password} />
          <Text style={styles.forgot} onPress={() => navigation.navigate('ForgotPassword')}>Forgot password?</Text>
          <Text style={styles.server} onPress={() => setShowServer(v => !v)}>{showServer ? 'Hide server settings' : 'Server settings'}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Plain bordered input used on the auth screens (kept local so the screen mirrors NestSports' own styles).
function TextInput_({ value, onChangeText, placeholder, keyboardType, secure, style, autoComplete, onSubmitEditing }) {
  return (
    <TextInput style={[styles.input, style]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted}
      autoCapitalize="none" autoCorrect={false} keyboardType={keyboardType} secureTextEntry={secure} autoComplete={autoComplete} onSubmitEditing={onSubmitEditing} />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.blue },
  body: { flex: 1, backgroundColor: colors.white },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24, backgroundColor: colors.white },
  logo: { width: '100%', height: 84, alignSelf: 'center', marginBottom: 8 },
  title: { fontFamily: FONT.bold, fontSize: 34, fontWeight: '800', color: colors.black, marginBottom: 4 },
  subtitle: { fontFamily: FONT.regular, color: colors.muted, fontSize: 15, marginBottom: 16 },
  field: { marginBottom: 14 },
  label: { fontFamily: FONT.bold, fontWeight: '700', marginBottom: 6, color: colors.black },
  input: { fontFamily: FONT.regular, borderWidth: 2, borderRadius: 8, borderRightWidth: 5, borderBottomWidth: 5, borderRightColor: '#0A0A0A', borderBottomColor: '#0A0A0A', borderColor: colors.black, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.black },
  eye: { position: 'absolute', right: 12, height: '100%', justifyContent: 'center' },
  error: { fontFamily: FONT.bold, color: colors.red, marginBottom: 12, fontWeight: '600' },
  forgot: { fontFamily: FONT.bold, textAlign: 'left', color: colors.blue, fontWeight: '700', marginTop: 25 },
  server: { fontFamily: FONT.medium, textAlign: 'left', color: colors.muted, marginTop: 18, textDecorationLine: 'underline' },
});
