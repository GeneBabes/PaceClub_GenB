'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

export type Profile = { id: string; display_name: string; avatar_path: string | null; clan_id: number | null; is_active: boolean };
const clans: Record<number, string> = { 1: 'Virtus', 2: 'Sapientia', 3: 'Constantia', 4: 'Libertas' };
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export default function AccountPanel({ profile, signedIn, email, initialError }: {
  profile: Profile | null; signedIn: boolean; email: string; initialError: string;
}) {
  const [supabase] = useState(browserClient);
  const [path, setPath] = useState(profile?.avatar_path ?? null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError);

  useEffect(() => {
    let live = true;
    setAvatar(null);
    if (!path || !profile?.is_active) return;
    async function refresh() {
      const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path!, 300);
      if (live) {
        setAvatar(data?.signedUrl ?? null);
        if (error) setMessage(error.message);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 240_000);
    return () => { live = false; clearInterval(timer); };
  }, [path, profile?.is_active, supabase]);

  async function login(provider: 'google' | 'facebook') {
    setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      ...(provider === 'facebook' ? { scopes: 'email' } : {}),
    } });
    if (error) { setMessage(error.message); setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    if (error) { setMessage(error.message); setBusy(false); }
    else window.location.assign('/');
  }

  async function upload(file: File) {
    if (!profile) return;
    setBusy(true); setMessage('');
    try {
      const extension = extensions[file.type];
      if (!extension) throw new Error('Choose a JPG, PNG, or WebP image.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image smaller than 2 MiB.');
      const newPath = `${profile.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(newPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: saveError } = await supabase.from('profiles').update({ avatar_path: newPath }).eq('id', profile.id).select('id').single();
      if (saveError) {
        await supabase.storage.from('avatars').remove([newPath]);
        throw saveError;
      }
      setPath(newPath); setMessage('Profile picture saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section className="card">
    {!signedIn ? <>
      <h2>Welcome to PaceClub</h2>
      <p>Use your account to get started.</p>
      <button disabled={busy} onClick={() => void login('google')}>Continue with Google</button>
      {process.env.NEXT_PUBLIC_ENABLE_FACEBOOK === 'true' && <button className="secondary" disabled={busy} onClick={() => void login('facebook')}>Continue with Facebook</button>}
    </> : <>
      {profile && <>
        {avatar ? <img className="avatar" src={avatar} alt={`${profile.display_name}'s profile picture`} /> : <div className="avatar placeholder">{profile.display_name.slice(0, 1).toUpperCase()}</div>}
        <h2>Hello, {profile.display_name}</h2>
        <p>{email}</p>
        <p className="badge">{profile.clan_id ? clans[profile.clan_id] : 'Clan selection is coming next'}</p>
        {profile.is_active ? <label className="upload-label">Choose a profile picture
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void upload(file);
          }} />
        </label> : <p>Your account is inactive. Contact your project administrator.</p>}
      </>}
      <button className="secondary" disabled={busy} onClick={() => void logout()}>Sign out</button>
    </>}
    {busy && <p role="status">Please wait…</p>}
    {message && <p className="message" role="status">{message}</p>}
  </section>;
}
