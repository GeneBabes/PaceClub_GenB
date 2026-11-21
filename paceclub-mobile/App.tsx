import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Link } from 'expo-router';
import { useAuth } from './src/providers/AuthProvider';
import { useRecorder } from './src/providers/RecorderProvider';
import { supabase } from './lib/supabase';
import { disablePush } from './src/full/push';
import { socialLogin } from './lib/oauth';

type Profile = { id: string; display_name: string; avatar_path: string | null; clan_id: number | null; is_active: boolean };
const clans: Record<number, string> = { 1: 'Virtus', 2: 'Sapientia', 3: 'Constantia', 4: 'Libertas' };
const imageExtensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function Button({ label, action, disabled, secondary = false }: { label: string; action: () => void; disabled: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
    style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

function AccountScreen() {
  const { session, ready } = useAuth();
  const recorder = useRecorder();
  const [profileRecord, setProfile] = useState<Profile | null>(null);
  const [avatarRecord, setAvatar] = useState<{ path: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const userId = session?.user.id;
  const profile = profileRecord?.id === userId ? profileRecord : null;
  const avatar = profile?.is_active && avatarRecord?.path === profile.avatar_path ? avatarRecord?.url : null;

  useEffect(() => {
    let live = true;
    if (!userId) return;
    void supabase.from('profiles').select('id, display_name, avatar_path, clan_id, is_active').eq('id', userId).single()
      .then(({ data, error }) => {
        if (live) {
          if (error) setMessage(`Profile could not load: ${error.message}. Check the original SQL setup.`);
          else setProfile(data as Profile);
        }
      });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    let live = true;
    const path = profile?.avatar_path;
    if (!path || !profile?.is_active) return;
    async function refresh() {
      const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path!, 300);
      if (live) { setAvatar(data ? { path: path!, url: data.signedUrl } : null); if (error) setMessage(error.message); }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 240_000);
    return () => { live = false; clearInterval(timer); };
  }, [profile?.avatar_path, profile?.is_active]);

  async function login(provider: 'google' | 'facebook') {
    setBusy(true); setMessage('');
    try { if (!await socialLogin(provider)) setMessage('Sign-in cancelled.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setMessage('');
    try { await recorder.pause('Paused when you signed out.'); if(userId) await disablePush(userId); const { error } = await supabase.auth.signOut(); if (error) throw error; }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-out failed.'); }
    finally { setBusy(false); }
  }
  async function uploadAvatar() {
    if (!profile) return;
    setBusy(true); setMessage('');
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file = new File(asset.uri);
      const contentType = asset.mimeType || file.type;
      const extension = imageExtensions[contentType];
      if (!extension) throw new Error('Choose a JPG, PNG, or WebP picture.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a smaller picture (under 2 MiB).');
      const bytes = await file.arrayBuffer();
      const newPath = `${profile.id}/${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(newPath, bytes, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error: saveError } = await supabase.from('profiles').update({ avatar_path: newPath }).eq('id', profile.id).select('id').single();
      if (saveError) { await supabase.storage.from('avatars').remove([newPath]); throw saveError; }
      setProfile({ ...profile, avatar_path: newPath }); setMessage('Profile picture saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>PACECLUB / FIRST STEPS</Text>
      <Text style={styles.title}>Your pace.{ '\n' }Your community.</Text>
      <Text style={styles.intro}>Sign in, meet your profile, and make it yours.</Text>
      <View style={styles.card}>
        {!ready ? <Text>Loading your account…</Text> : !session ? <>
          <Text style={styles.heading}>Welcome to PaceClub</Text>
          <Button label="Continue with Google" disabled={busy} action={() => void login('google')} />
          {process.env.EXPO_PUBLIC_ENABLE_FACEBOOK === 'true' && <Button label="Continue with Facebook" disabled={busy} secondary action={() => void login('facebook')} />}
        </> : <>
          {profile ? <>
            {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> : <View style={[styles.avatar, styles.placeholder]}><Text style={styles.initial}>{profile.display_name.slice(0, 1).toUpperCase()}</Text></View>}
            <Text style={styles.heading}>Hello, {profile.display_name}</Text>
            <Text style={styles.text}>{session.user.email}</Text>
            <Text style={styles.badge}>{profile.clan_id ? clans[profile.clan_id] : 'Choose your clan on the PaceClub website'}</Text>
            
            {profile.is_active ? <Button label="Choose a profile picture" disabled={busy} action={() => void uploadAvatar()} /> : <Text style={styles.text}>Your account is inactive. Contact your project administrator.</Text>}
          </> : <Text style={styles.text}>Loading your profile…</Text>}
          {(!profile || profile.is_active) && <View><Link href="/record" style={styles.link}>Record an activity →</Link><Link href="/activities" style={styles.link}>Saved activities & uploads</Link></View>}
          <Button label="Sign out" disabled={busy} secondary action={() => void logout()} />
        </>}
        {busy && <Text style={styles.text}>Please wait…</Text>}
        {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
      </View>
      <Text style={styles.footer}>Virtus · Sapientia · Constantia · Libertas</Text>
    </ScrollView>
  </SafeAreaView>;
}
export default AccountScreen;

const styles = StyleSheet.create({
  link: { color: '#245741', fontWeight: '700', paddingVertical: 12, textDecorationLine: 'underline' },
  screen: { flex: 1, backgroundColor: '#f3f1e9' }, content: { padding: 24, paddingTop: 36, flexGrow: 1 },
  eyebrow: { color: '#193b32', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#193b32', fontSize: 44, fontWeight: '700', lineHeight: 48, marginTop: 24 },
  intro: { color: '#586b63', fontSize: 16, lineHeight: 24, marginVertical: 20 },
  card: { backgroundColor: '#fff', borderColor: '#d5dfd6', borderWidth: 1, borderRadius: 20, padding: 24 },
  heading: { color: '#193b32', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  text: { color: '#586b63', fontSize: 14, lineHeight: 22, marginTop: 10 },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 20 },
  placeholder: { backgroundColor: '#dce7d8', alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 34, color: '#245741' },
  badge: { color: '#735027', backgroundColor: '#f4e8d4', borderRadius: 12, padding: 10, marginVertical: 16, fontSize: 13 },
  button: { backgroundColor: '#245741', borderRadius: 10, paddingVertical: 15, paddingHorizontal: 10, marginTop: 14 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: 15 },
  secondary: { backgroundColor: '#eff3ee' }, secondaryText: { color: '#244d3d' }, disabled: { opacity: 0.55 },
  message: { color: '#193b32', backgroundColor: '#f5f2e9', borderRadius: 8, padding: 12, marginTop: 16, lineHeight: 21 },
  footer: { textAlign: 'center', color: '#65756b', fontSize: 11, marginTop: 24 },
});
