import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Truck, Users } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Avatar, Card, EmptyState, FilterPills, LoadingView, Notice, SearchBar, StatusPill } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { formatDate, titleCase } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

const V_COLOR = { available: colors.green, assigned: colors.blue, on_trip: colors.orange, maintenance: '#B7791F', out_of_service: colors.red, inactive: colors.muted };
const D_COLOR = { active: colors.green, on_duty: colors.orange, off_duty: colors.muted, on_leave: '#B7791F', suspended: colors.red, inactive: colors.muted };

const soonest = dates => dates.filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b)[0];
const expiryColor = d => (!d ? colors.muted : d < new Date() ? colors.red : d < new Date(Date.now() + 30 * 86400000) ? colors.orange : colors.muted);

export function VehiclesScreen() {
  const { data, error, loading, refreshing, refresh } = useApi('/vehicles', { limit: 100 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const list = useMemo(() => (data ?? []).filter(v => (status === 'all' || v.status === status) && (!q || `${v.registrationNumber} ${v.make ?? ''} ${v.model ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);
  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="Vehicles" subtitle={`${data?.length ?? 0} in the fleet`} refreshing={refreshing} onRefresh={refresh}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Registration, make or model" />
      <FilterPills value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...Object.keys(V_COLOR).map(k => ({ value: k, label: titleCase(k) }))]} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.length === 0 && !error ? <EmptyState icon={Truck} title="No vehicles match" /> : null}
      {list.map(v => {
        const exp = soonest(Object.values(v.documents ?? {}).map(d => d?.expiryDate));
        return (
          <Card key={v._id} accentColor={V_COLOR[v.status]} style={{ padding: 12 }}>
            <View style={styles.top}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{v.registrationNumber}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[v.make, v.model].filter(Boolean).join(' ') || v.category} · {v.capacity} seats</Text>
              </View>
              <StatusPill label={titleCase(v.status)} color={V_COLOR[v.status] ?? colors.muted} />
            </View>
            <View style={styles.meta}>
              <Text style={styles.sub}>Driver: <Text style={styles.strong}>{v.assignedDriver?.name ?? '—'}</Text></Text>
              <Text style={styles.sub}>Odometer: <Text style={styles.strong}>{(v.odometer ?? 0).toLocaleString('en-IN')} km</Text></Text>
              <Text style={styles.sub}>Next expiry: <Text style={[styles.strong, { color: expiryColor(exp) }]}>{exp ? formatDate(exp) : '—'}</Text></Text>
            </View>
          </Card>
        );
      })}
    </ScreenShell>
  );
}

export function DriversScreen() {
  const { data, error, loading, refreshing, refresh } = useApi('/drivers', { limit: 100 });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const list = useMemo(() => (data ?? []).filter(d => (status === 'all' || d.status === status) && (!q || `${d.name} ${d.phone} ${d.licence?.number ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);
  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="Drivers & staff" subtitle={`${data?.length ?? 0} people`} refreshing={refreshing} onRefresh={refresh}>
      <SearchBar value={q} onChangeText={setQ} placeholder="Name, phone or licence" />
      <FilterPills value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...Object.keys(D_COLOR).map(k => ({ value: k, label: titleCase(k) }))]} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.length === 0 && !error ? <EmptyState icon={Users} title="No one matches" /> : null}
      {list.map(d => {
        const exp = d.licence?.expiryDate ? new Date(d.licence.expiryDate) : null;
        return (
          <Card key={d._id} accentColor={D_COLOR[d.status]} style={{ padding: 12 }}>
            <View style={styles.top}>
              <Avatar name={d.name} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{titleCase(d.staffRole)} · {d.phone}</Text>
              </View>
              <StatusPill label={titleCase(d.status)} color={D_COLOR[d.status] ?? colors.muted} />
            </View>
            <View style={styles.meta}>
              <Text style={styles.sub}>Vehicle: <Text style={styles.strong}>{d.assignedVehicle?.registrationNumber ?? '—'}</Text></Text>
              {d.licence?.number ? <Text style={styles.sub}>Licence: <Text style={[styles.strong, { color: expiryColor(exp) }]}>{d.licence.number} · {exp ? formatDate(exp) : '—'}</Text></Text> : null}
            </View>
          </Card>
        );
      })}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: FONT.bold, fontSize: 15, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 1 },
  strong: { fontFamily: FONT.bold, color: colors.black },
  meta: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#0000001A' },
});
