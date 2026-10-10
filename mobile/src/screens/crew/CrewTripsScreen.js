import React, { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react-native';
import { useTrips } from '../../contexts/TripsContext';
import ScreenShell from '../../components/ScreenShell';
import TripCard from '../../components/TripCard';
import { StatusBars } from '../../components/StatusBars';
import { EmptyState, FilterPills, LoadingView, SearchBar } from '../../components/ui';

const DONE = ['completed', 'cancelled', 'aborted'];

export default function CrewTripsScreen({ navigation }) {
  const { trips, loading, refresh } = useTrips();
  const [filter, setFilter] = useState('today');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');

  const list = useMemo(() => trips.filter(t => {
    const text = `${t.route.code} ${t.route.name} ${t.tripNumber} ${t.vehicle?.registrationNumber ?? ''}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (filter === 'today') return t.scheduledDate === today;
    if (filter === 'upcoming') return t.scheduledDate > today && !DONE.includes(t.status);
    if (filter === 'done') return DONE.includes(t.status);
    return true;
  }), [trips, filter, q, today]);

  if (loading && trips.length === 0) return <LoadingView />;
  const count = f => trips.filter(t => (f === 'today' ? t.scheduledDate === today : f === 'upcoming' ? t.scheduledDate > today && !DONE.includes(t.status) : f === 'done' ? DONE.includes(t.status) : true)).length;

  return (
    <ScreenShell title="My trips" subtitle="Today and the next 7 days" refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
      <StatusBars navigation={navigation} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search route, trip or vehicle" />
      <FilterPills value={filter} onChange={setFilter} options={[{ value: 'today', label: 'Today', count: count('today') }, { value: 'upcoming', label: 'Upcoming', count: count('upcoming') }, { value: 'done', label: 'Finished', count: count('done') }, { value: 'all', label: 'All' }]} />
      {list.length === 0 ? <EmptyState icon={CalendarClock} title="No trips here" sub="Try another filter, or pull down to refresh." /> : null}
      {list.map(t => <TripCard key={t._id} trip={t} onPress={() => navigation.navigate('Trip', { id: t._id })} />)}
    </ScreenShell>
  );
}
