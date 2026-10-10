import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, FONT } from '../theme/colors';

// Title header + scrolling body, the layout NestSports uses for list/detail screens.
export default function ScreenShell({ title, subtitle, right, children, refreshing, onRefresh, footer, edges = ['top'], scroll = true, contentStyle }) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView edges={edges} style={styles.screen}>
      {title ? (
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
      ) : null}
      <Body
        style={styles.body}
        contentContainerStyle={scroll ? [styles.content, contentStyle] : undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.blue} /> : undefined}
      >
        {children}
      </Body>
      {footer}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: colors.black, backgroundColor: colors.white },
  title: { fontFamily: FONT.bold, fontSize: 20, fontWeight: '800', color: colors.black },
  subtitle: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
  body: { flex: 1, backgroundColor: colors.white },
  content: { padding: 16, paddingBottom: 32 },
});
