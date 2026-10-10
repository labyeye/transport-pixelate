import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, CheckCheck } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Card, EmptyState, LoadingView, Notice, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { timeAgo } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

const SEV = { info: colors.blue, warning: colors.orange, critical: colors.red };

export default function NotificationsScreen() {
  const toast = useToast();
  const { data, meta, error, loading, refreshing, refresh } = useApi('/notifications', { limit: 50 }, { interval: 60000 });
  if (loading) return <LoadingView />;
  const unread = meta?.unreadCount ?? 0;
  const read = async n => { if (!n.readAt) { try { await api.post(`/notifications/${n._id}/read`, {}); refresh(); } catch { /* shown on next refresh */ } } };
  const readAll = async () => { try { await api.post('/notifications/read-all', {}); toast.success('All marked as read'); refresh(); } catch (e) { toast.error(e.message); } };

  return (
    <ScreenShell title="Notifications" subtitle={unread ? `${unread} unread` : 'All caught up'} refreshing={refreshing} onRefresh={refresh}
      right={unread ? <TouchableOpacity onPress={readAll} style={styles.readAll} accessibilityLabel="Mark all as read"><CheckCheck size={16} color={colors.blue} /><Text style={styles.readAllText}>Read all</Text></TouchableOpacity> : null}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data?.length === 0 ? <EmptyState icon={Bell} title="No notifications yet" sub="Trip assignments, delays and reminders show up here." /> : null}
      {data?.map(n => (
        <Card key={n._id} accentColor={n.readAt ? '#D1D5DB' : SEV[n.severity] ?? colors.blue} onPress={() => read(n)} style={{ padding: 12, opacity: n.readAt ? 0.75 : 1 }}>
          <View style={styles.top}>
            <Text style={styles.title} numberOfLines={2}>{n.title}</Text>
            {!n.readAt ? <View style={[styles.dot, { backgroundColor: SEV[n.severity] ?? colors.blue }]} /> : null}
          </View>
          {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
          <Text style={styles.time}>{timeAgo(n.createdAt)}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  readAll: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 2, borderRadius: 8, borderColor: colors.blue, paddingHorizontal: 8, paddingVertical: 6 },
  readAllText: { fontFamily: FONT.bold, fontSize: 11, fontWeight: '700', color: colors.blue, textTransform: 'uppercase' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  dot: { width: 10, height: 10, borderRadius: 5 },
  body: { fontFamily: FONT.medium, fontSize: 12, color: colors.black, marginTop: 4 },
  time: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted, marginTop: 6 },
});
