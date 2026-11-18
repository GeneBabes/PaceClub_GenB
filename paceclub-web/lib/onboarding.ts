// Shared, deterministic onboarding rules. No account IDs or permissions come from the quiz.
export type ClanId = 1 | 2 | 3 | 4;
export type Profile = { id: string; display_name: string; avatar_path: string | null; clan_id: number | null; is_active: boolean };
export type OnboardingRow = { answers: Record<string, unknown>; tutorial_completed_at: string | null };
export const CLANS = [
  { id: 1, name: 'Virtus', theme: 'Find your rhythm', description: 'A relaxed pace, small steps, and habits that last.', symbol: 'V', className: 'virtus' },
  { id: 2, name: 'Sapientia', theme: 'Grow a little further', description: 'Personal challenges and steady improvement, on your own terms.', symbol: 'S', className: 'sapientia' },
  { id: 3, name: 'Constantia', theme: 'Follow your curiosity', description: 'New routes, fresh experiences, and a reason to explore.', symbol: 'C', className: 'constantia' },
  { id: 4, name: 'Libertas', theme: 'Move together', description: 'Shared activities, encouragement, and a welcoming community.', symbol: 'L', className: 'libertas' },
] as const;
export const GOALS = [
  { id: 'habit', title: 'Build a steady habit', detail: 'Make movement a regular part of my week.' },
  { id: 'improve', title: 'Work toward a personal goal', detail: 'Notice my progress and challenge myself gently.' },
  { id: 'explore', title: 'Discover new places', detail: 'Find more reasons to get outside.' },
  { id: 'connect', title: 'Connect with other people', detail: 'Share activities and encourage one another.' },
] as const;
export type GoalId = typeof GOALS[number]['id'];
export const QUESTIONS = [
  { id: 'good_day', title: 'What makes an activity feel worthwhile?', options: [
    { clan: 1, text: 'I made time for a comfortable, steady session.' },
    { clan: 2, text: 'I made progress toward a goal of my own.' },
    { clan: 3, text: 'I discovered a route or place I had not tried.' },
    { clan: 4, text: 'I shared the experience with someone.' },
  ] },
  { id: 'weekend', title: 'Which weekend plan appeals to you most?', options: [
    { clan: 3, text: 'Explore a different park or neighborhood.' },
    { clan: 4, text: 'Meet friends for a walk, run, or ride.' },
    { clan: 1, text: 'Enjoy an easy session on a familiar route.' },
    { clan: 2, text: 'Try a small personal challenge.' },
  ] },
  { id: 'motivation', title: 'What helps you come back next time?', options: [
    { clan: 2, text: 'Seeing how I am improving over time.' },
    { clan: 1, text: 'Having a simple routine that fits my life.' },
    { clan: 4, text: 'Encouragement from people around me.' },
    { clan: 3, text: 'Having somewhere new to explore.' },
  ] },
  { id: 'challenge', title: 'Which kind of goal would you choose?', options: [
    { clan: 4, text: 'Contribute to a shared goal with a group.' },
    { clan: 3, text: 'Try several different routes.' },
    { clan: 2, text: 'Improve on one of my own previous results.' },
    { clan: 1, text: 'Keep showing up at a pace that feels right.' },
  ] },
  { id: 'celebrate', title: 'What would you most like to celebrate?', options: [
    { clan: 1, text: 'A routine I have managed to keep.' },
    { clan: 3, text: 'The places and experiences I have discovered.' },
    { clan: 4, text: 'The people I have encouraged along the way.' },
    { clan: 2, text: 'A personal milestone I have reached.' },
  ] },
] as const;
export const TOUR = [
  { title: 'Start at your own pace.', text: 'PaceClub is for walking, running, and cycling. Choose activities and goals that work for you. There is no required fitness level.', note: 'Location access is requested when you start recording an activity.' },
  { title: 'Your clan is a place to belong.', text: 'Your clan reflects your preferences. It does not limit your activities or give a scoring advantage. Clubs can bring people from different clans together.', note: 'You can enjoy your own progress and support others along the way.' },
  { title: 'Let your progress tell the story.', text: 'Activities will build your history over time. Eligible verified activities count toward challenges and rankings; pending activities wait for review.', note: 'Your Home is ready. Activity recording is the next part of PaceClub.' },
] as const;
export type Progress = {
  version: 1; revision: number; goal: GoalId | null; responses: Record<string, ClanId>;
  step: 'goal' | 'quiz' | 'result' | 'tutorial'; questionIndex: number;
  tutorialIndex: number; selectedClanId: ClanId | null;
};
export type Action =
  | { type: 'goal'; goal: string }
  | { type: 'answer'; questionId: string; clanId: number }
  | { type: 'confirm'; clanId: number }
  | { type: 'back' | 'review' | 'next' | 'finish' };
