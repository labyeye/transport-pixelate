import React, { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import TripCard from '../../components/TripCard';
import { EmptyState, FilterPills, LoadingView, Notice, SearchBar } from '../../components/ui';
import { useApi } from '../../lib/useApi';

const ymd = d => d.toLocaleDateString('en-CA');
const DAYS = [
  { value: 'today', label: 'Today', days: 0 },
  { value: 'tomorrow', label: 'Tomorrow', days: 1 },
  { value: 'yesterday', label: 'Yesterday', days: -1 },
];

export default function ManagerTripsScreen({ navigation }) {
  const [day, setDay] = useState('today');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const date = ymd(new Date(Date.now() + DAYS.find(d => d.value === day).days * 86400000));
  const { data, error, loading, refreshing, refresh } = useApi('/trips', { date, limit: 100 }, { interval: 60000 });

  const list = useMemo(() => (data ?? []).filter(t => {
    if (status === 'live' && !['in_progress', 'delayed'].includes(t.status)) return false;
    if (status === 'upcoming' && !['scheduled', 'assigned', 'ready'].includes(t.status)) return false;
    if (status === 'closed' && !['completed', 'cancelled', 'aborted'].includes(t.status)) return false;
    const text = `${t.routeSnapshot.code} ${t.routeSnapshot.name} ${t.tripNumber} ${t.vehicle?.registrationNumber ?? ''} ${t.driver?.name ?? ''}`.toLowerCase();
    return !q || text.includes(q.toLowerCase());
  }), [data, status, q]);

  if (loading) return <LoadingView />;
  return (
    <ScreenShell title="Trips" subtitle={date} refreshing={refreshing} onRefresh={refresh}>
      <FilterPills value={day} onChange={setDay} options={DAYS.map(d => ({ value: d.value, label: d.label }))} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Route, trip, vehicle or driver" />
      <FilterPills value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'closed', label: 'Closed' }]} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.length === 0 && !error ? <EmptyState icon={CalendarClock} title="No trips match" sub="Try another day or filter." /> : null}
      {list.map(t => <TripCard key={t._id} trip={t} onPress={() => navigation.navigate('ManagerTrip', { id: t._id })} />)}
    </ScreenShell>
  );
}
