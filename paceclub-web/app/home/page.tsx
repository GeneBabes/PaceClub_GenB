import { redirect } from 'next/navigation';
import { loadAccount } from '@/lib/account';
import { getClan, GOALS } from '@/lib/onboarding';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · PaceClub' };
export default async function HomePage() {
  const account = await loadAccount();
  if (!account.user || !account.profile?.is_active) redirect('/');
  if (account.error || !account.complete) redirect('/onboarding');
  const clan = getClan(account.profile.clan_id)!;
  const goal = GOALS.find(item => item.id === account.progress.goal);
  return <main className="home-page">
    <header className="app-header"><a className="brand" href="/home">PACECLUB<span className="brand-dot">●</span></a><nav aria-label="Main navigation"><a href="/home" aria-current="page">Home</a><a href="/activities">Activities</a><a href="/profile">Profile</a></nav></header>
    <p className="eyebrow">YOUR NEXT CHAPTER</p><h1>You’re in,<br />{account.profile.display_name.split(' ')[0]}.</h1><p className="intro">A little movement. A little progress. A community to share it with.</p>
    <section className={`card welcome-clan ${clan.className}`}><div className="tour-emblem"><span className="clan-symbol" aria-hidden="true">{clan.symbol}</span><div><p className="eyebrow">YOUR CLAN</p><h2>{clan.name}</h2></div></div><h3>{clan.theme}</h3><p>{clan.description}</p><span className="badge">✓ Onboarding complete</span></section>
    {goal && <section className="card goal-card"><p className="eyebrow">YOUR STARTING GOAL</p><h2>{goal.title}</h2><p className="muted">{goal.detail}</p></section>}
    <section className="card empty-activities"><div className="route-mark" aria-hidden="true"><svg width="38" height="38" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 36L36 10M14 10h22v22" /></svg></div><h2>Your journey starts here.</h2><p className="muted">Record a walk, run, or ride in the PaceClub mobile app. Submit it from your phone, then see your route and verification status here.</p><a className="text-link" href="/activities">View your activities →</a></section><p className="footnote">Virtus · Sapientia · Constantia · Libertas</p>
  </main>;
}
