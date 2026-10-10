import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertTriangle, Check, Navigation, Phone } from 'lucide-react-native';
import { useTrips } from '../../contexts/TripsContext';
import ScreenShell from '../../components/ScreenShell';
import ManifestList from '../../components/ManifestList';
import ReportSheet from '../../components/ReportSheet';
import { StatusBars } from '../../components/StatusBars';
import { STATUS_COLOR, STATUS_LABEL } from '../../components/TripCard';
import { Button, Card, EmptyState, Notice, SectionTitle, StatusPill, useToast } from '../../components/ui';
import { store } from '../../lib/storage';
import { actionsFor } from '../../lib/tripRules';
import { formatTime } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

const openMaps = stop => {
  const { lat, lng } = stop.location;
  const url = Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(stop.name)}` : `google.navigation:q=${lat},${lng}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`));
};

export default function TripDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const { trips, me, act, recordEvent, emergency, refresh } = useTrips();
  const toast = useToast();
  const trip = trips.find(t => t._id === id);
  const [busy, setBusy] = useState(null);
  const [report, setReport] = useState(null);
  const [reached, setReached] = useState([]);
  const [emergencyResult, setEmergencyResult] = useState(null);
  const a = useMemo(() => (trip ? actionsFor(trip, me?.rules) : null), [trip, me]);
  useEffect(() => { store.get(`reached:${id}`, []).then(setReached); }, [id]);

  if (!trip) return <ScreenShell title="Trip"><EmptyState title="Trip not found" sub="It may have been reassigned. Go back and refresh." /></ScreenShell>;

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(null); }
  };
  const markReached = stop => run(`stop${stop.sequence}`, async () => {
    const r = await recordEvent(trip, { type: 'stop_reached', stopSequence: stop.sequence });
    const next = [...new Set([...reached, stop.sequence])];
    setReached(next);
    await store.set(`reached:${id}`, next);
    toast.info(r.queued ? 'Saved. Will send when you are online.' : `Arrived at ${stop.name}`);
  });
  const confirmEmergency = () => Alert.alert('Raise an emergency?', 'This alerts dispatch and management immediately. Use "Report a problem" for delays and ordinary breakdowns.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes, emergency', style: 'destructive', onPress: () => run('emergency', async () => setEmergencyResult(await emergency(trip, 'Emergency raised from the phone'))) },
  ]);

  const accent = STATUS_COLOR[trip.status] ?? colors.blue;
  const stops = trip.route.stops;
  const nextStop = stops.find(s => !reached.includes(s.sequence));
  const call = me?.contacts?.[0];

  return (
    <ScreenShell title={`${trip.route.code} · ${trip.route.name}`} subtitle={`${trip.tripNumber} · departs ${formatTime(trip.scheduledDeparture)}`}
      right={<StatusPill label={STATUS_LABEL[trip.status] ?? trip.status} color={accent} />} refreshing={false} onRefresh={refresh} edges={[]}>
      <StatusBars navigation={navigation} />
      {emergencyResult ? (
        <Notice tone={emergencyResult.sent ? 'ok' : 'error'} title={emergencyResult.sent ? 'Dispatch has been alerted' : 'NOT SENT yet — you are offline'}
          action={call ? <Button title="Call" color={colors.red} icon={Phone} style={{ minHeight: 38, paddingVertical: 8 }} onPress={() => Linking.openURL(`tel:${call.phone}`)} /> : null}>
          {emergencyResult.sent ? 'Stay safe. Someone will contact you.' : 'It is saved and will send when you reconnect. Phone dispatch or emergency services now.'}
        </Notice>
      ) : null}

      <Card accentColor={accent}>
        <Text style={styles.line}>Vehicle: <Text style={styles.strong}>{trip.vehicle?.registrationNumber ?? 'Not assigned yet'}</Text></Text>
        <Text style={styles.line}>Your role: <Text style={styles.strong}>{trip.myRole}</Text></Text>
        {trip.notes ? <Text style={styles.line}>Notes: <Text style={styles.strong}>{trip.notes}</Text></Text> : null}
        {a.waitingForDispatch ? <Text style={styles.muted}>This trip hasn't been fully assigned yet. Check back soon.</Text> : null}
        {a.ready ? <Button title="I'm ready" color={colors.green} icon={Check} loading={busy === 'ready'} style={styles.gap} onPress={() => run('ready', async () => { await act(trip, 'ready'); toast.success('Dispatch can see you are ready'); })} /> : null}
        {a.start ? <Button title="Start trip" loading={busy === 'start'} style={styles.gap} onPress={() => run('start', async () => { await act(trip, 'start'); toast.success('Trip started. Drive safely.'); })} /> : null}
        {a.startBlockedReason ? <Notice tone="warn">{a.startBlockedReason}</Notice> : null}
        {a.complete ? (
          <Button title="Finish trip" color={colors.orange} loading={busy === 'complete'} style={styles.gap}
            onPress={() => Alert.alert('Finish this trip?', 'Location sharing will stop.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Finish', onPress: () => run('complete', async () => { await act(trip, 'complete'); toast.success('Trip completed'); }) }])} />
        ) : null}
        {trip.status === 'completed' ? <Text style={styles.strong}>This trip is complete. Thank you.</Text> : null}
        {['cancelled', 'aborted'].includes(trip.status) ? <Text style={styles.strong}>This trip was {trip.status}.</Text> : null}
      </Card>

      <SectionTitle title="Stops" sub={nextStop && a.recordStops ? `Next: ${nextStop.name}` : `${stops.length} stops`} />
      <Card style={{ paddingVertical: 4 }}>
        {stops.map((s, i) => {
          const done = reached.includes(s.sequence);
          return (
            <View key={s.sequence} style={[styles.stop, i < stops.length - 1 && styles.stopBorder]}>
              <View style={[styles.dot, { backgroundColor: done ? colors.green : s === nextStop && a.recordStops ? colors.orange : '#fff', borderColor: done ? colors.green : colors.black }]}>
                {done ? <Check size={12} color={colors.white} strokeWidth={3} /> : <Text style={styles.dotText}>{s.sequence}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.stopName, done && { color: colors.muted }]} numberOfLines={1}>{s.name}</Text>
                {s.plannedArrival ? <Text style={styles.muted}>Planned {s.plannedArrival}</Text> : null}
                {a.recordStops && !done ? (
                  <TouchableOpacity onPress={() => markReached(s)} disabled={busy === `stop${s.sequence}`} style={styles.arrived}>
                    <Text style={styles.arrivedText}>{busy === `stop${s.sequence}` ? 'Saving…' : 'Mark arrived'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => openMaps(s)} style={styles.nav} accessibilityLabel={`Navigate to ${s.name}`}>
                <Navigation size={16} color={colors.blue} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          );
        })}
      </Card>

      <ManifestList trip={trip} canRecord={a.boarding} />

      {a.report ? (
        <>
          <SectionTitle title="Report a problem" />
          <View style={styles.reportRow}>
            <Button title="Delay" variant="outline" style={{ flex: 1 }} onPress={() => setReport('delay_reported')} />
            <Button title="Breakdown" variant="outline" style={{ flex: 1 }} onPress={() => setReport('breakdown_reported')} />
            <Button title="Incident" variant="outline" style={{ flex: 1 }} onPress={() => setReport('incident_reported')} />
          </View>
        </>
      ) : null}

      {a.emergency ? <Button title="EMERGENCY" color={colors.red} icon={AlertTriangle} loading={busy === 'emergency'} style={{ marginTop: 14 }} onPress={confirmEmergency} /> : null}
      {call ? <Button title={`Call ${call.name}`} variant="outline" icon={Phone} style={{ marginTop: 10 }} onPress={() => Linking.openURL(`tel:${call.phone}`)} /> : null}

      <ReportSheet kind={report} onClose={() => setReport(null)}
        onSubmit={note => run('report', async () => { const r = await recordEvent(trip, { type: report, notes: note }); toast.info(r.queued ? 'Saved. Will send when you are online.' : 'Reported to dispatch'); await refresh(); })} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: FONT.medium, fontSize: 13, color: colors.muted, marginBottom: 4 },
  strong: { fontFamily: FONT.bold, color: colors.black },
  muted: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted },
  gap: { marginTop: 12 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  stopBorder: { borderBottomWidth: 1, borderBottomColor: '#0000001A' },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontFamily: FONT.bold, fontSize: 11, color: colors.black },
  stopName: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  arrived: { alignSelf: 'flex-start', marginTop: 6, borderWidth: 2, borderRadius: 8, borderColor: colors.black, paddingHorizontal: 10, paddingVertical: 4 },
  arrivedText: { fontFamily: FONT.bold, fontSize: 11, textTransform: 'uppercase', color: colors.black },
  nav: { width: 36, height: 36, borderRadius: 8, borderWidth: 2, borderColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  reportRow: { flexDirection: 'row', gap: 8 },
});
