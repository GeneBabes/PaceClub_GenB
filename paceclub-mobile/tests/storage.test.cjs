require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const m = require('../src/activity/model.ts');
const db = new DatabaseSync(':memory:');
let failPoint = false;
const adapter = {
  execAsync: async sql => db.exec(sql),
  runAsync: async (sql, ...args) => { if (failPoint && sql.startsWith('INSERT INTO points')) throw new Error('Disk full'); return db.prepare(sql).run(...args); },
  getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
  getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
  withExclusiveTransactionAsync: async fn => { db.exec('BEGIN'); try { await fn(adapter); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
};
const original = Module._load;
Module._load = function(name, ...args) { return name === 'expo-sqlite' ? { openDatabaseAsync: async () => adapter } : original.call(this, name, ...args); };
const { localStore } = require('../src/activity/store.ts');
Module._load = original;

test('SQLite point/session commits are atomic and owner-scoped; queued drafts are retained', async () => {
  const a = m.createActivity('one', 'alice', 'walk', 100_000);
  await localStore.save(a);
  await assert.rejects(localStore.save(m.createActivity('two', 'alice', 'walk', 100_000)));
  const accepted = m.addFix(a, { timestamp: 101_000, latitude: 0, longitude: 0, accuracy: 5 }, 101_000);
  failPoint = true; await assert.rejects(localStore.save(accepted.activity, accepted.point)); failPoint = false;
  assert.equal((await localStore.list('alice'))[0].pointCount, 0);
  assert.equal((await localStore.points('alice', 'one')).length, 0);
  await localStore.save(accepted.activity, accepted.point);
  assert.equal((await localStore.points('alice', 'one')).length, 1);
  assert.deepEqual(await localStore.list('bob'), []); assert.deepEqual(await localStore.points('bob', 'one'), []);
  await localStore.discard('bob', 'one'); assert.equal((await localStore.list('alice')).length, 1);
  await localStore.save(m.finishActivity(accepted.activity, 120_000));
  await localStore.syncState('alice', 'one', 'queued', 'Offline');
  await assert.rejects(localStore.discard('alice', 'one'));
  assert.equal((await localStore.list('alice'))[0].syncError, 'Offline');
  await localStore.syncState('alice', 'one', 'synced');
  assert.equal((await localStore.list('alice'))[0].sync, 'synced');
  await localStore.save(m.createActivity('two', 'alice', 'run', 130_000));
  await localStore.discard('alice', 'two'); assert.equal((await localStore.list('alice')).length, 1);
  db.close();
});
