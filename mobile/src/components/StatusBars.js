import React from 'react';
import { Button, Notice } from './ui';
import { useSync } from '../contexts/SyncContext';
import { useTrips } from '../contexts/TripsContext';
import { useAuth } from '../contexts/AuthContext';
import * as tracking from '../lib/tracking';
import { colors } from '../theme/colors';
import { formatTime } from '../lib/format';

/** Always-visible honesty about connection, unsent work and whether location is really being shared. */
export function StatusBars({ navigation }) {
  const { online, queue, syncing, sync } = useSync();
  const { stale } = useTrips();
  const { offlineRestore } = useAuth();
  const [t, setT] = React.useState(tracking.getState());
  React.useEffect(() => tracking.subscribe(setT), []);
  return (
    <>
      {!online || stale || offlineRestore ? (
        <Notice tone="warn" title="You're offline">
          Showing your last saved trips. Stop and boarding updates are saved and sent when you're back online. Starting or finishing a trip needs a connection.
        </Notice>
      ) : null}
      {queue.pending > 0 ? (
        <Notice tone="info" title={`${queue.pending} update${queue.pending > 1 ? 's' : ''} waiting to send`}
          action={online ? <Button title={syncing ? 'Sending…' : 'Send now'} onPress={sync} loading={syncing} variant="outline" style={{ minHeight: 38, paddingVertical: 8 }} /> : null}>
          {online ? 'They will go out automatically.' : 'They will be sent when you have a connection.'}
        </Notice>
      ) : null}
      {queue.failed > 0 ? (
        <Notice tone="error" title={`${queue.failed} update${queue.failed > 1 ? 's were' : ' was'} rejected`}
          action={<Button title="Review" variant="outline" color={colors.red} style={{ minHeight: 38, paddingVertical: 8 }} onPress={() => navigation?.navigate('Settings')} />}>
          The server could not apply them (for example the trip changed). Tell dispatch if it matters.
        </Notice>
      ) : null}
      {t.status === 'on' ? (
        <Notice tone={t.background === false ? 'warn' : 'ok'} title="Sharing your location with dispatch">
          {t.background === false
            ? 'Background location was not allowed, so sharing works only while this app is open.'
            : t.lastFixAt ? `Last position taken at ${formatTime(t.lastFixAt)}.` : 'Waiting for the first position…'}
          {t.buffered > 0 ? ` ${t.buffered} position${t.buffered > 1 ? 's' : ''} waiting to upload.` : ''}
        </Notice>
      ) : null}
      {t.status === 'denied' ? <Notice tone="error" title="Location is not being shared">Allow location access in your phone settings so dispatch can see the vehicle.</Notice> : null}
      {t.error ? <Notice tone="warn">{t.error}</Notice> : null}
    </>
  );
}
