import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Users } from 'lucide-react-native';
import { Button, Card, EmptyState, SectionTitle, StatusPill, useToast } from './ui';
import { api } from '../lib/api';
import { store } from '../lib/storage';
import { useSync } from '../contexts/SyncContext';
import { useTrips } from '../contexts/TripsContext';
import { colors, FONT } from '../theme/colors';

const PASSENGER_COLOR = { pending: colors.muted, boarded: colors.blue, dropped: colors.green, missing: colors.red };

/** Passenger list for a trip with boarding controls. Marks are shown immediately and queued when offline. */
export default function ManifestList({ trip, canRecord }) {
  const { online } = useSync();
  const { recordEvent } = useTrips();
  const toast = useToast();
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => { store.get(`manifest:${trip._id}`, null).then(m => m && setManifest(m)); }, [trip._id]);
  const load = useCallback(async () => {
    if (!online) return;
    try {
      const res = await api.get(`/trips/${trip._id}/manifest`);
      setManifest(res.data);
      await store.set(`manifest:${trip._id}`, res.data);
    } catch { /* keep the cached manifest */ }
  }, [trip._id, online]);
  useEffect(() => { load(); }, [load, trip.status]);

  const mark = async (p, type, stopSequence) => {
    setBusy(p.passenger._id);
    try {
      const r = await recordEvent(trip, { type, passenger: p.passenger._id, stopSequence });
      const status = type === 'passenger_boarded' ? 'boarded' : type === 'passenger_dropped' ? 'dropped' : 'missing';
      const next = { ...manifest, passengers: manifest.passengers.map(x => (x.passenger._id === p.passenger._id ? { ...x, status } : x)) };
      setManifest(next);
      await store.set(`manifest:${trip._id}`, next);
      toast.info(r.queued ? 'Saved. Will send when you are online.' : `${p.passenger.name.split(' ')[0]}: ${status}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!manifest) return null;
  const rows = manifest.passengers;
  if (rows.length === 0) return <Card><EmptyState icon={Users} title="No passengers assigned" sub="Passengers appear once they are assigned to this route." /></Card>;
  const onBoard = rows.filter(p => p.status === 'boarded').length;

  return (
    <View>
      <SectionTitle title="Passengers" sub={`${onBoard} of ${rows.length} on board`} />
      {rows.map(p => {
        const c = PASSENGER_COLOR[p.status] ?? colors.muted;
        return (
          <Card key={p.passenger._id} accentColor={c} style={{ padding: 12 }}>
            <View style={styles.top}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{p.passenger.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{p.pickupStop} → {p.dropStop}{p.passenger.grade ? ` · ${p.passenger.grade}` : ''}</Text>
              </View>
              <StatusPill label={p.status} color={c} />
            </View>
            {canRecord ? (
              <View style={styles.actions}>
                {p.status === 'pending' ? (
                  <>
                    <Button title="Board" style={{ flex: 1, minHeight: 42, paddingVertical: 8 }} loading={busy === p.passenger._id} onPress={() => mark(p, 'passenger_boarded', p.pickupSequence)} />
                    <Button title="Missing" variant="outline" style={{ flex: 1, minHeight: 42, paddingVertical: 8 }} onPress={() => mark(p, 'passenger_missing', p.pickupSequence)} />
                  </>
                ) : null}
                {p.status === 'boarded' ? <Button title="Drop off" color={colors.green} style={{ flex: 1, minHeight: 42, paddingVertical: 8 }} loading={busy === p.passenger._id} onPress={() => mark(p, 'passenger_dropped', p.dropSequence)} /> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
