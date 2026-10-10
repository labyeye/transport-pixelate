import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Button, Card, EmptyState, LoadingView, Notice, SearchBar, StatPills, StatusPill } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { timeAgo } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

// Same thresholds the server and web use; recomputed locally so a silent vehicle turns stale on its own.
const freshness = (iso, now) => {
  if (!iso) return 'no_signal';
  const age = now - new Date(iso).getTime();
  return age <= 120000 ? 'live' : age <= 900000 ? 'stale' : 'offline';
};
const COLOR = { live: colors.green, stale: '#B7791F', offline: colors.muted, no_signal: colors.muted };
const LABEL = { live: 'Live', stale: 'Stale', offline: 'Offline', no_signal: 'No signal' };

export default function LiveVehiclesScreen() {
  const { data, meta, error, loading, refreshing, refresh } = useApi('/tracking/vehicles', undefined, { interval: 20000 });
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(t); }, []);

  const rows = useMemo(() => (data ?? []).map(r => ({ ...r, fresh: freshness(r.position?.recordedAt, now) })), [data, now]);
  const counts = rows.reduce((c, r) => ({ ...c, [r.fresh]: (c[r.fresh] ?? 0) + 1 }), {});
  const list = rows.filter(r => (filter === 'all' || r.fresh === filter) && (!q || `${r.vehicle.registrationNumber} ${r.trip?.driver?.name ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="Live vehicles" subtitle="From GPS devices and drivers' phones during trips" refreshing={refreshing} onRefresh={refresh}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {meta && meta.sourceConfigured === false ? <Notice tone="warn" title="No GPS source connected">Locations will appear once a tracker is registered or a driver starts a trip.</Notice> : null}
      <StatPills value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: rows.length },
        { value: 'live', label: 'Live', count: counts.live ?? 0, color: colors.green },
        { value: 'stale', label: 'Stale', count: counts.stale ?? 0, color: '#B7791F' },
        { value: 'offline', label: 'Offline', count: (counts.offline ?? 0) + (counts.no_signal ?? 0), color: colors.muted },
      ]} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Vehicle or driver" />
      {list.length === 0 ? <EmptyState icon={MapPin} title="No vehicles match" /> : null}
      {list.map(r => {
        const c = COLOR[r.fresh];
        const p = r.position;
        return (
          <Card key={r.vehicle._id} accentColor={c} style={{ padding: 12 }}>
            <View style={styles.top}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{r.vehicle.registrationNumber}</Text>
                <Text style={styles.sub} numberOfLines={1}>{r.trip ? `${r.trip.tripNumber} · ${r.trip.driver?.name ?? 'No driver'}` : 'Not on a trip'}</Text>
              </View>
              <StatusPill label={LABEL[r.fresh]} color={c} />
            </View>
            <Text style={styles.sub}>
              {p ? `Updated ${timeAgo(p.recordedAt, now)}${p.speedKmh != null ? ` · ${Math.round(p.speedKmh)} km/h` : ''}` : 'No location received yet'}
            </Text>
            {p && r.fresh !== 'live' ? <Text style={[styles.sub, { color: colors.red }]}>Last known position, not current.</Text> : null}
            {r.trip?.nextStop ? <Text style={styles.sub}>Next stop: {r.trip.nextStop}</Text> : null}
            {p ? <Button title="Open in Maps" variant="outline" icon={MapPin} style={{ marginTop: 10, minHeight: 40, paddingVertical: 8 }} onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`)} /> : null}
          </Card>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  name: { fontFamily: FONT.bold, fontSize: 15, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 1 },
});
