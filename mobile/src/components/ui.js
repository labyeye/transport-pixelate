import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FONT, colors, shadow } from '../theme';

export function Screen({ children, scroll = true, refreshControl, contentStyle }) {
  const Body = scroll ? ScrollView : View;
  return (
    <Body style={s.screen} refreshControl={refreshControl} contentContainerStyle={scroll ? [{ padding: 16, paddingBottom: 40 }, contentStyle] : undefined}>
      {children}
    </Body>
  );
}

export const Card = ({ children, style, onPress, accent }) => {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={({ pressed } = {}) => [s.card, shadow, accent && { borderLeftWidth: 8, borderLeftColor: accent }, pressed && { transform: [{ translateX: 1 }, { translateY: 1 }] }, style]}>
      {children}
    </Wrap>
  );
};

export const H = ({ children, style }) => <Text style={[s.h, style]}>{children}</Text>;
export const P = ({ children, style, muted, bold }) => <Text style={[s.p, muted && { color: colors.muted }, bold && { fontFamily: FONT.bold }, style]}>{children}</Text>;
export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;

export function Button({ title, onPress, variant = 'primary', disabled, busy, style, small }) {
  const bg = { primary: colors.blue, secondary: colors.white, danger: colors.red, success: colors.green, warning: colors.yellow }[variant];
  const fg = ['secondary', 'warning', 'success'].includes(variant) ? colors.black : colors.white;
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={onPress}
      style={({ pressed }) => [s.btn, small && { paddingVertical: 8, minHeight: 38 }, { backgroundColor: bg }, shadow, off && { opacity: 0.5 }, pressed && { transform: [{ translateX: 2 }, { translateY: 2 }] }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

const PILL = { in_progress: colors.orange, delayed: colors.yellow, ready: colors.green, assigned: colors.purple, scheduled: colors.blue, completed: colors.green, cancelled: colors.red, aborted: colors.red };
export function StatusPill({ status, label }) {
  const bg = PILL[status] ?? colors.white;
  const dark = ['delayed', 'ready', 'completed'].includes(status);
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[s.pillText, { color: dark ? colors.black : colors.white }]}>{(label ?? status).toUpperCase()}</Text>
    </View>
  );
}

export function Banner({ tone = 'info', title, children, action }) {
  const bg = { info: colors.softBlue, warn: '#FFF4CC', error: '#FEE2E2', ok: '#DCFCE7' }[tone];
  return (
    <View style={[s.banner, { backgroundColor: bg }]} accessibilityRole="alert">
      <View style={{ flex: 1 }}>
        {title ? <Text style={s.bannerTitle}>{title}</Text> : null}
        {children ? <Text style={s.bannerText}>{children}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export const Field = ({ label, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    {label ? <Label>{label}</Label> : null}
    <TextInput placeholderTextColor={colors.muted} {...props} style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, props.style]} />
  </View>
);

export const Empty = ({ title, children }) => (
  <View style={s.empty}>
    <Text style={s.emptyTitle}>{title}</Text>
    {children ? <Text style={[s.p, { textAlign: 'center', color: colors.muted }]}>{children}</Text> : null}
  </View>
);

export const Row = ({ children, style }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  card: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.border, padding: 14, marginBottom: 14 },
  h: { fontFamily: FONT.bold, fontSize: 20, color: colors.black },
  p: { fontFamily: FONT.medium, fontSize: 15, color: colors.black },
  label: { fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.black, marginBottom: 4 },
  btn: { borderWidth: 2, borderColor: colors.border, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  btnText: { fontFamily: FONT.bold, fontSize: 16 },
  pill: { borderWidth: 2, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  pillText: { fontFamily: FONT.bold, fontSize: 11, letterSpacing: 0.5 },
  banner: { borderWidth: 2, borderColor: colors.border, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerTitle: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  bannerText: { fontFamily: FONT.medium, fontSize: 13, color: colors.black, marginTop: 2 },
  input: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.white, fontFamily: FONT.medium, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10, color: colors.black },
  empty: { alignItems: 'center', padding: 28, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.muted, backgroundColor: colors.white },
  emptyTitle: { fontFamily: FONT.bold, fontSize: 17, marginBottom: 6, color: colors.black },
});
