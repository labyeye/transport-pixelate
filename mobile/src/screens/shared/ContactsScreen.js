import React from 'react';
import { Linking } from 'react-native';
import { Phone } from 'lucide-react-native';
import ScreenShell from '../../components/ScreenShell';
import { Avatar, Button, Card, EmptyState, Row } from '../../components/ui';
import { useTrips } from '../../contexts/TripsContext';
import { titleCase } from '../../lib/format';

export default function ContactsScreen() {
  const { me } = useTrips();
  const contacts = me?.contacts ?? [];
  const emergency = me?.driver?.emergencyContact;
  return (
    <ScreenShell title="Who to call" subtitle="Tap to call" edges={[]}>
      {contacts.length === 0 && !emergency?.phone ? <EmptyState icon={Phone} title="No numbers yet" sub="Ask your administrator to add phone numbers for dispatch." /> : null}
      {contacts.length ? (
        <Card>
          {contacts.map((c, i) => (
            <Row key={c.phone + c.name} title={c.name} subtitle={`${titleCase(c.role)} · ${c.phone}`} left={<Avatar name={c.name} size={40} />} noBorder={i === contacts.length - 1}
              right={<Button title="Call" icon={Phone} style={{ minHeight: 38, paddingVertical: 6, paddingHorizontal: 10 }} onPress={() => Linking.openURL(`tel:${c.phone}`)} />} />
          ))}
        </Card>
      ) : null}
      {emergency?.phone ? (
        <Card>
          <Row title={emergency.name || 'Your emergency contact'} subtitle={emergency.phone} left={<Avatar name={emergency.name || 'E'} size={40} />} noBorder
            right={<Button title="Call" icon={Phone} variant="outline" style={{ minHeight: 38, paddingVertical: 6, paddingHorizontal: 10 }} onPress={() => Linking.openURL(`tel:${emergency.phone}`)} />} />
        </Card>
      ) : null}
    </ScreenShell>
  );
}
