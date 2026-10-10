import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Button, Card, EmptyState, LoadingView, Notice, StatusPill, TextField, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { timeAgo, titleCase } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

const PRIORITY_COLOR = { low: colors.muted, normal: colors.blue, high: colors.orange, urgent: colors.red };

function RequestCard({ r, onChanged }) {
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async fn => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e) { setErr(e.errors?.length ? `${e.message}: ${e.errors.join('; ')}` : e.message); } finally { setBusy(false); }
  };
  const open = () => run(async () => {
    if (r.status === 'submitted') await api.post(`/requests/${r._id}/start-review`, {});
    setPreview((await api.get(`/requests/${r._id}/preview`)).data);
  });
  const decide = decision => run(async () => {
    await api.post(`/requests/${r._id}/review`, { decision, note: note.trim() || undefined });
    toast.success(decision === 'approved' ? 'Approved and applied' : 'Rejected');
    await onChanged();
  });
  return (
    <Card accentColor={PRIORITY_COLOR[r.priority]}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{r.number} · {titleCase(r.type)}</Text>
          <Text style={styles.sub}>By {r.requester?.name} · {timeAgo(r.createdAt)}</Text>
        </View>
        <StatusPill label={titleCase(r.status)} color={r.status === 'under_review' ? colors.purple : colors.blue} />
      </View>
      {err ? <Notice tone="error">{err}</Notice> : null}
      {!preview ? (
        <Button title="Review" loading={busy} style={{ marginTop: 10 }} onPress={open} />
      ) : (
        <View style={{ marginTop: 10 }}>
          <Notice tone={preview.canApply ? 'ok' : 'warn'} title={preview.canApply ? 'Can be applied' : 'Cannot be applied right now'}>
            {preview.problems.map(p => p.message).join('\n') || Object.entries(preview.impact).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </Notice>
          <TextField label="Note (required to reject)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Reject" color={colors.red} variant="outline" style={{ flex: 1 }} disabled={!note.trim()} loading={busy} onPress={() => decide('rejected')} />
            <Button title="Approve" style={{ flex: 1 }} disabled={!preview.canApply} loading={busy} onPress={() => decide('approved')} />
          </View>
        </View>
      )}
    </Card>
  );
}

export default function RequestsReviewScreen() {
  const { data, error, loading, refreshing, refresh } = useApi('/requests', { scope: 'review' }, { interval: 60000 });
  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="Requests to review" subtitle="Impact is checked before anything changes" refreshing={refreshing} onRefresh={refresh}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data?.length === 0 ? <EmptyState icon={ClipboardList} title="Nothing to review" sub="New requests appear here." /> : null}
      {data?.map(r => <RequestCard key={r._id} r={r} onChanged={refresh} />)}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 1 },
});
