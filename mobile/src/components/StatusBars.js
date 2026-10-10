import React from 'react';
import { Banner, Button } from './ui';
import { useSync } from '../contexts/SyncContext';
import { useTrips } from '../contexts/TripsContext';
import { useAuth } from '../contexts/AuthContext';
import * as tracking from '../lib/tracking';

/** Always-visible honesty: connection, unsent work, and whether location is really being shared. */
export function StatusBars({ navigation }) {
  const { online, queue, syncing, sync } = useSync();
  const { stale } = useTrips();
  const { offlineRestore } = useAuth();
  const [t, setT] = React.useState(tracking.getState());
  React.useEffect(() => tracking.subscribe(setT), []);
  return (
    <>
      {!online || stale || offlineRestore ? (
        <Banner tone="warn" title="You're offline">
          {`Showing your last saved trips. Stop and boarding updates are saved and sent when you're back online. Starting or finishing a trip needs a connection.`}
        </Banner>
      ) : null}
      {queue.pending > 0 ? (
        <Banner tone="info" title={`${queue.pending} update${queue.pending > 1 ? 's' : ''} waiting to send`}
          action={online ? <Button small title={syncing ? 'Sending…' : 'Send now'} onPress={sync} busy={syncing} variant="secondary" /> : null}>
          {online ? 'They will go out automatically.' : 'They will be sent when you have a connection.'}
        </Banner>
      ) : null}
      {queue.failed > 0 ? (
        <Banner tone="error" title={`${queue.failed} update${queue.failed > 1 ? 's were' : ' was'} rejected by the server`}
          action={<Button small title="Review" variant="secondary" onPress={() => navigation.navigate('More')} />}>
          They could not be applied (for example the trip was changed). Tell dispatch if it matters.
        </Banner>
      ) : null}
      {t.status === 'on' ? (
        <Banner tone={t.background === false ? 'warn' : 'ok'} title="Sharing your location with dispatch">
          {t.background === false
            ? 'Background location was not allowed, so sharing works only while this app is open.'
            : t.lastFixAt ? `Last position taken ${new Date(t.lastFixAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.` : 'Waiting for the first position…'}
          {t.buffered > 0 ? ` ${t.buffered} position${t.buffered > 1 ? 's' : ''} waiting to upload.` : ''}
        </Banner>
      ) : null}
      {t.status === 'denied' ? <Banner tone="error" title="Location is not being shared">Allow location access in your phone settings so dispatch can see the vehicle.</Banner> : null}
      {t.error ? <Banner tone="warn">{t.error}</Banner> : null}
    </>
  );
}
