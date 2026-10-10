import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Phone } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import ReasonSheet from '../../components/ReasonSheet';
import { STATUS_COLOR, STATUS_LABEL } from '../../components/TripCard';
import { Button, Card, LoadingView, Notice, SectionTitle, StatusPill, useToast } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { formatTime, timeAgo } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

// Next legal steps, mirrored from the server's state machine (which enforces them).
const NEXT = {
  scheduled: [{ to: 'cancelled', label: 'Cancel trip', reason: true, danger: true }],
  assigned: [{ to: 'ready', label: 'Mark ready' }, { to: 'cancelled', label: 'Cancel trip', reason: true, danger: true }],
  ready: [{ to: 'in_progress', label: 'Dispatch now' }, { to: 'cancelled', label: 'Cancel trip', reason: true, danger: true }],
  in_progress: [{ to: 'delayed', label: 'Mark delayed', reason: true }, { to: 'completed', label: 'Complete' }, { to: 'aborted', label: 'Abort trip', reason: true, danger: true }],
  delayed: [{ to: 'in_progress', label: 'Resume' }, { to: 'completed', label: 'Complete' }, { to: 'aborted', label: 'Abort trip', reason: true, danger: true }],
};

export default function ManagerTripScreen({ route }) {
  const { id } = route.params;
  const { can } = useAuth();
  const toast = useToast();
  const { data: trip, error, loading, refreshing, refresh } = useApi(`/trips/${id}`, undefined, { interval: 30000 });
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <LoadingView />;
  if (!trip) return <ScreenShell title="Trip"><Notice tone="error">{error ?? 'Trip not found'}</Notice></ScreenShell>;

  const move = async (step, reason) => {
    setBusy(true);
    try {
      await api.post(`/trips/${id}/transition`, { to: step.to, reason: reason || undefined });
      toast.success(`${trip.tripNumber}: ${step.label}`);
      await refresh();
    } catch (e) {
      toast.error(e.status === 0 ? "Can't reach the server" : e.message);
    } finally {
      setBusy(false);
    }
  };
  const accent = STATUS_COLOR[trip.status];
  const steps = can('trips:dispatch') ? NEXT[trip.status] ?? [] : [];

  return (
    <ScreenShell title={`${trip.routeSnapshot.code} · ${trip.routeSnapshot.name}`} subtitle={`${trip.tripNumber} · ${trip.scheduledDate} ${formatTime(trip.scheduledDeparture)}–${formatTime(trip.expectedArrival)}`}
      right={<StatusPill label={STATUS_LABEL[trip.status]} color={accent} />} edges={[]} refreshing={refreshing} onRefresh={refresh}>
      <Card accentColor={accent}>
        <Text style={styles.line}>Vehicle: <Text style={styles.strong}>{trip.vehicle?.registrationNumber ?? 'Not assigned'}</Text></Text>
        <Text style={styles.line}>Driver: <Text style={styles.strong}>{trip.driver?.name ?? 'Not assigned'}</Text></Text>
        {trip.attendant ? <Text style={styles.line}>Attendant: <Text style={styles.strong}>{trip.attendant.name}</Text></Text> : null}
        {trip.delayReason ? <Text style={styles.line}>Delay: <Text style={styles.strong}>{trip.delayReason}</Text></Text> : null}
        {trip.cancellationReason ? <Text style={styles.line}>Reason: <Text style={styles.strong}>{trip.cancellationReason}</Text></Text> : null}
        {trip.driver?.phone ? <Button title={`Call ${trip.driver.name.split(' ')[0]}`} variant="outline" icon={Phone} style={{ marginTop: 10 }} onPress={() => Linking.openURL(`tel:${trip.driver.phone}`)} /> : null}
      </Card>

      {steps.length ? (
        <View style={{ gap: 10, marginBottom: 12 }}>
          {steps.map(s => (
            <Button key={s.to} title={s.label} color={s.danger ? colors.red : colors.blue} variant={s.danger ? 'outline' : 'solid'} loading={busy}
              onPress={() => (s.reason ? setSheet(s) : move(s))} />
          ))}
        </View>
      ) : null}

      <SectionTitle title="Route" sub={`Plan v${trip.routeSnapshot.version} · ${trip.routeSnapshot.stops.length} stops`} />
      <Card style={{ paddingVertical: 4 }}>
        {trip.routeSnapshot.stops.map((s, i, a) => (
          <View key={s.sequence} style={[styles.stop, i < a.length - 1 && styles.border]}>
            <Text style={styles.seq}>{s.sequence}</Text>
            <Text style={styles.stopName} numberOfLines={1}>{s.name}</Text>
            <Text style={styles.line}>{s.plannedArrival ?? ''}</Text>
          </View>
        ))}
      </Card>

      <SectionTitle title="History" />
      <Card style={{ paddingVertical: 4 }}>
        {trip.history.map((h, i, a) => (
          <View key={i} style={[styles.hist, i < a.length - 1 && styles.border]}>
            <Text style={styles.stopName}>{h.action}{h.to ? ` → ${h.to.replace('_', ' ')}` : ''}</Text>
            <Text style={styles.line}>{timeAgo(h.at)}{h.by?.name ? ` · ${h.by.name}` : ''}{h.note ? ` · ${h.note}` : ''}</Text>
          </View>
        ))}
      </Card>

      <ReasonSheet visible={!!sheet} title={sheet?.label} confirmLabel={sheet?.label} danger={sheet?.danger} onClose={() => setSheet(null)} onSubmit={r => move(sheet, r)} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginBottom: 3 },
  strong: { fontFamily: FONT.bold, color: colors.black },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  hist: { paddingVertical: 10 },
  border: { borderBottomWidth: 1, borderBottomColor: '#0000001A' },
  seq: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.black, textAlign: 'center', lineHeight: 20, fontFamily: FONT.bold, fontSize: 11, color: colors.black },
  stopName: { flex: 1, fontFamily: FONT.bold, fontSize: 13, color: colors.black },
});
