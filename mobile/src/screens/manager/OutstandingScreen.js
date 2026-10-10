import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Receipt, Wallet } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Card, EmptyState, KpiTile, LoadingView, Notice, SectionTitle } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { formatMinor } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

export default function OutstandingScreen() {
  const { data, error, loading, refreshing, refresh } = useApi('/billing/outstanding');
  if (loading) return <LoadingView />;
  if (error && /not enabled/i.test(error)) return <ScreenShell title="Outstanding fees"><EmptyState icon={Receipt} title="Fees are switched off" sub="An owner can turn on Transport fees in the web app settings." /></ScreenShell>;
  const t = data?.totals;
  return (
    <ScreenShell title="Outstanding fees" subtitle="Unpaid balances by passenger" refreshing={refreshing} onRefresh={refresh}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {t ? (
        <View style={styles.grid}>
          <KpiTile label="Total outstanding" value={formatMinor(t.balance)} color={colors.red} solid icon={Wallet} />
          <KpiTile label="Not yet due" value={formatMinor(t.current)} color={colors.blue} solid icon={Receipt} />
          <KpiTile label="1–30 days late" value={formatMinor(t.d1_30)} color={colors.orange} solid icon={Receipt} />
          <KpiTile label="Over 30 days late" value={formatMinor(t.d31_60 + t.d61_plus)} color={colors.red} solid icon={Receipt} />
        </View>
      ) : null}
      <SectionTitle title="By passenger" />
      {data?.rows.length === 0 ? <EmptyState icon={Receipt} title="Nothing outstanding" sub="All issued invoices are paid." /> : null}
      {data?.rows.map(r => (
        <Card key={r.passenger._id} accentColor={r.d31_60 + r.d61_plus > 0 ? colors.red : r.d1_30 > 0 ? colors.orange : colors.blue} style={{ padding: 12 }}>
          <View style={styles.top}>
            <Text style={styles.name} numberOfLines={1}>{r.passenger.name}</Text>
            <Text style={styles.amount}>{formatMinor(r.balance)}</Text>
          </View>
          <Text style={styles.sub}>{r.invoices} invoice{r.invoices === 1 ? '' : 's'}{r.d1_30 + r.d31_60 + r.d61_plus > 0 ? ` · ${formatMinor(r.d1_30 + r.d31_60 + r.d61_plus)} overdue` : ''}</Text>
        </Card>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  name: { flex: 1, fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  amount: { fontFamily: FONT.bold, fontSize: 15, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginTop: 2 },
});
