import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { colors, FONT } from '../theme/colors';

// Thin neo-brutalist bar with a back button (same as NestSports). Renders nothing on a stack's first screen.
export default function BackBar({ navigation, back }) {
  const insets = useSafeAreaInsets();
  if (!back) return null;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <TouchableOpacity style={styles.btn} onPress={navigation.goBack} activeOpacity={0.8} hitSlop={8} accessibilityLabel="Go back">
        <ArrowLeft size={16} color={colors.white} strokeWidth={2.5} />
        <Text style={styles.text}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.white, paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: 2, borderBottomColor: colors.black },
  btn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.blue, borderWidth: 2, borderRightWidth: 4, borderBottomWidth: 4, borderColor: colors.black, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  text: { fontFamily: FONT.bold, fontSize: 12, fontWeight: '700', color: colors.white, textTransform: 'uppercase' },
});
