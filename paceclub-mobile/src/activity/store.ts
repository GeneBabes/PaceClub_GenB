import { openDatabaseAsync } from "expo-sqlite";
import type { LocalActivity, Point } from "./model";

const database = openDatabaseAsync("paceclub-activities-v1.db").then(
  async (db) => {
    await db.execAsync(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, phase TEXT NOT NULL, started INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_activity ON sessions(owner) WHERE phase <> 'finished';
    CREATE TABLE IF NOT EXISTS points (activity TEXT NOT NULL, sample INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(activity,sample));`);
    return db;
  },
);
// All DB access shares one queue. Point + session metadata commit together.
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.catch(() => {});
  return result;
}
export const localStore = {
  save(a: LocalActivity, point?: Point) {
    return serial(async () => {
      const db = await database;
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          "INSERT INTO sessions(id,owner,phase,started,body) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,body=excluded.body",
          a.id,
          a.userId,
          a.phase,
          a.startedAt,
          JSON.stringify(a),
        );
        if (point)
          await tx.runAsync(
            "INSERT INTO points(activity,sample,body) VALUES(?,?,?)",
            a.id,
            point.sample,
            JSON.stringify(point),
          );
      });
    });
  },
  list(owner: string) {
    return serial(async () => {
      const rows = await (
        await database
      ).getAllAsync<{ body: string }>(
        "SELECT body FROM sessions WHERE owner=? ORDER BY started DESC",
        owner,
      );
      return rows.map((row) => JSON.parse(row.body) as LocalActivity);
    });
  },
  points(owner: string, id: string) {
    return serial(async () => {
      const rows = await (
        await database
      ).getAllAsync<{ body: string }>(
        "SELECT p.body FROM points p JOIN sessions s ON s.id=p.activity WHERE s.owner=? AND s.id=? ORDER BY p.sample",
        owner,
        id,
      );
      return rows.map((row) => JSON.parse(row.body) as Point);
    });
  },
  syncState(
    owner: string,
    id: string,
    state: LocalActivity["sync"],
    error = "",
  ) {
    return serial(async () => {
      const db = await database;
      const row = await db.getFirstAsync<{ body: string }>(
        "SELECT body FROM sessions WHERE owner=? AND id=?",
        owner,
        id,
      );
      if (!row) throw new Error("Saved activity not found.");
      const a: LocalActivity = JSON.parse(row.body);
      if (a.phase !== "finished") throw new Error("Finish the activity first.");
      await db.runAsync(
        "UPDATE sessions SET body=? WHERE owner=? AND id=?",
        JSON.stringify({ ...a, sync: state, syncError: error }),
        owner,
        id,
      );
    });
  },
  markUploaded(owner: string, id: string, safetySignature: string) {
    return serial(async () => {
      const db = await database;
      const row = await db.getFirstAsync<{ body: string }>(
        "SELECT body FROM sessions WHERE owner=? AND id=?",
        owner,
        id,
      );
      if (!row) return;
      const a: LocalActivity = JSON.parse(row.body);
      await db.runAsync(
        "UPDATE sessions SET body=? WHERE owner=? AND id=?",
        JSON.stringify({
          ...a,
          sync:
            JSON.stringify(a.safetyEvents || []) === safetySignature
              ? "synced"
              : "queued",
          syncError: "",
        }),
        owner,
        id,
      );
    });
  },
  discard(owner: string, id: string) {
    return serial(async () => {
      const db = await database;
      const row = await db.getFirstAsync<{ body: string }>(
        "SELECT body FROM sessions WHERE owner=? AND id=?",
        owner,
        id,
      );
      if (!row) return;
      const a: LocalActivity = JSON.parse(row.body);
      if (a.sync !== "draft")
        throw new Error(
          "A queued or submitted activity cannot be discarded here.",
        );
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM points WHERE activity=?", id);
        await tx.runAsync(
          "DELETE FROM sessions WHERE owner=? AND id=?",
          owner,
          id,
        );
      });
    });
  },
};
