import { serverClient } from '@/lib/supabase/server';
import AccountPanel, { type Profile } from './account-panel';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const supabase = await serverClient();
  // getUser verifies the session with Supabase Auth before loading profile data.
  const { data: { user } } = await supabase.auth.getUser();
  let profile: Profile | null = null;
  let profileError = '';
  if (user) {
    const { data, error } = await supabase.from('profiles')
      .select('id, display_name, avatar_path, clan_id, is_active').eq('id', user.id).single();
    profile = data as Profile | null;
    if (error) profileError = `Profile could not load: ${error.message}. Check that the original PaceClub SQL completed.`;
  }
  const query = await searchParams;
  return <main>
    <p className="eyebrow">PACECLUB / FIRST STEPS</p>
    <h1>Your pace.<br />Your community.</h1>
    <p className="intro">Sign in, meet your profile, and make it yours.</p>
    <AccountPanel profile={profile} signedIn={!!user} email={user?.email ?? ''}
      initialError={profileError || (query.auth_error ? 'Sign-in could not finish. Try again and check your redirect URLs.' : '')} />
    <p className="footnote">Virtus · Sapientia · Constantia · Libertas</p>
  </main>;
}
