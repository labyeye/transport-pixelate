import React, { useState } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { ChipSelect, Notice, StickyFooter, TextField, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useApi } from '../../lib/useApi';
import { isCrew } from '../../lib/permissions';
import { formatTime } from '../../lib/format';
import { REQUEST_TYPES_FOR_CREW } from '../../navigation/navConfig';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export default function NewRequestScreen({ navigation }) {
  const { user } = useAuth();
  const toast = useToast();
  const crew = isCrew(user);
  const { data: trips } = useApi(crew ? '/driver/trips' : '/trips', crew ? undefined : { from: new Date().toLocaleDateString('en-CA'), limit: 50 });
  const [type, setType] = useState('special_requirement');
  const [trip, setTrip] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const types = REQUEST_TYPES_FOR_CREW.map(t => t.value);
  const labels = Object.fromEntries(REQUEST_TYPES_FOR_CREW.map(t => [t.value, t.label]));
  const upcoming = (trips ?? []).filter(t => !['completed', 'cancelled', 'aborted'].includes(t.status));
  const tripLabels = Object.fromEntries(upcoming.map(t => [t._id, `${t.tripNumber} · ${t.scheduledDate} ${formatTime(t.scheduledDeparture)}`]));

  const needsTrip = type !== 'special_requirement';
  const payload = type === 'trip_cancellation' ? { trip, reason } : type === 'schedule_change' ? { trip, scheduledDate: date, departureTime: time } : {};
  const valid = description.trim().length >= 5 && (!needsTrip || trip)
    && (type !== 'trip_cancellation' || reason.trim().length >= 3)
    && (type !== 'schedule_change' || (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time)));

  const submit = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/requests', { type, description: description.trim(), priority, payload });
      toast.success('Request sent to dispatch');
      navigation.goBack();
    } catch (e) {
      setError(e.errors?.[0]?.message ? `${e.message}: ${e.errors[0].message}` : e.message);
    } finally { setSaving(false); }
  };

  return (
    <ScreenShell title="New request" subtitle="A reviewer checks the effect before anything changes" edges={[]}
      footer={<StickyFooter onSave={submit} onCancel={() => navigation.goBack()} saveLabel="Send request" saving={saving} disabled={!valid} />}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <ChipSelect label="What do you need?" options={types} value={type} onChange={setType} labels={labels} />
      {needsTrip ? (
        upcoming.length ? <ChipSelect label="Which trip?" options={upcoming.map(t => t._id)} value={trip} onChange={setTrip} labels={tripLabels} />
          : <Notice tone="warn">You have no upcoming trips to attach a request to.</Notice>
      ) : null}
      {type === 'trip_cancellation' ? <TextField label="Reason for cancelling" value={reason} onChangeText={setReason} autoCapitalize="sentences" required /> : null}
      {type === 'schedule_change' ? (
        <>
          <TextField label="New date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2030-01-15" keyboardType="numbers-and-punctuation" required />
          <TextField label="New departure (HH:mm)" value={time} onChangeText={setTime} placeholder="07:30" keyboardType="numbers-and-punctuation" required />
        </>
      ) : null}
      <TextField label="Details" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" placeholder="Explain what you need and why" required />
      <ChipSelect label="Priority" options={PRIORITIES} value={priority} onChange={setPriority} />
    </ScreenShell>
  );
}