export const STORAGE_KEY = 'paceclub_onboarding_v1';
export function isClanId(value: unknown): value is ClanId { return value === 1 || value === 2 || value === 3 || value === 4; }
export function getClan(id: number | null) { return CLANS.find(clan => clan.id === id); }
export function isGoal(value: unknown): value is GoalId { return GOALS.some(goal => goal.id === value); }
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function isComplete(row: OnboardingRow | null, clanId: number | null) {
  return isClanId(clanId) && !!row?.tutorial_completed_at && Number.isFinite(Date.parse(row.tutorial_completed_at));
}
export function readProgress(answers: Record<string, unknown>, clanId: number | null): Progress {
  const saved = object(answers[STORAGE_KEY]);
  const responses: Record<string, ClanId> = {};
  for (const question of QUESTIONS) if (isClanId(object(saved.responses)[question.id])) responses[question.id] = object(saved.responses)[question.id] as ClanId;
  const existingClan = isClanId(clanId) ? clanId : null;
  const base: Progress = { version: 1, revision: Number.isSafeInteger(saved.revision) && Number(saved.revision) >= 0 ? Number(saved.revision) : 0,
    goal: isGoal(saved.goal) ? saved.goal : null, responses, step: 'goal', questionIndex: 0, tutorialIndex: 0, selectedClanId: null };
  // Previously assigned profiles retain their clan and only need the tour.
  if (saved.version !== 1) return existingClan ? { ...base, step: 'tutorial', selectedClanId: existingClan } : base;
  if (saved.step === 'tutorial' && isClanId(saved.selectedClanId) && saved.selectedClanId === existingClan) {
    return { ...base, step: 'tutorial', selectedClanId: existingClan,
      tutorialIndex: Number.isInteger(saved.tutorialIndex) ? Math.max(0, Math.min(TOUR.length - 1, Number(saved.tutorialIndex))) : 0 };
  }
  if (!base.goal) return base;
  const missing = QUESTIONS.findIndex(question => !responses[question.id]);
  if (saved.step === 'goal') return base;
  if ((saved.step === 'result' || saved.step === 'tutorial') && missing === -1) return { ...base, step: 'result' };
  const requested = Number.isInteger(saved.questionIndex) ? Math.max(0, Math.min(QUESTIONS.length - 1, Number(saved.questionIndex))) : 0;
  return { ...base, step: 'quiz', questionIndex: missing === -1 ? requested : Math.min(requested, missing) };
}
export function recommendations(responses: Record<string, ClanId>) {
  const scores: Record<ClanId, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const question of QUESTIONS) if (isClanId(responses[question.id])) scores[responses[question.id]]++;
  const highest = Math.max(...Object.values(scores));
  return { scores, winners: highest === 0 ? [] : CLANS.filter(clan => scores[clan.id] === highest).map(clan => clan.id) };
}
export function transition(current: Progress, action: Action): { progress: Progress; complete: boolean; clanId?: ClanId } {
  const p: Progress = { ...current, responses: { ...current.responses }, revision: current.revision + 1 };
  const invalid = () => { throw new Error('This step has changed. Reload the page and continue from your saved progress.'); };
  switch (action.type) {
    case 'goal':
      if (p.step !== 'goal' || !isGoal(action.goal)) return invalid();
      p.goal = action.goal; p.step = 'quiz'; p.questionIndex = 0; break;
    case 'answer':
      if (p.step !== 'quiz' || action.questionId !== QUESTIONS[p.questionIndex]?.id || !isClanId(action.clanId)) return invalid();
      p.responses[action.questionId] = action.clanId;
      if (p.questionIndex === QUESTIONS.length - 1) p.step = 'result'; else p.questionIndex++; break;
    case 'confirm':
      if (p.step !== 'result' || !isClanId(action.clanId) || QUESTIONS.some(q => !p.responses[q.id])) return invalid();
      p.selectedClanId = action.clanId; p.step = 'tutorial'; p.tutorialIndex = 0;
      return { progress: p, complete: false, clanId: action.clanId };
    case 'review':
      if (p.step !== 'result') return invalid();
      p.step = 'quiz'; p.questionIndex = 0; break;
    case 'back':
      if (p.step === 'quiz') { if (p.questionIndex > 0) p.questionIndex--; else p.step = 'goal'; }
      else if (p.step === 'tutorial' && p.tutorialIndex > 0) p.tutorialIndex--;
      else return invalid();
      break;
    case 'next':
      if (p.step !== 'tutorial' || p.tutorialIndex >= TOUR.length - 1) return invalid();
      p.tutorialIndex++; break;
    case 'finish':
      if (p.step !== 'tutorial' || p.tutorialIndex !== TOUR.length - 1 || !isClanId(p.selectedClanId)) return invalid();
      return { progress: p, complete: true };
    default: return invalid();
  }
  return { progress: p, complete: false };
}
