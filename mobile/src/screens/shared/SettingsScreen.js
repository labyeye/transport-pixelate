import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ScreenShell from '../../components/ScreenShell';
import { Button, Card, Notice, Row, SectionTitle, StatusPill, TextField, useToast } from '../../components/ui';
import { useSync } from '../../contexts/SyncContext';
import { getBaseUrl, setBaseUrl } from '../../lib/api';
import { dismissFailures, failures } from '../../lib/queue';
import * as tracking from '../../lib/tracking';
import { timeAgo } from '../../lib/format';
import { colors, FONT } from '../../theme/colors';

const TRACK_LABEL = { on: 'Sharing', off: 'Off', requesting: 'Asking permission…', denied: 'Blocked', error: 'Problem' };
const TRACK_COLOR = { on: colors.green, off: colors.muted, requesting: colors.blue, denied: colors.red, error: colors.red };

export default function SettingsScreen() {
  const toast = useToast();
  const { online, queue, syncing, sync } = useSync();
  const [server, setServer] = useState(getBaseUrl());
  const [failed, setFailed] = useState([]);
  const [t, setT] = useState(tracking.getState());
  useEffect(() => { failures().then(setFailed); }, [queue.failed]);
  useEffect(() => tracking.subscribe(setT), []);

  return (
    <ScreenShell title="Settings" edges={[]}>
      <Card>
        <SectionTitle title="Connection" />
        <Row title={online ? 'Online' : 'Offline'} subtitle={online ? 'Connected to the internet' : 'Changes are saved and sent later'} right={<StatusPill label={online ? 'Online' : 'Offline'} color={online ? colors.green : colors.red} />} noBorder />
        <TextField label="Server address" value={server} onChangeText={setServer} keyboardType="url" />
        <Button title="Save server address" variant="outline" disabled={server.trim() === getBaseUrl()}
          onPress={async () => { await setBaseUrl(server.trim()); toast.success('Saved. Sign out and back in to use it.'); }} />
      </Card>

      <Card>
        <SectionTitle title="Location sharing" />
        <Row title={TRACK_LABEL[t.status]} subtitle="Only between Start trip and Finish trip" right={<StatusPill label={TRACK_LABEL[t.status]} color={TRACK_COLOR[t.status]} />} noBorder />
        <Text style={styles.note}>
          Phones and battery-saver settings can pause apps in the background. If dispatch sees gaps, keep this app open during the trip.
          {t.lastFixAt ? ` Last position ${timeAgo(t.lastFixAt)}.` : ''}
          {t.buffered ? ` ${t.buffered} waiting to upload.` : ''}
        </Text>
        {t.background === false ? <Notice tone="warn">Background location was not allowed, so sharing works only while the app is open.</Notice> : null}
      </Card>

      <Card>
        <SectionTitle title="Unsent updates" sub={`${queue.pending} waiting · ${queue.failed} rejected`} />
        <Button title={syncing ? 'Sending…' : 'Send now'} onPress={sync} loading={syncing} disabled={!online || queue.pending === 0} />
        {failed.length ? (
          <View style={{ marginTop: 14 }}>
            <Text style={styles.failTitle}>Could not be applied</Text>
            {failed.map(f => <Text key={f.id} style={styles.fail}>• {f.label ?? f.path}: {f.reason}</Text>)}
            <Button title="Clear list" variant="outline" style={{ marginTop: 10 }} onPress={async () => { await dismissFailures(); setFailed([]); }} />
          </View>
        ) : null}
      </Card>
      <Text style={styles.foot}>Your trips, passenger lists and unsent updates are kept on this phone and removed when you sign out.</Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  note: { fontFamily: FONT.medium, fontSize: 12, color: colors.muted, marginBottom: 6 },
  failTitle: { fontFamily: FONT.bold, fontSize: 12, textTransform: 'uppercase', color: colors.red, marginBottom: 4 },
  fail: { fontFamily: FONT.medium, fontSize: 12, color: colors.black, marginBottom: 2 },
  foot: { fontFamily: FONT.medium, fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 4 },
});
