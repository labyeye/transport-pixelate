import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Moon, Sun, CloudSun, Navigation, Truck, Wrench } from 'lucide-react-native';
import { useAuth } from '../../contexts/AuthContext';
import AppHeader from '../../components/AppHeader';
import TripCard from '../../components/TripCard';
import { Card, EmptyState, KpiTile, LoadingView, Notice, SectionTitle } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { colors, FONT } from '../../theme/colors';
import { firstName, formatCurrency, formatDate, greeting } from '../../lib/format';

export default function ManagerDashboardScreen({ navigation }) {
  const { user, can } = useAuth();
  const dash = useApi('/dashboard', undefined, { interval: 60000 });
  const today = new Date().toLocaleDateString('en-CA');
  const trips = useApi('/trips', { date: today, limit: 10 }, { enabled: can('trips:read'), interval: 60000 });
  if (dash.loading) return <LoadingView />;
  const d = dash.data;
  const h = new Date().getHours();
  const GreetIcon = h < 12 ? Sun : h < 17 ? CloudSun : Moon;
  const greetColor = h < 12 ? colors.orange : h < 17 ? colors.blue : colors.purple;

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={dash.refreshing} tintColor={colors.blue} onRefresh={() => { dash.refresh(); trips.refresh(); }} />}>
        <AppHeader />
        <View style={styles.greetRow}>
          <Text style={styles.greeting} numberOfLines={1}>{greeting()}, {firstName(user?.name)}</Text>
          <GreetIcon size={30} color={greetColor} strokeWidth={2.5} />
        </View>
        {dash.error ? <Notice tone="error">{dash.error}</Notice> : null}
        {d?.requests?.pending > 0 ? (
          <Notice tone="warn" title={`${d.requests.pending} request${d.requests.pending === 1 ? '' : 's'} waiting for review`} />
        ) : null}
        {d ? (
          <View style={styles.kpiGrid}>
            <KpiTile label="Trips today" value={d.trips.today} color={colors.blue} solid icon={CalendarClock} />
            <KpiTile label="In progress" value={d.trips.inProgress} color={colors.orange} solid icon={Navigation} />
            <KpiTile label="Completed today" value={d.trips.completed} color={colors.green} solid icon={CheckCircle2} />
            <KpiTile label="Delayed / cancelled" value={d.trips.delayed + d.trips.cancelled} color={colors.red} solid icon={AlertTriangle} />
            <KpiTile label="Vehicles available" value={d.vehicles.available} color={colors.blue} solid icon={Truck} />
            <KpiTile label="In workshop" value={d.maintenance?.inWorkshop ?? d.vehicles.maintenance} color={colors.purple} solid icon={Wrench} />
            {d.costs ? <KpiTile label="Fuel this month" value={formatCurrency(d.costs.fuel)} color={colors.orange} solid icon={Truck} /> : null}
            {d.costs ? <KpiTile label="Pending expenses" value={d.costs.pendingExpenses} color={colors.purple} solid icon={ClipboardList} /> : null}
          </View>
        ) : null}

        {d?.expiries?.length ? (
          <>
            <SectionTitle title="Documents needing attention" sub="Expired or expiring in 30 days" />
            {d.expiries.slice(0, 5).map((e, i) => {
              const c = e.expired ? colors.red : colors.orange;
              return (
                <Card key={i} accentColor={c} style={{ padding: 12 }}>
                  <Text style={styles.docName} numberOfLines={1}>{e.label} · <Text style={{ textTransform: 'capitalize' }}>{e.document}</Text></Text>
                  <Text style={[styles.docSub, { color: c }]}>{e.expired ? 'Expired' : 'Expires'} {formatDate(e.expiryDate)}</Text>
                </Card>
              );
            })}
          </>
        ) : null}

        {can('trips:read') ? (
          <>
            <SectionTitle title="Today's trips" sub={trips.data ? `${trips.data.length} shown` : undefined} />
            {(trips.data ?? []).map(t => <TripCard key={t._id} trip={t} onPress={() => navigation.navigate('ManagerTrip', { id: t._id })} />)}
            {trips.data && trips.data.length === 0 ? <Card><EmptyState icon={CalendarClock} title="No trips today" /></Card> : null}
          </>
        ) : null}
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
  docName: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  docSub: { fontFamily: FONT.bold, fontSize: 12, marginTop: 2 },
});
