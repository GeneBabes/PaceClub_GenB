import { redirect } from 'next/navigation';
import { loadAccount } from '@/lib/account';
import AccountPanel from './account-panel';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ auth_error?: string }> }) {
  const account = await loadAccount();
  const query = await searchParams;
  if (account.profile?.is_active && !account.error) {
    if (account.complete) redirect('/home');
    if (account.progress.revision > 0 || account.progress.step === 'tutorial') redirect('/onboarding');
  }
  return <main>
    <p className="eyebrow">PACECLUB / FIRST STEPS</p>
    <h1>Your pace.<br />Your community.</h1>
    <p className="intro">Sign in, find your clan, and make it yours.</p>
    <AccountPanel profile={account.profile} signedIn={!!account.user} email={account.user?.email ?? ''}
      continueHref={account.profile?.is_active && !account.error ? '/onboarding' : null}
      initialError={account.error || (query.auth_error ? 'Sign-in could not finish. Try again and check your redirect URLs.' : '')} />
    {account.error && <a className="text-link" href="/">Retry loading your account</a>}
    <p className="footnote">Virtus · Sapientia · Constantia · Libertas</p>
  </main>;
}
