import React from 'react';
import { Plus } from 'lucide-react-native';
import { ClipboardList } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Button, Card, EmptyState, LoadingView, Notice, StatusPill } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { timeAgo, titleCase } from '../../lib/format';
import { Text, View } from 'react-native';
import { colors, FONT } from '../../theme/colors';

const STATUS_COLOR = { submitted: colors.blue, under_review: colors.purple, approved: colors.green, rejected: colors.red, in_progress: colors.orange, resolved: colors.green, cancelled: colors.muted };

export default function MyRequestsScreen({ navigation }) {
  const { data, error, loading, refreshing, refresh } = useApi('/requests', { scope: 'mine', limit: 50 });
  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="My requests" subtitle="Ask dispatch for a change" refreshing={refreshing} onRefresh={refresh} edges={[]}>
      <Button title="New request" icon={Plus} onPress={() => navigation.navigate('NewRequest')} style={{ marginBottom: 14 }} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data?.length === 0 ? <EmptyState icon={ClipboardList} title="No requests yet" sub="Requests you send to dispatch appear here with their status." /> : null}
      {data?.map(r => (
        <Card key={r._id} accentColor={STATUS_COLOR[r.status]} style={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONT.bold, fontSize: 14, color: colors.black }}>{r.number} · {titleCase(r.type)}</Text>
              <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.muted }}>{timeAgo(r.createdAt)}</Text>
            </View>
            <StatusPill label={titleCase(r.status)} color={STATUS_COLOR[r.status] ?? colors.muted} />
          </View>
          {r.resolutionNotes ? <Text style={{ fontFamily: FONT.medium, fontSize: 12, color: colors.black, marginTop: 6 }}>{r.resolutionNotes}</Text> : null}
        </Card>
      ))}
    </ScreenShell>
  );
}
