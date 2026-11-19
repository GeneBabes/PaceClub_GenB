import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';
import type { ReactNode } from 'react';
import { duration, pace, type LocalActivity, type Point } from '../activity/model';
import { routeGeometry } from '../activity/route';

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f1e9' }, content: { padding: 22, gap: 18, paddingBottom: 40 },
  eyebrow: { color: '#52715e', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#193b32', fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  heading: { color: '#193b32', fontSize: 21, fontWeight: '700' },
  text: { color: '#586b63', fontSize: 14, lineHeight: 22 },
  card: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#d5dfd6', padding: 20, gap: 14 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  button: { backgroundColor: '#245741', padding: 16, minHeight: 50, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { backgroundColor: '#edf2e9' }, secondaryText: { color: '#245741' },
  disabled: { opacity: .5 }, link: { color: '#245741', fontWeight: '700', textDecorationLine: 'underline', paddingVertical: 10 },
  note: { backgroundColor: '#eeeadd', color: '#58634e', borderRadius: 12, padding: 14, lineHeight: 22 },
  error: { backgroundColor: '#fff0e8', color: '#863b25' },
  badge: { color: '#735027', backgroundColor: '#f4e8d4', alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, fontSize: 12 },
  metric: { flex: 1, minWidth: 95 }, number: { color: '#193b32', fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timer: { color: '#193b32', fontSize: 43, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -1 },
});
export function Screen({ children }: { children: ReactNode }) { return <SafeAreaView edges={['bottom', 'left', 'right']} style={ui.screen}><ScrollView contentContainerStyle={ui.content}>{children}</ScrollView></SafeAreaView>; }
export function Button({ children, onPress, disabled = false, secondary = false, style }: { children: ReactNode; onPress: () => void; disabled?: boolean; secondary?: boolean; style?: ViewStyle }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, secondary && ui.secondary, disabled && ui.disabled, style]}><Text style={[ui.buttonText, secondary && ui.secondaryText]}>{children}</Text></Pressable>;
}
export function AccountRequired() { return <Screen><Text style={ui.heading}>Sign in to record your activity.</Text><Text style={ui.text}>Use the same account on your phone and on the PaceClub website.</Text><Link href="/" style={ui.link}>Go to your account</Link></Screen>; }
export function Metrics({ activity, seconds }: { activity: LocalActivity; seconds: number }) {
  return <View style={{ gap: 18 }}><View><Text style={ui.eyebrow}>ACTIVE TIME</Text><Text style={ui.timer}>{duration(seconds)}</Text></View><View style={ui.row}>
    <View style={ui.metric}><Text style={ui.number}>{(activity.distanceM / 1000).toFixed(2)}</Text><Text style={ui.text}>kilometres</Text></View>
    <View style={ui.metric}><Text style={ui.number}>{activity.type === 'ride' ? (seconds > 0 ? (activity.distanceM / seconds * 3.6).toFixed(1) : '—') : pace(activity.distanceM, seconds)}</Text><Text style={ui.text}>{activity.type === 'ride' ? 'average km/h' : 'average min/km'}</Text></View>
  </View></View>;
}
export function RouteTrace({ points }: { points: Point[] }) {
  const route = routeGeometry(points);
  return <View style={{ borderRadius: 14, backgroundColor: '#f0f4eb', overflow: 'hidden' }}>
    <View accessibilityRole="image" accessibilityLabel={`Recorded route, ${points.length} GPS samples. Gaps show pauses or missing GPS.`}>
      <Svg width="100%" height={220} viewBox="0 0 320 220">
        {[40, 80, 120, 160, 200].map(y => <Path key={y} d={`M0 ${y} H320`} stroke="#dfe7d9" strokeWidth={1} />)}
        {route.paths.map((d, i) => <Path key={i} d={d} fill="none" stroke="#245741" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />)}
        {route.first && <Circle cx={route.first.x} cy={route.first.y} r={6} fill="#fff" stroke="#245741" strokeWidth={2} />}
        {route.last && <Circle cx={route.last.x} cy={route.last.y} r={4} fill="#b87035" />}
      </Svg>
    </View>
    <Text style={[ui.text, { textAlign: 'center', padding: 10, fontSize: 12 }]}>{points.length ? 'Route trace · green start / amber end · north up' : 'Your route will appear after a good GPS fix.'}</Text>
  </View>;
}
export function activityLabel(a: LocalActivity) {
  return a.phase === 'recording' ? 'Recording' : a.phase === 'paused' ? 'Paused' : a.sync === 'synced' ? 'Submitted' : a.sync === 'queued' ? 'Waiting to upload' : 'Ready to review';
}
