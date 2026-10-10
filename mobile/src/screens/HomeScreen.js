import React from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { Card, Empty, H, P, Row, Screen, StatusPill } from '../components/ui';
import { StatusBars } from '../components/StatusBars';
import { useAuth } from '../contexts/AuthContext';
import { useTrips } from '../contexts/TripsContext';
import { STATUS_LABEL, hhmm } from '../lib/tripRules';
import { colors, FONT } from '../theme';

const dayLabel = (d, today) => (d === today ? 'Today' : new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const { me, trips, loading, refresh, error } = useTrips();
  const [refreshing, setRefreshing] = React.useState(false);
  const today = new Date().toLocaleDateString('en-CA');
  const groups = trips.reduce((acc, t) => { (acc[t.scheduledDate] ??= []).push(t); return acc; }, {});
  const days = Object.keys(groups).sort();
  const live = trips.find(t => ['in_progress', 'delayed'].includes(t.status));

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}>
      <View style={{ marginBottom: 14 }}>
        <Text style={{ fontFamily: FONT.bold, fontSize: 24, color: colors.black }}>Hi, {user.name.split(' ')[0]}</Text>
        <P muted>{me?.vehicle?.registrationNumber ? `Vehicle ${me.vehicle.registrationNumber} · ` : ''}{me?.driver?.status ? `Duty: ${me.driver.status.replace('_', ' ')}` : me?.organization?.name}</P>
      </View>
      <StatusBars navigation={navigation} />
      {error ? <P style={{ color: colors.red }}>{error}</P> : null}
      {live ? (
        <Card accent={colors.orange} onPress={() => navigation.navigate('Trip', { id: live._id })}>
          <Row style={{ justifyContent: 'space-between' }}><H>Trip in progress</H><StatusPill status={live.status} label={STATUS_LABEL[live.status]} /></Row>
          <P>{live.tripNumber} · {live.route.code} · {live.route.name}</P>
          <P muted>Tap to continue</P>
        </Card>
      ) : null}
      {loading ? <P muted>Loading your trips…</P> : null}
      {!loading && trips.length === 0 ? <Empty title="No trips assigned">When dispatch assigns you a trip it will appear here. Pull down to refresh.</Empty> : null}
      {days.map(d => (
        <View key={d}>
          <Text style={{ fontFamily: FONT.bold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginTop: 6, color: colors.black }}>{dayLabel(d, today)}</Text>
          {groups[d].filter(t => t._id !== live?._id).map(t => (
            <Card key={t._id} onPress={() => navigation.navigate('Trip', { id: t._id })}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: FONT.bold, fontSize: 22, color: colors.black }}>{hhmm(t.scheduledDeparture)}</Text>
                <StatusPill status={t.status} label={STATUS_LABEL[t.status]} />
              </Row>
              <P bold>{t.route.code} · {t.route.name}</P>
              <P muted>{t.route.stops.length} stops · {t.vehicle?.registrationNumber ?? 'No vehicle yet'} · you are the {t.myRole}</P>
            </Card>
          ))}
        </View>
      ))}
    </Screen>
  );
}
