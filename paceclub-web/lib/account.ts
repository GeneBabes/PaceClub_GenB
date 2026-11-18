import { serverClient } from './supabase/server';
import { isComplete, readProgress, type OnboardingRow, type Profile } from './onboarding';

export async function loadAccount() {
  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  let profile: Profile | null = null;
  let onboarding: OnboardingRow | null = null;
  let error = '';
  if (user) {
    const result = await supabase.from('profiles').select('id, display_name, avatar_path, clan_id, is_active').eq('id', user.id).single();
    profile = result.data as Profile | null;
    if (result.error) error = 'Your profile could not load. Please try again.';
    if (profile?.is_active) {
      const result = await supabase.from('onboarding_answers').select('answers, tutorial_completed_at').eq('user_id', user.id).single();
      onboarding = result.data as OnboardingRow | null;
      if (result.error) error = 'Your saved progress could not load. Please retry. If this continues, check that your account has an onboarding_answers row.';
    }
  }
  return { supabase, user, profile, onboarding, error,
    progress: readProgress(onboarding?.answers ?? {}, profile?.clan_id ?? null),
    complete: isComplete(onboarding, profile?.clan_id ?? null) };
}
