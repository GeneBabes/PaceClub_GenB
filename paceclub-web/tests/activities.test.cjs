const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; new Function('module', 'exports', code)(module, module.exports); return module.exports;
}
const { metrics, statusLabel, routeSegments, formatDuration, formatPace } = load('lib/activities.ts');
test('unverified history always uses reported fields, even if verified fields are present', () => {
  const a = { status: 'submitted', reported_distance_m: 12, reported_moving_seconds: 10, reported_elapsed_seconds: 20, distance_m: 900, moving_seconds: 600, elapsed_seconds: 650 };
  assert.equal(metrics(a).distance, 12); assert.equal(metrics({ ...a, status: 'verified' }).distance, 900);
  assert.equal(statusLabel('submitted'), 'Pending verification');
});
test('route segments honor manual pauses, missing samples, and GPS gaps', () => {
  const points = [0, 1, 2, 4, 5].map((n, i) => ({ sample_number: n, latitude: 16, longitude: 120 + n / 1000, recorded_at: new Date(100000 + i * 3000 + (i === 4 ? 30_000 : 0)).toISOString() }));
  assert.deepEqual(routeSegments(points, { segment_starts: [0, 2] }).map(p => p.segment), [0, 0, 1, 2, 3]);
});
test('missing and tiny metrics render honestly', () => {
  assert.equal(formatDuration(null), '—'); assert.equal(formatDuration(3661), '01:01:01');
  assert.equal(formatPace(0, 120), '—'); assert.equal(formatPace(1000, 365), '6:05');
});
