require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { uploadActivity } = require('../src/activity/sync.ts');
const { createActivity, finishActivity } = require('../src/activity/model.ts');
const points = Array.from({ length: 600 }, (_, i) => ({ sample: i, segment: i < 300 ? 0 : 1, timestamp: 100_000 + i * 2000, latitude: 16 + i * .00003, longitude: 120, accuracy: 5 }));
const activity = { ...finishActivity(createActivity('stable-id', 'alice', 'walk', 100_000), 1_300_000), distanceM: 2000, pointCount: 600, sync: 'queued' };
function backend() {
  const state = { user: 'alice', row: null, points: new Map(), insertions: 0, writes: 0, batch: 0, failBatch: 0, lostSubmit: false };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: state.user } }, error: null }) },
    from(table) {
      let op = 'select', payload;
      const query = {
        select() { return query; }, eq() { return query; }, maybeSingle() { return query; }, single() { return query; },
        insert(p) { op = 'insert'; payload = p; return query; }, update(p) { op = 'update'; payload = p; return query; },
        upsert(p, options) { assert.equal(options.ignoreDuplicates, true); op = 'points'; payload = p; return query; },
        then(resolve, reject) { return Promise.resolve().then(() => {
          if (op === 'select') return { data: state.row, error: null };
          state.writes++;
          if (state.row?.status === 'submitted') throw new Error('Input frozen');
          if (op === 'insert') { state.insertions++; state.row = { ...payload, status: 'recording' }; }
          if (op === 'update') { Object.assign(state.row, payload); }
          if (op === 'points') {
            state.batch++; if (state.batch === state.failBatch) throw new Error('Offline');
            for (const p of payload) if (!state.points.has(p.sample_number)) state.points.set(p.sample_number, p);
          }
          return { data: state.row, error: null };
        }).then(resolve, reject); },
      }; return query;
    },
    async rpc(_name, args) {
      state.writes++;
      if (args.p_status === 'submitted') {
        assert.equal(state.points.size, 600); assert.equal(state.row.reported_distance_m, 2000);
        state.row.status = 'submitted';
        if (state.lostSubmit) { state.lostSubmit = false; throw new Error('Response lost'); }
      } else state.row.status = args.p_status;
      return { error: null };
    },
  };
  return { state, client };
}
test('failed middle batch retries without duplicate activities or samples', async () => {
  const { state, client } = backend(); state.failBatch = 2;
  await assert.rejects(uploadActivity(client, activity, points), /Offline/); assert.equal(state.points.size, 250);
  await uploadActivity(client, activity, points);
  assert.equal(state.insertions, 1); assert.equal(state.points.size, 600); assert.equal(state.row.status, 'submitted');
  assert.deepEqual(state.row.sensor_summary.segment_starts, [0, 300]);
  assert.equal(state.row.distance_m, undefined); assert.equal(state.row.verified_at, undefined);
});
test('lost final response retries by reading status, without writing frozen input', async () => {
  const { state, client } = backend(); state.lostSubmit = true;
  await assert.rejects(uploadActivity(client, activity, points), /Response lost/);
  const writes = state.writes; await uploadActivity(client, activity, points);
  assert.equal(state.writes, writes); assert.equal(state.insertions, 1);
});
test('another account and incomplete local route are rejected before writes', async () => {
  const { state, client } = backend(); state.user = 'bob';
  await assert.rejects(uploadActivity(client, activity, points), /account/); assert.equal(state.writes, 0);
  state.user = 'alice'; await assert.rejects(uploadActivity(client, activity, points.slice(1)), /incomplete/); assert.equal(state.writes, 0);
});
