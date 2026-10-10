import React from 'react';
import { StatusBar, Text, TextInput, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ToastProvider } from './src/components/ui';
import { FONT } from './src/theme/colors';

// DM Sans as the default typeface everywhere (individual styles still pick bold/medium), same as NestSports.
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.style = [{ fontFamily: FONT.regular }, Text.defaultProps.style];
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.style = [{ fontFamily: FONT.regular }, TextInput.defaultProps.style];

export default function App() {
  const dark = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <AuthProvider>
        <ToastProvider>
          <RootNavigator />
        </ToastProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
