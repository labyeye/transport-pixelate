import React, { useState } from 'react';
import { Users } from 'lucide-react-native';
import { useTrips } from '../../contexts/TripsContext';
import ScreenShell from '../../components/ScreenShell';
import ManifestList from '../../components/ManifestList';
import { StatusBars } from '../../components/StatusBars';
import { EmptyState, FilterPills, LoadingView } from '../../components/ui';
import { actionsFor } from '../../lib/tripRules';
import { formatTime } from '../../lib/format';

// Tab for the person on the bus: the passenger list of the running trip (or the next one today).
export default function PassengersScreen({ navigation }) {
  const { trips, me, loading, refresh } = useTrips();
  const [picked, setPicked] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const candidates = trips.filter(t => t.scheduledDate === today && !['cancelled', 'aborted'].includes(t.status));
  const trip = candidates.find(t => t._id === picked) ?? candidates.find(t => ['in_progress', 'delayed'].includes(t.status)) ?? candidates.find(t => ['ready', 'assigned', 'scheduled'].includes(t.status)) ?? candidates[0];
  if (loading && trips.length === 0) return <LoadingView />;

  return (
    <ScreenShell title="Passengers" subtitle={trip ? `${trip.route.code} · ${formatTime(trip.scheduledDeparture)}` : 'Boarding list'}
      refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }}>
      <StatusBars navigation={navigation} />
      {candidates.length > 1 ? (
        <FilterPills value={trip?._id} onChange={setPicked} options={candidates.map(t => ({ value: t._id, label: `${t.route.code} ${formatTime(t.scheduledDeparture)}` }))} />
      ) : null}
      {trip ? <ManifestList key={trip._id} trip={trip} canRecord={actionsFor(trip, me?.rules).boarding} /> : <EmptyState icon={Users} title="No trip today" sub="The passenger list appears here when you have a trip." />}
    </ScreenShell>
  );
}
