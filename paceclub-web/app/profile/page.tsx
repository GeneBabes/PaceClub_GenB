import { redirect } from 'next/navigation';
import { loadAccount } from '@/lib/account';
import AccountPanel from '../account-panel';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · PaceClub' };
export default async function ProfilePage() {
  const account = await loadAccount();
  if (!account.user || !account.profile?.is_active) redirect('/');
  if (account.error || !account.complete) redirect('/onboarding');
  return <main><header className="app-header"><a className="brand" href="/home">PACECLUB<span className="brand-dot">●</span></a><nav aria-label="Main navigation"><a href="/home">Home</a><a href="/profile" aria-current="page">Profile</a></nav></header><p className="eyebrow">YOUR CORNER OF PACECLUB</p><h1>Make it yours.</h1><p className="intro">Your profile, your clan, your pace.</p><AccountPanel profile={account.profile} signedIn email={account.user.email ?? ''} initialError="" /></main>;
}
