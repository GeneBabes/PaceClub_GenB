"use client";
import { useState } from "react";
import type { Dashboard, Item, Notice, RemoteActivity } from "@/lib/full-types";
import {
  checked,
  db,
  date,
  Feedback,
  km,
  minutes,
  rpc,
  useAction,
  useData,
} from "./data";
import { Chart } from "./charts";
export function Overview({ name }: { name: string }) {
  const q = useData(
    "overview",
    async () => ({
      dashboard: await rpc<Dashboard>("pc_dashboard"),
      recent: checked(
        await db()
          .from("activities")
          .select(
            "id,activity_type,status,started_at,source,distance_m,reported_distance_m",
          )
          .order("started_at", { ascending: false })
          .limit(5),
      ) as RemoteActivity[],
    }),
    ["activities", "reward_ledger"],
  );
  return (
    <>
      <div className="hero-copy">
        <p className="eyebrow">ONE STEP AT A TIME</p>
        <h1>
          A little movement.
          <br />A little more you.
        </h1>
        <p>
          Welcome back, {name.split(" ")[0]}. Make room for your next good
          habit.
        </p>
        <div className="actions">
          <a className="primary-link" href="/play">
            Find your next challenge ↗
          </a>
          <a href="/activities">Your activity history</a>
        </div>
      </div>
      <Feedback state={q} />
      {q.data && (
        <>
          <div className="stat-grid">
            <Stat
              label="Verified kilometres"
              value={km(q.data.dashboard.totals.distance_m)}
            />
            <Stat
              label="Active minutes"
              value={String(minutes(q.data.dashboard.totals.moving_seconds))}
            />
            <Stat
              label="Activities completed"
              value={String(q.data.dashboard.totals.activities)}
            />
          </div>
          <div className="pc-grid">
            <section className="card accent-card">
              <p className="eyebrow">YOUR PROGRESS</p>
              <h2>
                Level{" "}
                {1 +
                  Math.floor(Math.max(0, q.data.dashboard.balances.xp) / 500)}
              </h2>
              <p>
                {q.data.dashboard.balances.xp} XP ·{" "}
                {q.data.dashboard.balances.coins} cosmetic tokens
              </p>
              <p>
                {q.data.dashboard.competitive_ready
                  ? "Competitive play is unlocked. Choose a challenge that fits your pace."
                  : "Complete the tutorial and three verified GPS activities across two days to unlock competitive play."}
              </p>
              <a href="/rewards">Make it yours →</a>
            </section>
            <section className="card">
              <p className="eyebrow">KEEP YOUR OWN PACE</p>
              <h2>Record on your phone.</h2>
              <p>
                Choose a walk, run, or ride in the PaceClub mobile app. Your
                route stays private; share a photo and summary when you choose.
              </p>
              <a href="/import">Import a GPX activity</a>
              <p className="muted">
                Imports and practice sessions never earn ranked credit.
              </p>
            </section>
          </div>
          <section className="card">
            <div className="section-heading">
              <h2>Recent activity</h2>
              <a href="/activities">View all →</a>
            </div>
            {!q.data.recent.length ? (
              <p className="empty-note">
                Your first adventure starts with one step.
              </p>
            ) : (
              q.data.recent.map((a) => (
                <a className="list-row" href={`/activities/${a.id}`} key={a.id}>
                  <div>
                    <strong>{a.activity_type.toUpperCase()}</strong>
                    <p className="muted">
                      {date(a.started_at)} · {a.source}
                    </p>
                  </div>
                  <div>
                    <strong>
                      {km(
                        a.status === "verified"
                          ? a.distance_m
                          : a.reported_distance_m,
                      )}{" "}
                      km
                    </strong>
                    <p className={"status-pill " + a.status}>{a.status}</p>
                  </div>
                </a>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function Analytics() {
  const [type, setType] = useState("walk"),
    [distance, setDistance] = useState(1000),
    [insight, setInsight] = useState("");
  const a = useAction();
  const q = useData(
    "analytics-" + type,
    () => rpc<Dashboard>("pc_dashboard", { p_type: type }),
    ["activities"],
  );
  const weeks = q.data?.weeks || [];
  const bests = (q.data?.bests || [])
    .filter((b) => b.distance_m === distance)
    .reverse();
  return (
    <>
      <PageTitle
        eyebrow="KNOW YOUR PROGRESS"
        title="Every little bit adds up."
        text="Verified activity data, with pending sessions kept separate."
      />
      <div className="toolbar">
        <label>
          Activity type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="walk">Walking</option>
            <option value="run">Running</option>
            <option value="ride">Cycling</option>
          </select>
        </label>
        <label>
          Personal-best distance
          <select
            value={distance}
            onChange={(e) => setDistance(Number(e.target.value))}
          >
            {[1000, 5000, 10000, 21097, 42195].map((d) => (
              <option key={d} value={d}>
                {d / 1000} km
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback state={q} />
      {q.data && (
        <>
          <div className="stat-grid">
            <Stat
              label="Verified kilometres"
              value={km(q.data.totals.distance_m)}
            />
            <Stat
              label="Verified activities"
              value={String(q.data.totals.activities)}
            />
            <Stat label="Pending or flagged" value={String(q.data.pending)} />
          </div>
          <div className="pc-grid">
            <Chart
              title="Weekly distance"
              unit="km"
              points={weeks.map((w) => ({
                label: w.week_start,
                value: Number(w.distance_km),
              }))}
            />
            <Chart
              title="Pace trend"
              unit="min / km"
              line
              points={weeks
                .filter((w) => w.pace_min_per_km !== null)
                .map((w) => ({
                  label: w.week_start,
                  value: Number(w.pace_min_per_km),
                }))}
            />
            <Chart
              title="Activity time"
              unit="active minutes"
              points={weeks.map((w) => ({
                label: w.week_start,
                value: Number(w.active_minutes),
              }))}
            />
            <Chart
              title="Personal-best progress"
              unit="elapsed minutes"
              line
              points={bests.map((b) => ({
                label: b.started_at.slice(0, 10),
                value: Number(b.best_seconds) / 60,
              }))}
            />
          </div>
          <p className="muted">
            Weeks use Philippine time. Moving time comes from reliable GPS
            intervals. Personal bests use elapsed time to the fixed distance
            within the first uninterrupted segment; pauses cannot improve a
            result.
          </p>
          <section className="card">
            <p className="eyebrow">YOUR WEEK, EXPLAINED</p>
            <h2>A moment to reflect.</h2>
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  const res = await fetch("/api/insights", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type }),
                  });
                  const body = await res.json();
                  if (!res.ok) throw Error(body.error || "Summary unavailable");
                  setInsight(
                    body.text +
                      " " +
                      (body.mode === "ai"
                        ? "AI selected these checked highlights."
                        : "Calculated directly from your activity data."),
                  );
                }, "Summary ready.")
              }
            >
              Explain my progress
            </button>
            <Feedback state={a} />
            {insight && <p className="insight">{insight}</p>}
          </section>
        </>
      )}
    </>
  );
}
export function Rewards() {
  const a = useAction();
  const q = useData(
    "rewards",
    async () => ({
      dashboard: await rpc<Dashboard>("pc_dashboard"),
      items: checked(
        await db().from("reward_items").select("*").order("price_coins"),
      ) as Item[],
      inventory: checked(
        await db().from("user_inventory").select("item_id,equipped"),
      ) as { item_id: string; equipped: boolean }[],
    }),
    ["reward_ledger", "user_inventory"],
  );
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE MORE YOU"
        title="Wear your progress."
        text="Cosmetics change your look. They never increase distance, score, or captured area."
      />
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data && (
        <>
          <div className="stat-grid">
            <Stat
              label="Cosmetic tokens"
              value={String(q.data.dashboard.balances.coins)}
            />
            <Stat
              label="Experience"
              value={String(q.data.dashboard.balances.xp)}
            />
            <Stat
              label="Level"
              value={String(
                1 + Math.floor(Math.max(0, q.data.dashboard.balances.xp) / 500),
              )}
            />
          </div>
          <p className="muted">
            Simulated currency only. Each verified GPS activity earns up to 200
            XP and 20 tokens; imported and practice activities earn neither.
            Completed challenge goals and reviewed competition results can add
            tokens.
          </p>
          <div className="pc-grid">
            {q.data.items.map((item) => {
              const owned = q.data!.inventory.find(
                (i) => i.item_id === item.id,
              );
              return (
                <section
                  key={item.id}
                  className={
                    "card cosmetic-card " + (owned?.equipped ? "equipped" : "")
                  }
                >
                  <div className={"cosmetic-preview " + item.type}>
                    {item.type === "avatar_frame"
                      ? "◉"
                      : item.type === "badge"
                        ? "✦"
                        : item.type === "chat_bubble"
                          ? "A good day to move."
                          : "Aa"}
                  </div>
                  <p className="eyebrow">{item.type.replace("_", " ")}</p>
                  <h2>{item.name}</h2>
                  <p>
                    {item.price_coins} tokens {owned && "· Yours"}
                  </p>
                  <button
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await rpc(
                          owned ? "pc_equip_item" : "pc_buy_item",
                          owned
                            ? { p_id: item.id, p_equipped: !owned.equipped }
                            : { p_id: item.id },
                        );
                        q.reload();
                      })
                    }
                  >
                    {owned
                      ? owned.equipped
                        ? "Unequip"
                        : "Equip"
                      : "Unlock cosmetic"}
                  </button>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
export function Notifications() {
  const a = useAction();
  const [page, setPage] = useState(0);
  const q = useData(
    "notices-" + page,
    async () =>
      checked(
        await db()
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .range(page * 30, page * 30 + 29),
      ) as Notice[],
    ["notifications"],
  );
  return (
    <>
      <PageTitle
        eyebrow="STAY IN THE LOOP"
        title="Your updates."
        text="Activity decisions, challenge results, and changes in your play zones."
      />
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.length === 0 && (
        <section className="card empty-note">You’re all caught up.</section>
      )}
      {q.data?.map((n) => (
        <section
          className={"card notification " + (!n.read_at ? "unread" : "")}
          key={n.id}
        >
          <div className="section-heading">
            <h2>{n.title}</h2>
            <span className="muted">{date(n.created_at)}</span>
          </div>
          <p>{n.body}</p>
          {!n.read_at && (
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  checked(
                    await db()
                      .from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .eq("id", n.id),
                  );
                  q.reload();
                })
              }
            >
              Mark as read
            </button>
          )}
        </section>
      ))}
      <div className="actions">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <button
          disabled={!q.data || q.data.length < 30}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
export function PageTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <header className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
    </header>
  );
}
