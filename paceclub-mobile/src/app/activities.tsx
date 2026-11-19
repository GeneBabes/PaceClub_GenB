import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { duration } from '../activity/model';
import { useAuth } from '../providers/AuthProvider';
import { useRecorder } from '../providers/RecorderProvider';
import { AccountRequired, activityLabel, Button, Screen, ui } from '../components/ActivityUI';

export default function ActivitiesScreen() {
  const { session } = useAuth();
  const r = useRecorder();
  if (!session) return <AccountRequired />;
  return <Screen><Text style={ui.title}>Every step counts.</Text><Text style={ui.text}>Activities saved on this phone for your account. Queued uploads retry while PaceClub is open and you’re online.</Text>
    {!r.ready && <Text style={ui.text}>Loading…</Text>}
    {!!r.message && <Text style={[ui.note, ui.error]}>{r.message}</Text>}
    {r.fatal && <Button secondary onPress={r.reload}>Reload saved activity</Button>}
    {r.ready && !r.activities.length && <View style={ui.card}><Text style={ui.heading}>Your first route is waiting.</Text><Link href="/record" style={ui.link}>Record an activity</Link></View>}
    {r.activities.map(a => <View key={a.id} style={ui.card}><Text style={ui.badge}>{activityLabel(a)}</Text><Text style={ui.heading}>{a.type[0].toUpperCase() + a.type.slice(1)} · {(a.distanceM / 1000).toFixed(2)} km</Text><Text style={ui.text}>{new Date(a.startedAt).toLocaleString()} · {duration(a.activeMs / 1000)}</Text>
      <Link href={a.phase === 'finished' ? { pathname: '/activity/[id]', params: { id: a.id } } : '/record'} style={ui.link}>{a.phase === 'finished' ? 'Review activity' : 'Return to recorder'}</Link>
    </View>)}
    {r.activities.some(a => a.sync === 'queued') && <Button disabled={r.syncing} onPress={() => void r.retry()}>{r.syncing ? 'Uploading…' : 'Retry queued uploads'}</Button>}
    <Link href="/record" style={ui.link}>Record another activity</Link>
  </Screen>;
}
