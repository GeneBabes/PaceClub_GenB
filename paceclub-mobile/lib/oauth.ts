import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();
export const redirectTo = 'paceclub://auth/callback';

export async function socialLogin(provider: 'google' | 'facebook') {
  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: {
    redirectTo, skipBrowserRedirect: true, ...(provider === 'facebook' ? { scopes: 'email' } : {}),
  } });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return a login URL.');
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;
  const returned = new URL(result.url);
  if (returned.protocol !== 'paceclub:' || returned.hostname !== 'auth' || returned.pathname !== '/callback') {
    throw new Error('Unexpected login return URL. Check the mobile redirect configuration.');
  }
  const providerError = returned.searchParams.get('error_description');
  if (providerError) throw new Error(providerError);
  const code = returned.searchParams.get('code');
  if (!code) throw new Error('No login code returned. Check the Supabase redirect allowlist.');
  const flowId = returned.searchParams.get('sb_flow_id');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (exchangeError) throw exchangeError;
  return true;
}
