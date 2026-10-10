import React, { useEffect, useState } from 'react';
import { Linking, Text } from 'react-native';
import { Banner, Button, Card, H, Label, P, Screen } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useTrips } from '../contexts/TripsContext';
import { useSync } from '../contexts/SyncContext';
import { dismissFailures, failures } from '../lib/queue';
import * as tracking from '../lib/tracking';
import { getBaseUrl } from '../lib/api';
import { colors } from '../theme';

export default function MoreScreen() {
  const { user, logout } = useAuth();
  const { me } = useTrips();
  const { queue, online } = useSync();
  const [failed, setFailed] = useState([]);
  const [t, setT] = useState(tracking.getState());
  useEffect(() => { failures().then(setFailed); }, [queue.failed]);
  useEffect(() => tracking.subscribe(setT), []);

  return (
    <Screen>
      <Card>
        <H>{user.name}</H>
        <P muted>{user.email} · {user.role}</P>
        <P muted>{me?.organization?.name}</P>
        <P muted>Server: {getBaseUrl()}</P>
        <P muted>{online ? 'Online' : 'Offline'}</P>
      </Card>

      <Card>
        <Label>Location sharing</Label>
        <P bold>{{ on: 'On', off: 'Off', requesting: 'Asking permission…', denied: 'Blocked', error: 'Problem' }[t.status]}</P>
        <P muted>Your location is shared with dispatch only between Start trip and Finish trip. Phones and battery-saver settings can pause apps in the background; if you see gaps, keep this app open during the trip.</P>
        {t.lastFixAt ? <P muted>Last position: {new Date(t.lastFixAt).toLocaleTimeString('en-IN')}</P> : null}
      </Card>

      {me?.contacts?.length ? (
        <Card>
          <Label>Who to call</Label>
          {me.contacts.map(c => (
            <Button key={c.phone + c.name} variant="secondary" title={`${c.name} · ${c.phone}`} style={{ marginBottom: 8 }} onPress={() => Linking.openURL(`tel:${c.phone}`)} />
          ))}
        </Card>
      ) : null}

      {failed.length ? (
        <Card accent={colors.red}>
          <Label>Updates that could not be applied</Label>
          {failed.map(f => <P key={f.id} muted>• {f.label ?? f.path}: {f.reason}</P>)}
          <Button small title="Clear list" variant="secondary" style={{ marginTop: 8 }} onPress={async () => { await dismissFailures(); setFailed([]); }} />
        </Card>
      ) : null}

      <Banner tone="info">Your trips, passenger lists and unsent updates are kept on this phone and removed when you sign out.</Banner>
      <Button title="Sign out" variant="danger" onPress={logout} />
      <Text style={{ marginTop: 16, color: colors.muted, textAlign: 'center' }}>Nest Transport</Text>
    </Screen>
  );
}
