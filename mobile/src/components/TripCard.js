import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, StatusPill } from './ui';
import { colors, FONT } from '../theme/colors';
import { formatTime } from '../lib/format';

export const STATUS_COLOR = {
  scheduled: colors.blue, assigned: colors.purple, ready: colors.green, in_progress: colors.orange, delayed: '#B7791F',
  completed: colors.green, cancelled: colors.red, aborted: colors.red, draft: colors.muted,
};
export const STATUS_LABEL = {
  scheduled: 'Scheduled', assigned: 'Assigned', ready: 'Ready', in_progress: 'In progress', delayed: 'Delayed',
  completed: 'Completed', cancelled: 'Cancelled', aborted: 'Aborted', draft: 'Draft',
};

// Same card anatomy as NestSports' renewal cards: accent edge, tinted time chip, title/sub, status pill, meta row.
export default function TripCard({ trip, onPress }) {
  const accent = STATUS_COLOR[trip.status] ?? colors.blue;
  const code = trip.route?.code ?? trip.routeSnapshot?.code;
  const name = trip.route?.name ?? trip.routeSnapshot?.name;
  const stops = trip.route?.stops?.length ?? trip.routeSnapshot?.stops?.length;
  return (
    <Card accentColor={accent} onPress={onPress} style={{ padding: 12 }}>
      <View style={styles.top}>
        <View style={[styles.chip, { backgroundColor: `${accent}1A`, borderColor: accent }]}>
          <Text style={[styles.chipText, { color: accent }]}>{formatTime(trip.scheduledDeparture)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>{code} · {name}</Text>
          <Text style={styles.sub} numberOfLines={1}>{trip.tripNumber}{trip.myRole ? ` · you are the ${trip.myRole}` : ''}</Text>
        </View>
        <StatusPill label={STATUS_LABEL[trip.status] ?? trip.status} color={accent} />
      </View>
      <View style={styles.meta}>
        <Meta label="Vehicle" value={trip.vehicle?.registrationNumber ?? 'Not set'} />
        <View style={styles.divider} />
        <Meta label="Stops" value={stops ?? '—'} />
        <View style={styles.divider} />
        <Meta label="Driver" value={trip.driver?.name?.split(' ')[0] ?? '—'} />
      </View>
    </Card>
  );
}

const Meta = ({ label, value }) => (
  <View style={{ flex: 1 }}>
    <Text style={styles.metaLabel}>{label}</Text>
    <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chip: { minWidth: 54, height: 38, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  chipText: { fontFamily: FONT.bold, fontSize: 14 },
  title: { fontFamily: FONT.bold, fontSize: 14, color: colors.black },
  sub: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted, marginTop: 1 },
  meta: { flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#0000001A' },
  divider: { width: 1, backgroundColor: '#0000001A', marginHorizontal: 10 },
  metaLabel: { fontFamily: FONT.bold, fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  metaValue: { fontFamily: FONT.bold, fontSize: 13, color: colors.black, marginTop: 2 },
});
