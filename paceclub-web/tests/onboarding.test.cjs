const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/onboarding.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const moduleUnderTest = new Module(filename, module);
moduleUnderTest._compile(compiled.outputText, filename);
const { CLANS, QUESTIONS, TOUR, STORAGE_KEY, readProgress, transition, recommendations, isComplete } = moduleUnderTest.exports;
function answerQuiz(answers = [1, 1, 1, 1, 1]) {
  let p = transition(readProgress({}, null), { type: 'goal', goal: 'habit' }).progress;
  QUESTIONS.forEach((q, i) => { p = transition(p, { type: 'answer', questionId: q.id, clanId: answers[i] }).progress; });
  return p;
}
test('new accounts start with their goal', () => assert.equal(readProgress({}, null).step, 'goal'));
test('existing assigned clans are preserved and go to the tour', () => {
  for (const clan of CLANS) {
    const p = readProgress({}, clan.id);
    assert.equal(p.step, 'tutorial'); assert.equal(p.selectedClanId, clan.id);
  }
});
test('every clan can be recommended by preferences alone', () => {
  for (const c of CLANS) assert.deepEqual(recommendations(answerQuiz(Array(5).fill(c.id)).responses).winners, [c.id]);
});
test('ties are retained for an explicit choice', () => assert.deepEqual(recommendations(answerQuiz([1, 2, 1, 2, 3]).responses).winners, [1, 2]));
test('the user may confirm a clan other than the suggestion', () => {
  const next = transition(answerQuiz(), { type: 'confirm', clanId: 4 });
  assert.equal(next.clanId, 4); assert.equal(next.progress.selectedClanId, 4); assert.equal(next.progress.step, 'tutorial');
});
test('partial answers resume after reloading', () => {
  let p = transition(readProgress({}, null), { type: 'goal', goal: 'explore' }).progress;
  p = transition(p, { type: 'answer', questionId: QUESTIONS[0].id, clanId: 3 }).progress;
  const resumed = readProgress({ [STORAGE_KEY]: p }, null);
  assert.equal(resumed.questionIndex, 1); assert.equal(resumed.responses.good_day, 3); assert.equal(resumed.goal, 'explore');
});
test('reviewing answers retains all earlier choices and recomputes the result', () => {
  const p = transition(answerQuiz(), { type: 'review' }).progress;
  const changed = transition(p, { type: 'answer', questionId: QUESTIONS[0].id, clanId: 4 }).progress;
  assert.equal(changed.responses.good_day, 4); assert.equal(Object.keys(changed.responses).length, 5);
  assert.equal(recommendations(changed.responses).scores[1], 4);
});
test('invalid clan IDs and early confirmation are rejected', () => {
  assert.throws(() => transition(answerQuiz(), { type: 'confirm', clanId: 9 }));
  assert.throws(() => transition(readProgress({}, null), { type: 'confirm', clanId: 1 }));
});
test('answers from the wrong question cannot skip steps', () => {
  const p = transition(readProgress({}, null), { type: 'goal', goal: 'habit' }).progress;
  assert.throws(() => transition(p, { type: 'answer', questionId: QUESTIONS[4].id, clanId: 1 }));
});
test('tutorial cannot finish until the last page', () => {
  let p = transition(answerQuiz(), { type: 'confirm', clanId: 1 }).progress;
  assert.throws(() => transition(p, { type: 'finish' }));
  for (let i = 1; i < TOUR.length; i++) p = transition(p, { type: 'next' }).progress;
  assert.equal(transition(p, { type: 'finish' }).complete, true);
});
test('tutorial resumes at the last saved page', () => {
  let p = transition(answerQuiz(), { type: 'confirm', clanId: 1 }).progress;
  p = transition(p, { type: 'next' }).progress;
  assert.equal(readProgress({ [STORAGE_KEY]: p }, 1).tutorialIndex, 1);
});
test('a failed profile update returns to clan confirmation after reload', () => {
  const p = transition(answerQuiz(), { type: 'confirm', clanId: 4 }).progress;
  assert.equal(readProgress({ [STORAGE_KEY]: p }, null).step, 'result');
  assert.equal(readProgress({ [STORAGE_KEY]: p }, 1).step, 'result');
});
test('Home requires both a valid clan and tutorial completion', () => {
  assert.equal(isComplete({ answers: {}, tutorial_completed_at: null }, 1), false);
  assert.equal(isComplete({ answers: {}, tutorial_completed_at: '2026-11-18T10:00:00Z' }, null), false);
  assert.equal(isComplete({ answers: {}, tutorial_completed_at: 'bad-date' }, 1), false);
  assert.equal(isComplete({ answers: {}, tutorial_completed_at: '2026-11-18T10:00:00Z' }, 1), true);
});
test('malformed saved answers cannot bypass the quiz', () => {
  const saved = { version: 1, step: 'result', goal: 'habit', responses: { good_day: 99 }, questionIndex: 100 };
  const p = readProgress({ [STORAGE_KEY]: saved }, null);
  assert.equal(p.step, 'quiz'); assert.equal(p.questionIndex, 0); assert.deepEqual(p.responses, {});
});
test('a transition leaves its input intact', () => {
  const p = answerQuiz(); const before = JSON.stringify(p);
  transition(p, { type: 'confirm', clanId: 1 });
  assert.equal(JSON.stringify(p), before);
});
