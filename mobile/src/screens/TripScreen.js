import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Banner, Button, Card, Empty, Field, H, Label, P, Row, Screen, StatusPill } from '../components/ui';
import { StatusBars } from '../components/StatusBars';
import { useTrips } from '../contexts/TripsContext';
import { useSync } from '../contexts/SyncContext';
import { api } from '../lib/api';
import { store } from '../lib/storage';
import { STATUS_LABEL, actionsFor, hhmm } from '../lib/tripRules';
import { colors, FONT } from '../theme';

const openMaps = stop => {
  const { lat, lng } = stop.location;
  const label = encodeURIComponent(stop.name);
  Linking.openURL(Platform.OS === 'ios' ? `maps://?daddr=${lat},${lng}&q=${label}` : `google.navigation:q=${lat},${lng}`).catch(() =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`),
  );
};

function ReportModal({ visible, kind, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const title = { delay_reported: 'Report a delay', breakdown_reported: 'Report a breakdown', incident_reported: 'Report an incident' }[kind];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: colors.white, padding: 16, borderTopWidth: 2, borderColor: colors.black }}>
          <H>{title}</H>
          <P muted style={{ marginBottom: 10 }}>Describe what happened so dispatch can help.</P>
          <Field label="Details" value={note} onChangeText={setNote} multiline placeholder="e.g. Road blocked near the market, about 20 minutes" />
          <Row>
            <Button title="Cancel" variant="secondary" onPress={() => { setNote(''); onClose(); }} style={{ flex: 1 }} />
            <Button title="Send" busy={busy} disabled={note.trim().length < 3} style={{ flex: 1 }}
              onPress={async () => { setBusy(true); try { await onSubmit(note.trim()); setNote(''); onClose(); } finally { setBusy(false); } }} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export default function TripScreen({ route, navigation }) {
  const { id } = route.params;
  const { trips, me, act, recordEvent, emergency, refresh } = useTrips();
  const { online } = useSync();
  const trip = trips.find(t => t._id === id);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [report, setReport] = useState(null);
  const [reached, setReached] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [emergencyResult, setEmergencyResult] = useState(null);

  const rules = me?.rules;
  const a = useMemo(() => (trip ? actionsFor(trip, rules) : null), [trip, rules]);

  useEffect(() => { store.get(`reached:${id}`, []).then(setReached); store.get(`manifest:${id}`, null).then(setManifest); }, [id]);

  const loadManifest = useCallback(async () => {
    if (!online) return;
    try {
      const res = await api.get(`/trips/${id}/manifest`);
      setManifest(res.data);
      await store.set(`manifest:${id}`, res.data);
    } catch { /* keep the cached manifest */ }
  }, [id, online]);
  useEffect(() => { loadManifest(); }, [loadManifest, trip?.status]);

  if (!trip) return <Screen><Empty title="Trip not found">It may have been reassigned. Go back and refresh.</Empty></Screen>;

  const run = async (key, fn) => {
    setBusy(key); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ tone: 'error', text: e.message }); } finally { setBusy(null); }
  };

  const markReached = stop => run(`stop${stop.sequence}`, async () => {
    const r = await recordEvent(trip, { type: 'stop_reached', stopSequence: stop.sequence });
    const next = [...new Set([...reached, stop.sequence])];
    setReached(next);
    await store.set(`reached:${id}`, next);
    if (r.queued) setMsg({ tone: 'info', text: 'Saved. It will be sent when you are back online.' });
  });

  const board = (p, type, stopSequence) => run(`p${p.passenger._id}`, async () => {
    const r = await recordEvent(trip, { type, passenger: p.passenger._id, stopSequence });
    // Show the change straight away; the server confirms (or rejects) when it syncs.
    const status = type === 'passenger_boarded' ? 'boarded' : type === 'passenger_dropped' ? 'dropped' : 'missing';
    const updated = { ...manifest, passengers: manifest.passengers.map(x => (x.passenger._id === p.passenger._id ? { ...x, status } : x)) };
    setManifest(updated);
    await store.set(`manifest:${id}`, updated);
    if (r.queued) setMsg({ tone: 'info', text: 'Saved. It will be sent when you are back online.' });
  });

  const confirmEmergency = () => Alert.alert('Raise an emergency?', 'This alerts dispatch and management immediately. Use "Report" for delays and ordinary breakdowns.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Yes, emergency', style: 'destructive', onPress: () => run('emergency', async () => setEmergencyResult(await emergency(trip, 'Emergency raised from the phone'))) },
  ]);

  const stops = trip.route.stops;
  const nextStop = stops.find(s => !reached.includes(s.sequence));
  const callDispatch = me?.contacts?.[0];

  return (
    <Screen>
      <StatusBars navigation={navigation} />
      <Card accent={colors.blue}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H>{trip.route.code} · {trip.route.name}</H>
          <StatusPill status={trip.status} label={STATUS_LABEL[trip.status]} />
        </Row>
        <P>{trip.tripNumber} · departs {hhmm(trip.scheduledDeparture)} · {trip.vehicle?.registrationNumber ?? 'no vehicle yet'}</P>
        <P muted>You are the {trip.myRole}{trip.notes ? ` · ${trip.notes}` : ''}</P>
      </Card>

      {msg ? <Banner tone={msg.tone === 'error' ? 'error' : 'info'}>{msg.text}</Banner> : null}
      {emergencyResult ? (
        <Banner tone={emergencyResult.sent ? 'ok' : 'error'} title={emergencyResult.sent ? 'Dispatch has been alerted' : 'NOT SENT yet — you are offline'}
          action={callDispatch ? <Button small title={`Call ${callDispatch.name.split(' ')[0]}`} variant="danger" onPress={() => Linking.openURL(`tel:${callDispatch.phone}`)} /> : null}>
          {emergencyResult.sent ? 'Stay safe. Someone will contact you.' : 'It is saved and will send when you reconnect. Phone dispatch or emergency services now.'}
        </Banner>
      ) : null}

      <Card>
        {a.waitingForDispatch ? <P muted>This trip hasn't been fully assigned yet. Check back soon.</P> : null}
        {a.ready ? <Button title="I'm ready" variant="success" busy={busy === 'ready'} onPress={() => run('ready', () => act(trip, 'ready'))} /> : null}
        {a.start ? <Button title="Start trip" busy={busy === 'start'} onPress={() => run('start', () => act(trip, 'start'))} /> : null}
        {a.startBlockedReason ? <Banner tone="warn">{a.startBlockedReason}</Banner> : null}
        {a.complete ? (
          <Button title="Finish trip" variant="warning" busy={busy === 'complete'} style={{ marginTop: a.start || a.ready ? 10 : 0 }}
            onPress={() => Alert.alert('Finish this trip?', 'Location sharing will stop.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Finish', onPress: () => run('complete', () => act(trip, 'complete')) }])} />
        ) : null}
        {trip.status === 'completed' ? <P bold>This trip is complete. Thank you.</P> : null}
        {['cancelled', 'aborted'].includes(trip.status) ? <P bold>This trip was {trip.status}.</P> : null}
      </Card>

      {a.report ? (
        <Card>
          <Label>Report a problem</Label>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button small variant="secondary" title="Delay" onPress={() => setReport('delay_reported')} />
            <Button small variant="secondary" title="Breakdown" onPress={() => setReport('breakdown_reported')} />
            <Button small variant="secondary" title="Incident" onPress={() => setReport('incident_reported')} />
          </Row>
        </Card>
      ) : null}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}><H>Stops</H>{nextStop && a.recordStops ? <P muted>Next: {nextStop.name}</P> : null}</Row>
        {stops.map(s => {
          const done = reached.includes(s.sequence);
          return (
            <View key={s.sequence} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: '#E5E7EB' }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: done ? colors.muted : colors.black }}>{s.sequence}. {s.name}{done ? '  ✓' : ''}</Text>
                  {s.plannedArrival ? <P muted>{s.plannedArrival}</P> : null}
                </View>
                <Row>
                  <Pressable onPress={() => openMaps(s)} accessibilityLabel={`Navigate to ${s.name}`}><Text style={{ fontFamily: FONT.bold, color: colors.blue, textDecorationLine: 'underline' }}>Navigate</Text></Pressable>
                </Row>
              </Row>
              {a.recordStops && !done ? <Button small title="Arrived" variant="secondary" style={{ marginTop: 8 }} busy={busy === `stop${s.sequence}`} onPress={() => markReached(s)} /> : null}
            </View>
          );
        })}
      </Card>

      {manifest && manifest.passengers.length > 0 ? (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <H>Passengers</H>
            <P muted>{manifest.passengers.filter(p => p.status === 'boarded').length}/{manifest.passengers.length} on board</P>
          </Row>
          {manifest.passengers.map(p => (
            <View key={p.passenger._id} style={{ paddingVertical: 10, borderTopWidth: 1, borderColor: '#E5E7EB' }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <P bold>{p.passenger.name}</P>
                  <P muted>{p.pickupStop} → {p.dropStop}</P>
                </View>
                <StatusPill status={p.status === 'boarded' ? 'in_progress' : p.status === 'dropped' ? 'completed' : p.status === 'missing' ? 'cancelled' : 'scheduled'} label={p.status} />
              </Row>
              {a.boarding ? (
                <Row style={{ marginTop: 8 }}>
                  {p.status === 'pending' ? <>
                    <Button small title="Board" style={{ flex: 1 }} busy={busy === `p${p.passenger._id}`} onPress={() => board(p, 'passenger_boarded', p.pickupSequence)} />
                    <Button small title="Missing" variant="secondary" style={{ flex: 1 }} onPress={() => board(p, 'passenger_missing', p.pickupSequence)} />
                  </> : null}
                  {p.status === 'boarded' ? <Button small title="Drop off" variant="success" style={{ flex: 1 }} busy={busy === `p${p.passenger._id}`} onPress={() => board(p, 'passenger_dropped', p.dropSequence)} /> : null}
                </Row>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {a.emergency ? <Button title="EMERGENCY" variant="danger" busy={busy === 'emergency'} onPress={confirmEmergency} style={{ marginTop: 6 }} /> : null}
      {callDispatch ? <Button title={`Call ${callDispatch.name}`} variant="secondary" style={{ marginTop: 10 }} onPress={() => Linking.openURL(`tel:${callDispatch.phone}`)} /> : null}

      <ReportModal visible={!!report} kind={report} onClose={() => setReport(null)}
        onSubmit={note => run('report', async () => { const r = await recordEvent(trip, { type: report, notes: note }); setMsg({ tone: 'info', text: r.queued ? 'Saved. It will be sent when you are back online.' : 'Reported to dispatch.' }); await refresh(); })} />
    </Screen>
  );
}
