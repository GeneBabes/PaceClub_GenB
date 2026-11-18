'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { CLANS, GOALS, QUESTIONS, TOUR, getClan, recommendations, type Action, type Progress } from '@/lib/onboarding';

export default function OnboardingWizard({ initialProgress, displayName }: { initialProgress: Progress; displayName: string }) {
  const [progress, setProgress] = useState(initialProgress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = progress.step === 'tutorial' ? 2 : progress.step === 'result' ? 1 : 0;
  const result = recommendations(progress.responses);
  const suggested = result.winners.length === 1 ? getClan(result.winners[0]) : null;
  const clan = getClan(progress.selectedClanId);
  const question = QUESTIONS[progress.questionIndex];
  const tour = TOUR[progress.tutorialIndex];
  useEffect(() => { heading.current?.focus(); }, [progress.revision]);
  async function save(action: Action) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setReload(false); setSignIn(false);
    try {
      const response = await fetch('/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: progress.revision, action }) });
      const data = await response.json();
      if (!response.ok) { setReload(!!data.reload); setSignIn(!!data.signIn); throw new Error(data.error || 'Your progress could not be saved. Please try again.'); }
      if (data.destination === '/home') { window.location.assign('/home'); return; }
      if (!data.progress) throw new Error('Please reload to check your saved progress.');
      setProgress(data.progress);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please check your connection and try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (progress.step === 'goal') void save({ type: 'goal', goal: String(form.get('goal')) });
    else if (progress.step === 'quiz') void save({ type: 'answer', questionId: question.id, clanId: Number(form.get('answer')) });
    else if (progress.step === 'result') void save({ type: 'confirm', clanId: Number(form.get('clan')) });
  }
  async function signOut() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { const { error } = await browserClient().auth.signOut(); if (error) throw error; window.location.assign('/'); }
    catch { setError('Sign-out could not finish. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  const title = progress.step === 'goal' ? 'What brings you here?' : progress.step === 'quiz' ? question.title : progress.step === 'result' ? 'Find your people.' : tour.title;
  return <main className="onboarding-page">
    <header className="onboarding-header"><span className="brand">PACECLUB<span className="brand-dot">●</span></span><button className="text-button" disabled={busy} onClick={() => void signOut()}>Sign out</button></header>
    <ol className="steps" aria-label="Your setup progress">{['Your preferences', 'Your clan', 'Quick tour'].map((label, i) => <li key={label} className={i <= stage ? 'reached' : ''} aria-current={i === stage ? 'step' : undefined}><span>{i < stage ? '✓' : i + 1}</span>{label}</li>)}</ol>
    <section className="card onboarding-card" aria-busy={busy}>
      <p className="eyebrow">{progress.step === 'goal' ? 'A LITTLE ABOUT YOU' : progress.step === 'quiz' ? `QUESTION ${progress.questionIndex + 1} OF ${QUESTIONS.length}` : progress.step === 'result' ? 'YOUR PREFERENCE MATCH' : `WELCOME TO ${clan?.name.toUpperCase()} · ${progress.tutorialIndex + 1} OF ${TOUR.length}`}</p>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      {progress.step === 'goal' && <p className="muted">Hi, {displayName}. Choose the goal that matters most to you right now. There is no wrong answer.</p>}
      {progress.step === 'quiz' && <><p className="muted">Choose what feels most like you. This is about your preferences, not your fitness level.</p><progress className="quiz-progress" value={progress.questionIndex + 1} max={QUESTIONS.length} aria-label={`Question ${progress.questionIndex + 1} of ${QUESTIONS.length}`} /></>}
      {progress.step === 'result' && <><p className="muted">{suggested ? `${result.scores[suggested.id]} of your ${QUESTIONS.length} answers matched ${suggested.name}. ${suggested.description}` : `Your answers are tied between ${result.winners.map(id => getClan(id)?.name).join(' and ')}. Choose the clan that feels right for you.`}</p><p className="soft-note">This is a suggestion. You can choose any clan below; every clan can enjoy the same activities.</p></>}
      {progress.step !== 'tutorial' ? <form key={`${progress.step}-${progress.questionIndex}-${progress.revision}`} onSubmit={submit}>
        <fieldset disabled={busy || reload || signIn} className="option-fieldset"><legend className="sr-only">{title}</legend>
          {progress.step === 'goal' && GOALS.map(goal => <label key={goal.id} className="choice"><input type="radio" name="goal" value={goal.id} required defaultChecked={progress.goal === goal.id} /><span><strong>{goal.title}</strong><small>{goal.detail}</small></span></label>)}
          {progress.step === 'quiz' && question.options.map(option => <label key={option.clan} className="choice"><input type="radio" name="answer" value={option.clan} required defaultChecked={progress.responses[question.id] === option.clan} /><span>{option.text}</span></label>)}
          {progress.step === 'result' && <div className="clan-grid">{CLANS.map(item => <label key={item.id} className={`clan-choice ${item.className}`}><input type="radio" name="clan" value={item.id} required defaultChecked={suggested?.id === item.id} /><span className="clan-symbol" aria-hidden="true">{item.symbol}</span><strong>{item.name}</strong><span className="clan-theme">{item.theme}</span><small>{item.description}</small>{result.winners.includes(item.id) && <span className="match-label">{suggested ? 'Suggested for you' : 'One of your matches'}</span>}</label>)}</div>}
        </fieldset>
        <div className="actions">
          {progress.step === 'quiz' && <button type="button" className="secondary" disabled={busy || reload || signIn} onClick={() => void save({ type: 'back' })}>Back</button>}
          {progress.step === 'result' && <button type="button" className="secondary" disabled={busy || reload || signIn} onClick={() => void save({ type: 'review' })}>Review my answers</button>}
          <button type="submit" disabled={busy || reload || signIn}>{busy ? 'Saving…' : progress.step === 'result' ? 'Confirm my clan' : progress.step === 'quiz' && progress.questionIndex === QUESTIONS.length - 1 ? 'See my clan match' : 'Save & continue'}<span aria-hidden="true"> →</span></button>
        </div>
      </form> : <>
        <div className={`tour-emblem ${clan?.className}`}><span className="clan-symbol" aria-hidden="true">{clan?.symbol}</span><span>{clan?.name}<small>{clan?.theme}</small></span></div>
        <p className="tour-copy">{tour.text}</p><p className="soft-note">{tour.note}</p>
        <div className="actions">{progress.tutorialIndex > 0 && <button className="secondary" disabled={busy || reload || signIn} onClick={() => void save({ type: 'back' })}>Back</button>}<button disabled={busy || reload || signIn} onClick={() => void save({ type: progress.tutorialIndex === TOUR.length - 1 ? 'finish' : 'next' })}>{busy ? 'Saving…' : progress.tutorialIndex === TOUR.length - 1 ? 'Finish & open Home' : 'Continue'}<span aria-hidden="true"> →</span></button></div>
      </>}
      <div className="save-status" role="status" aria-live="polite">{busy ? 'Saving your progress…' : 'Your progress saves each time you continue.'}</div>
      {error && <div className="message error-message" role="alert"><p>{error}</p>{reload && <a href="/onboarding">Reload saved progress</a>}{signIn && <a href="/">Sign in again</a>}</div>}
    </section><p className="footnote">Your pace. Your community.</p>
  </main>;
}
