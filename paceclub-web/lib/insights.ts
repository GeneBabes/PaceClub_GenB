import type { Dashboard } from "./full-types";
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
export function insightFacts(d: Dashboard, type: string) {
  const count = number(d.totals.activities),
    distance = number(Number(d.totals.distance_m)) / 1000,
    minutes = Math.round(number(d.totals.moving_seconds) / 60);
  const facts: Record<string, string> = {
    total: `You have ${count} verified ${type} activities covering ${distance.toFixed(2)} km.`,
    time: `Those activities include ${minutes} active minutes.`,
    pace: "Keep choosing a pace and schedule that suit your day.",
  };
  if (!count)
    facts.total = `Your first verified ${type} activity will start your progress story.`;
  if (d.pending > 0)
    facts.pending = `${number(d.pending)} activities are pending or flagged and are kept separate from these totals.`;
  const weeks = [...d.weeks].sort((a, b) =>
    a.week_start.localeCompare(b.week_start),
  );
  if (weeks.length) {
    const last = weeks.at(-1)!;
    facts.week = `For the week beginning ${last.week_start.slice(0, 10)}, you recorded ${number(Number(last.distance_km)).toFixed(2)} km and ${Math.round(number(Number(last.active_minutes)))} active minutes.`;
  }
  return facts;
}
export function selectInsights(value: unknown, facts: Record<string, string>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (
    Object.keys(o).length !== 1 ||
    !Array.isArray(o.highlights) ||
    o.highlights.length < 1 ||
    o.highlights.length > 3
  )
    return null;
  const ids = o.highlights;
  if (
    ids.some((id) => typeof id !== "string" || !Object.hasOwn(facts, id)) ||
    new Set(ids).size !== ids.length
  )
    return null;
  return ids.map((id) => facts[id]).join(" ");
}
export function fallbackInsight(facts: Record<string, string>) {
  return [
    facts.total,
    facts.week || facts.time,
    facts.pending || facts.pace,
  ].join(" ");
}
