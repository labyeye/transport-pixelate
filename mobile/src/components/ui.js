// Neo-brutalist primitives ported from NestSports' components/ui.tsx (same borders, hard right/bottom edge,
// 8px radius, uppercase labels) so Nest Transport matches Nest Play on a phone.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, FONT } from '../theme/colors';

const EDGE = '#0A0A0A';
const textStyle = { fontFamily: FONT.bold, fontWeight: '700', color: colors.black };

export const ScreenContainer = ({ children }) => <View style={styles.screen}>{children}</View>;

export function Card({ children, style, accentColor, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap activeOpacity={0.85} onPress={onPress} style={[styles.card, accentColor ? { borderLeftWidth: 5, borderLeftColor: accentColor } : null, style]}>
      {children}
    </Wrap>
  );
}

export function SectionTitle({ title, sub }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
    </View>
  );
}

export function Button({ title, onPress, color = colors.blue, loading, disabled, variant = 'solid', icon: Icon, style }) {
  const outline = variant === 'outline';
  const fg = outline ? colors.black : colors.white;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, { backgroundColor: outline ? colors.white : color, borderColor: colors.black }, (disabled || loading) && { opacity: 0.6 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {Icon ? <Icon size={16} color={fg} strokeWidth={2.5} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export const Badge = ({ label, color = colors.blue }) => (
  <View style={[styles.badge, { backgroundColor: color }]}>
    <Text style={styles.badgeText}>{label}</Text>
  </View>
);

// Pale fill, coloured label, black outline with a hard bottom/right edge.
export const StatusPill = ({ label, color, bg }) => (
  <View style={[styles.statusPill, { backgroundColor: bg || `${color}1A` }]}>
    <Text style={[styles.statusPillText, { color }]} numberOfLines={1}>{label}</Text>
  </View>
);

export function EmptyState({ title, sub, icon: Icon }) {
  return (
    <View style={styles.empty}>
      {Icon ? <Icon size={40} color="#D1D5DB" strokeWidth={1.5} style={{ marginBottom: 10 }} /> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {sub ? <Text style={styles.emptySub}>{sub}</Text> : null}
    </View>
  );
}

export const LoadingView = () => (
  <SafeAreaView edges={['top']} style={styles.loading}>
    <ActivityIndicator size="large" color={colors.blue} />
  </SafeAreaView>
);

export function KpiTile({ label, value, color = colors.blue, icon: Icon, solid }) {
  return (
    <View style={styles.kpi}>
      {Icon ? (
        <View style={[styles.kpiIconWrap, solid ? { backgroundColor: color, borderColor: colors.black } : { backgroundColor: `${color}1A`, borderColor: color }]}>
          <Icon size={20} color={solid ? colors.white : color} strokeWidth={2.5} />
        </View>
      ) : (
        <View style={[styles.kpiDot, { backgroundColor: color }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.kpiValue} numberOfLines={1}>{value}</Text>
        <Text style={styles.kpiLabel} numberOfLines={2}>{label}</Text>
      </View>
    </View>
  );
}

export function Row({ title, subtitle, left, right, onPress, noBorder }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} style={[styles.row, noBorder && { borderBottomWidth: 0 }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </Wrapper>
  );
}

export function Avatar({ uri, name, size = 44, onPress }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const dim = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Wrapper onPress={onPress} style={[styles.avatar, dim]}>
      {uri ? <Image source={{ uri }} style={dim} /> : <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(name?.[0] || '?').toUpperCase()}</Text>}
    </Wrapper>
  );
}

export function TextField({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry, multiline, required, icon: Icon, autoCapitalize = 'none', editable = true }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.fieldLabelRow}>
        {Icon ? <Icon size={13} color={colors.blue} strokeWidth={2.5} /> : null}
        <Text style={[styles.fieldLabel, Icon && { marginBottom: 0 }]}>{label}{required ? ' *' : ''}</Text>
      </View>
      <TextInput
        style={[styles.fieldInput, multiline && { height: 80, textAlignVertical: 'top' }, !editable && { backgroundColor: '#F3F4F6' }]}
        value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted}
        keyboardType={keyboardType} secureTextEntry={secureTextEntry} multiline={multiline} autoCapitalize={autoCapitalize} autoCorrect={false} editable={editable}
      />
    </View>
  );
}

export function ChipSelect({ label, options, value, onChange, labels }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(opt => {
          const selected = value === opt;
          return (
            <TouchableOpacity key={opt} onPress={() => onChange(opt)} style={[styles.chip, selected && { backgroundColor: colors.blue, borderColor: colors.black }]}>
              <Text style={[styles.chipText, selected && { color: colors.white }]}>{labels?.[opt] || opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function SearchBar({ value, onChangeText, placeholder = 'Search' }) {
  return (
    <View style={styles.searchBar}>
      <Search size={16} color={colors.muted} strokeWidth={2} />
      <TextInput style={styles.searchInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} autoCapitalize="none" />
      {value.length > 0 ? (
        <TouchableOpacity onPress={() => onChangeText('')} hitSlop={8}>
          <X size={16} color={colors.muted} strokeWidth={2} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function FilterPills({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillContent} style={styles.pillScroll}>
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity key={opt.value} onPress={() => onChange(opt.value)} style={[styles.pill, selected && styles.pillActive]}>
            <Text style={[styles.pillText, selected && { color: colors.white }]}>{opt.label}{opt.count !== undefined ? ` (${opt.count})` : ''}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export function StatPills({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statPillScroll} contentContainerStyle={styles.statPillContent}>
      {options.map(opt => {
        const active = value === opt.value;
        const color = opt.color || colors.blue;
        return (
          <TouchableOpacity key={opt.value} onPress={() => onChange(opt.value)} activeOpacity={0.8}
            style={[styles.statPill, { borderColor: color, backgroundColor: active ? color : colors.white }]}>
            <Text style={[styles.statPillCount, { color: active ? colors.white : color }]}>{opt.count}</Text>
            <Text style={[styles.statPillLabel, { color: active ? colors.white : color }]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export function StickyFooter({ onSave, onCancel, saveLabel = 'Save', cancelLabel = 'Cancel', saving, disabled }) {
  return (
    <View style={styles.stickyFooter}>
      {onCancel ? (
        <TouchableOpacity onPress={onCancel} disabled={saving} style={styles.stickyFooterCancel}>
          <Text style={styles.stickyFooterCancelText}>{cancelLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity onPress={onSave} disabled={saving || disabled} style={[styles.stickyFooterSave, (saving || disabled) && { opacity: 0.6 }]}>
        {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.stickyFooterSaveText}>{saveLabel}</Text>}
      </TouchableOpacity>
    </View>
  );
}

// Non-blocking feedback banner, same API shape as the web app's useToast.
const ToastContext = React.createContext({ success: () => {}, error: () => {}, info: () => {} });
export const useToast = () => React.useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);
  const show = useCallback((msg, type) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, type });
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
    }, 3000);
  }, [opacity]);
  const api = useMemo(() => ({ success: m => show(m, 'success'), error: m => show(m, 'error'), info: m => show(m, 'info') }), [show]);
  const bg = toast?.type === 'error' ? colors.red : toast?.type === 'info' ? colors.blue : colors.green;
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { backgroundColor: bg, opacity }]}>
          <Text style={styles.toastText}>{toast.msg}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

// Inline notice (offline, queued updates, location status). Tone picks the accent.
export function Notice({ tone = 'info', title, children, action }) {
  const c = { info: colors.blue, warn: colors.orange, error: colors.red, ok: colors.green }[tone];
  return (
    <View style={[styles.notice, { borderLeftColor: c, borderLeftWidth: 5, backgroundColor: `${c}12` }]} accessibilityRole="alert">
      <View style={{ flex: 1 }}>
        {title ? <Text style={styles.noticeTitle}>{title}</Text> : null}
        {children ? <Text style={styles.noticeText}>{children}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const hardEdge = { borderWidth: 2, borderRadius: 8, borderRightWidth: 5, borderBottomWidth: 5, borderRightColor: EDGE, borderBottomColor: EDGE, borderColor: colors.black };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  card: { ...hardEdge, backgroundColor: colors.white, padding: 16, marginBottom: 12 },
  sectionTitle: { ...textStyle, fontSize: 16 },
  sectionSub: { fontFamily: FONT.medium, color: colors.muted, fontSize: 12, marginTop: 2 },
  button: { ...hardEdge, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  buttonText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 14 },
  badge: { borderWidth: 2, borderRightWidth: 4, borderBottomWidth: 4, borderRightColor: EDGE, borderBottomColor: EDGE, borderColor: colors.black, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontFamily: FONT.bold, color: colors.white, fontWeight: '700', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  statusPill: { borderWidth: 2, borderRightWidth: 4, borderBottomWidth: 4, borderColor: colors.black, borderRightColor: EDGE, borderBottomColor: EDGE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  statusPillText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  empty: { padding: 24, alignItems: 'center' },
  emptyTitle: { ...textStyle, fontSize: 14 },
  emptySub: { fontFamily: FONT.medium, color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kpi: { ...hardEdge, flexBasis: '48%', backgroundColor: colors.white, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  kpiDot: { width: 10, height: 10 },
  kpiIconWrap: { width: 42, height: 42, borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kpiValue: { ...textStyle, fontSize: 22, flexShrink: 1 },
  kpiLabel: { fontFamily: FONT.bold, color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0000001A', gap: 8 },
  rowTitle: { ...textStyle, fontSize: 14 },
  rowSubtitle: { fontFamily: FONT.medium, color: colors.muted, fontSize: 12, marginTop: 1 },
  avatar: { borderWidth: 2, borderRadius: 8, borderColor: colors.black, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: colors.white, fontFamily: FONT.bold, fontWeight: '800' },
  fieldLabel: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', color: colors.black, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  fieldInput: { ...hardEdge, fontFamily: FONT.medium, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.black },
  chip: { borderWidth: 2, borderRadius: 8, borderColor: '#D1D5DB', backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 12, color: colors.black, textTransform: 'capitalize' },
  searchBar: { ...hardEdge, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: FONT.medium, fontSize: 14, color: colors.black, padding: 0 },
  pillScroll: { flexGrow: 0, flexShrink: 0, marginBottom: 6 },
  pillContent: { gap: 10, alignItems: 'center', paddingVertical: 8 },
  statPillScroll: { flexGrow: 0, marginBottom: 12 },
  statPillContent: { gap: 8, paddingVertical: 2 },
  statPill: { paddingHorizontal: 14, paddingVertical: 10, borderWidth: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  statPillCount: { fontFamily: FONT.bold, fontSize: 20, fontWeight: '800' },
  statPillLabel: { fontFamily: FONT.bold, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 },
  pill: { borderWidth: 2, borderRadius: 10, borderColor: colors.black, backgroundColor: colors.white, paddingHorizontal: 16, paddingVertical: 9, minHeight: 38, alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: colors.blue },
  pillText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 13, lineHeight: 18, color: colors.black },
  stickyFooter: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 2, borderTopColor: colors.black, backgroundColor: colors.white },
  stickyFooterCancel: { ...hardEdge, flex: 1, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  stickyFooterCancelText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 14, color: colors.black },
  stickyFooterSave: { ...hardEdge, flex: 2, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  stickyFooterSaveText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 14, color: colors.white },
  toast: { ...hardEdge, position: 'absolute', top: 50, left: 16, right: 16, paddingHorizontal: 14, paddingVertical: 12, zIndex: 999 },
  toastText: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 13, color: colors.white },
  notice: { ...hardEdge, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginBottom: 12 },
  noticeTitle: { fontFamily: FONT.bold, fontWeight: '700', fontSize: 13, color: colors.black },
  noticeText: { fontFamily: FONT.medium, fontSize: 12, color: colors.black, marginTop: 2 },
});
