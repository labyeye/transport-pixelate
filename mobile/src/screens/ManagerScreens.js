import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { Banner, Button, Card, Empty, Field, H, Label, P, Row, Screen, StatusPill } from '../components/ui';
import { api } from '../lib/api';
import { STATUS_LABEL, hhmm } from '../lib/tripRules';
import { colors, FONT } from '../theme';

const Stat = ({ label, value, tone }) => (
  <View style={{ flexBasis: '48%', flexGrow: 1, borderWidth: 2, borderColor: colors.black, backgroundColor: colors.white, padding: 12 }}>
    <Text style={{ fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1, color: colors.muted, textTransform: 'uppercase' }}>{label}</Text>
    <Text style={{ fontFamily: FONT.bold, fontSize: 28, color: tone ?? colors.black }}>{value}</Text>
  </View>
);

function useLoad(fn) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    try { setData(await fn()); setError(null); } catch (e) { setError(e.network ? "Can't reach the server." : e.message); }
  }, [fn]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  return { data, error, refresh, refreshing };
}

export function ManagerOverview() {
  const fn = useCallback(async () => {
    const [dash, trips] = await Promise.all([api.get('/dashboard'), api.get('/trips', { }).catch(() => ({ data: [] }))]);
    return { dash: dash.data, trips: trips.data };
  }, []);
  const { data, error, refresh, refreshing } = useLoad(fn);
  const d = data?.dash;
  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!d && !error ? <P muted>Loading…</P> : null}
      {d ? (
        <>
          <Row style={{ flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <Stat label="Trips today" value={d.trips.today} />
            <Stat label="In progress" value={d.trips.inProgress} tone={colors.orange} />
            <Stat label="Delayed / cancelled" value={d.trips.delayed + d.trips.cancelled} tone={colors.red} />
            <Stat label="Completed" value={d.trips.completed} tone={colors.green} />
            <Stat label="Vehicles available" value={d.vehicles.available} />
            <Stat label="In workshop" value={d.vehicles.maintenance} tone="#D97706" />
          </Row>
          {d.requests ? <Banner tone={d.requests.pending ? 'warn' : 'ok'} title={`${d.requests.pending} request${d.requests.pending === 1 ? '' : 's'} waiting for review`} /> : null}
          {d.expiries.length ? (
            <Card accent={colors.red}>
              <Label>Documents needing attention</Label>
              {d.expiries.slice(0, 6).map((e, i) => <P key={i}>{e.label} · {e.document} · {e.expired ? 'expired' : 'expires'} {new Date(e.expiryDate).toLocaleDateString('en-IN')}</P>)}
            </Card>
          ) : null}
        </>
      ) : null}
      {data ? <H style={{ marginBottom: 8 }}>Trips</H> : null}
      {data?.trips.length === 0 ? <Empty title="No trips found" /> : null}
      {data?.trips.slice(0, 30).map(t => (
        <Card key={t._id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <P bold>{t.routeSnapshot.code} · {hhmm(t.scheduledDeparture)}</P>
            <StatusPill status={t.status} label={STATUS_LABEL[t.status]} />
          </Row>
          <P muted>{t.scheduledDate} · {t.vehicle?.registrationNumber ?? 'No vehicle'} · {t.driver?.name ?? 'No driver'}</P>
        </Card>
      ))}
    </Screen>
  );
}

function RequestCard({ r, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async fn => { setBusy(true); setErr(''); try { await fn(); await onChanged(); } catch (e) { setErr(e.errors?.length ? `${e.message}: ${e.errors.join('; ')}` : e.message); } finally { setBusy(false); } };
  const open = () => run(async () => { if (r.status === 'submitted') await api.post(`/requests/${r._id}/start-review`, {}); setPreview((await api.get(`/requests/${r._id}/preview`)).data); });
  return (
    <Card accent={r.priority === 'urgent' ? colors.red : undefined}>
      <Row style={{ justifyContent: 'space-between' }}><P bold>{r.number}</P><StatusPill status={r.status === 'under_review' ? 'assigned' : 'scheduled'} label={r.status.replace('_', ' ')} /></Row>
      <P>{r.type.replace(/_/g, ' ')} · {r.priority}</P>
      <P muted>By {r.requester?.name}</P>
      {err ? <Banner tone="error">{err}</Banner> : null}
      {!preview ? <Button small title="Review" onPress={open} busy={busy} style={{ marginTop: 8 }} /> : (
        <View style={{ marginTop: 8 }}>
          <Banner tone={preview.canApply ? 'ok' : 'warn'} title={preview.canApply ? 'Can be applied' : 'Cannot be applied right now'}>
            {preview.problems.map(p => p.message).join('\n') || Object.entries(preview.impact).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </Banner>
          <Field label="Note (required to reject)" value={note} onChangeText={setNote} />
          <Row>
            <Button small title="Reject" variant="danger" style={{ flex: 1 }} disabled={!note.trim()} busy={busy} onPress={() => run(() => api.post(`/requests/${r._id}/review`, { decision: 'rejected', note }))} />
            <Button small title="Approve" style={{ flex: 1 }} disabled={!preview.canApply} busy={busy} onPress={() => run(() => api.post(`/requests/${r._id}/review`, { decision: 'approved', note: note || undefined }))} />
          </Row>
        </View>
      )}
    </Card>
  );
}

export function ManagerRequests() {
  const fn = useCallback(async () => (await api.get('/requests', { scope: 'review' })).data, []);
  const { data, error, refresh, refreshing } = useLoad(fn);
  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {data && data.length === 0 ? <Empty title="Nothing to review">New requests appear here.</Empty> : null}
      {data?.map(r => <RequestCard key={r._id} r={r} onChanged={refresh} />)}
    </Screen>
  );
}
