import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarClock, CheckCircle2, Clock, Moon, Sun, CloudSun, Truck } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useTrips } from '../../contexts/TripsContext';
import AppHeader from '../../components/AppHeader';
import TripCard, { STATUS_LABEL } from '../../components/TripCard';
import { StatusBars } from '../../components/StatusBars';
import { Card, EmptyState, KpiTile, LoadingView, SectionTitle, StatusPill } from '../../components/ui';
import { colors, FONT } from '../../theme/colors';
import { firstName, formatTime, greeting } from '../../lib/format';

export default function CrewHomeScreen({ navigation }) {
  const { user } = useAuth();
  const { me, trips, loading, refresh, error } = useTrips();
  const [refreshing, setRefreshing] = React.useState(false);
  if (loading && !me && trips.length === 0) return <LoadingView />;

  const today = new Date().toLocaleDateString('en-CA');
  const todays = trips.filter(t => t.scheduledDate === today);
  const live = trips.find(t => ['in_progress', 'delayed'].includes(t.status));
  const next = todays.find(t => ['assigned', 'ready', 'scheduled'].includes(t.status));
  const done = todays.filter(t => t.status === 'completed').length;
  const h = new Date().getHours();
  const GreetIcon = h < 12 ? Sun : h < 17 ? CloudSun : Moon;
  const greetColor = h < 12 ? colors.orange : h < 17 ? colors.blue : colors.purple;

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.blue} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
        <AppHeader />
        <View style={styles.greetRow}>
          <Text style={styles.greeting} numberOfLines={1}>{greeting()}, {firstName(user?.name)}</Text>
          <GreetIcon size={30} color={greetColor} strokeWidth={2.5} />
        </View>
        <StatusBars navigation={navigation} />
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.kpiGrid}>
          <KpiTile label="Trips today" value={todays.length} color={colors.blue} solid icon={CalendarClock} />
          <KpiTile label="Completed" value={done} color={colors.green} solid icon={CheckCircle2} />
          <KpiTile label="Next departure" value={next ? formatTime(next.scheduledDeparture) : '—'} color={colors.orange} solid icon={Clock} />
          <KpiTile label="Vehicle" value={me?.vehicle?.registrationNumber ?? live?.vehicle?.registrationNumber ?? next?.vehicle?.registrationNumber ?? '—'} color={colors.purple} solid icon={Truck} />
        </View>

        {live ? (
          <>
            <SectionTitle title="Trip in progress" sub="Tap to continue" />
            <TripCard trip={live} onPress={() => navigation.navigate('Trip', { id: live._id })} />
          </>
        ) : null}

        <SectionTitle title="Today's trips" sub={todays.length ? `${todays.length} scheduled` : undefined} />
        {todays.filter(t => t._id !== live?._id).map(t => <TripCard key={t._id} trip={t} onPress={() => navigation.navigate('Trip', { id: t._id })} />)}
        {todays.length === 0 ? (
          <Card><EmptyState icon={CalendarClock} title="No trips today" sub="When dispatch assigns you a trip it appears here. Pull down to refresh." /></Card>
        ) : null}
        {trips.some(t => t.scheduledDate > today) ? (
          <TouchableOpacity onPress={() => navigation.navigate('Trips')} style={styles.more}>
            <Text style={styles.moreText}>See upcoming trips →</Text>
          </TouchableOpacity>
        ) : null}
        <View style={{ height: 4 }} />
        {me?.driver?.status ? <StatusPill label={`Duty: ${STATUS_LABEL[me.driver.status] ?? me.driver.status.replace('_', ' ')}`} color={colors.blue} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  content: { padding: 16, paddingBottom: 32 },
  greetRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 6 },
  greeting: { flexShrink: 1, fontSize: 23, fontFamily: FONT.bold, fontWeight: '800', color: colors.black },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  error: { fontFamily: FONT.medium, color: colors.red, marginBottom: 8 },
  more: { alignItems: 'center', paddingVertical: 10 },
  moreText: { fontFamily: FONT.bold, color: colors.blue, fontWeight: '700' },
});
