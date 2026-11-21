"use client";
import { useState } from "react";
import type { Profile, RemoteActivity } from "@/lib/full-types";
import { routeGeometry } from "@/lib/route-geometry";
import { routeSegments, type RoutePoint } from "@/lib/activities";
import { checked, db, date, Feedback, rpc, useAction, useData } from "./data";
import { PageTitle } from "./overview";
type Appeal = {
  id: string;
  activity_id: string;
  reason: string;
  status: string;
  review_note: string | null;
};
type Report = {
  id: string;
  reason: string;
  snapshot?: { body?: string };
  message_snapshot?: { body?: string };
  created_at: string;
};
export function Moderation({ userId, role }: { userId: string; role: string }) {
  const [selected, setSelected] = useState(""),
    [showVerified, setShowVerified] = useState(false),
    a = useAction();
  const q = useData(
    "moderation-" + role + showVerified,
    async () => {
      if (!["admin", "moderator"].includes(role)) return null;
      return {
        activities: checked(
          await db()
            .from("activities")
            .select("*")
            .in(
              "status",
              showVerified
                ? ["verified"]
                : ["flagged", "submitted", "rejected"],
            )
            .order("started_at", { ascending: false })
            .limit(100),
        ) as RemoteActivity[],
        appeals: checked(
          await db()
            .from("activity_appeals")
            .select("*")
            .eq("status", "pending"),
        ) as Appeal[],
        profiles: checked(
          await db().from("profiles").select("id,display_name").limit(1000),
        ) as Profile[],
        reports: checked(
          await db()
            .from("content_reports")
            .select("*")
            .eq("status", "pending")
            .limit(100),
        ) as Report[],
        messages: checked(
          await db()
            .from("message_reports")
            .select("*")
            .eq("status", "pending")
            .limit(100),
        ) as Report[],
      };
    },
    ["activities", "activity_appeals"],
  );
  if (!["admin", "moderator"].includes(role))
    return (
      <PageTitle
        eyebrow="RESTRICTED"
        title="Moderator access required."
        text="This page is restricted by the backend as well as the interface."
      />
    );
  return (
    <>
      <PageTitle
        eyebrow="FAIR PLAY, HUMAN JUDGMENT"
        title="Review with context."
        text="Signals can be imperfect. Explain decisions, preserve the audit trail, and let another moderator review your own activities."
      />
      <Feedback state={q} />
      <Feedback state={a} />
      <section className="card">
        <h2>Activity review queue</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showVerified}
            onChange={(e) => {
              setShowVerified(e.target.checked);
              setSelected("");
            }}
          />
          Show verified activities for a correction
        </label>
        {q.data?.activities.map((x) => (
          <div className="list-row" key={x.id}>
            <div>
              <strong>
                {q.data?.profiles.find((p) => p.id === x.user_id)
                  ?.display_name || "Athlete"}{" "}
                · {x.activity_type}
              </strong>
              <p>
                {date(x.started_at)} · {x.status}
              </p>
              <p>{x.verification_note}</p>
              {q.data?.appeals
                .filter((p) => p.activity_id === x.id)
                .map((p) => (
                  <p className="soft-note" key={p.id}>
                    Appeal: {p.reason}
                  </p>
                ))}
            </div>
            <button
              className="secondary"
              onClick={() => setSelected(selected === x.id ? "" : x.id)}
            >
              Review
            </button>
          </div>
        ))}
        {q.data?.activities.length === 0 && (
          <p className="empty-note">No activities need review.</p>
        )}
      </section>
      {selected && (
        <section className="card">
          <ReviewRoute id={selected} />
          {q.data?.activities.find((x) => x.id === selected)?.user_id ===
          userId ? (
            <p className="soft-note">
              Another moderator must decide your own activity.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void a.run(async () => {
                  if (showVerified) {
                    if (
                      !window.confirm(
                        "Revoke this activity and reconcile its rewards, challenge credit and territory?",
                      )
                    )
                      return;
                    await rpc("pc_revoke_activity", {
                      p_id: selected,
                      p_note: f.get("note"),
                    });
                  } else
                    await rpc("pc_review_activity", {
                      p_id: selected,
                      p_accept: f.get("decision") === "accept",
                      p_note: f.get("note"),
                    });
                  setSelected("");
                  q.reload();
                }, "Review saved and athlete notified.");
              }}
            >
              <label>
                Decision
                <select name="decision">
                  {!showVerified && (
                    <option value="accept">
                      Approve reliable recalculated measurements
                    </option>
                  )}
                  <option value="reject">Reject</option>
                </select>
              </label>
              <label>
                Explanation
                <textarea name="note" minLength={3} maxLength={2000} required />
              </label>
              <button disabled={a.busy}>Save review</button>
            </form>
          )}
        </section>
      )}
      <div className="pc-grid">
        {(["reports", "messages"] as const).map((kind) => (
          <section key={kind} className="card">
            <h2>{kind === "reports" ? "Feed reports" : "Message reports"}</h2>
            {q.data?.[kind].map((r) => (
              <div className="comment" key={r.id}>
                <p>
                  {r.snapshot?.body ||
                    r.message_snapshot?.body ||
                    "Reported content"}
                </p>
                <strong>{r.reason}</strong>
                <div className="actions">
                  {[true, false].map((remove) => (
                    <button
                      className={remove ? "danger" : "secondary"}
                      key={String(remove)}
                      disabled={a.busy}
                      onClick={() =>
                        void a.run(async () => {
                          await rpc(
                            kind === "reports"
                              ? "pc_review_content"
                              : "pc_review_message_report",
                            kind === "reports"
                              ? { p_id: r.id, p_remove: remove }
                              : { p_report_id: r.id, p_remove: remove },
                          );
                          q.reload();
                        }, "Report reviewed.")
                      }
                    >
                      {remove ? "Remove content" : "Dismiss report"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {q.data?.[kind].length === 0 && (
              <p className="muted">No pending reports.</p>
            )}
          </section>
        ))}
      </div>
      <p className="muted">
        Territory claims and reversals are reviewed on the Territory page. Only
        an administrator can approve new play zones.
      </p>
    </>
  );
}
export function ReviewRoute({ id }: { id: string }) {
  const q = useData("review-route-" + id, async () => {
    const activity = checked(
      await db()
        .from("activities")
        .select("sensor_summary,source,verification_note")
        .eq("id", id)
        .single(),
    );
    const points: RoutePoint[] = [];
    for (let offset = 0; offset < 25000; offset += 1000) {
      const batch = checked(
        await db()
          .from("activity_points")
          .select("sample_number,recorded_at,latitude,longitude,accuracy_m")
          .eq("activity_id", id)
          .order("sample_number")
          .range(offset, offset + 999),
      ) as RoutePoint[];
      points.push(...batch);
      if (batch.length < 1000) break;
    }
    return { activity, points };
  });
  const route = q.data?.activity
    ? routeGeometry(
        routeSegments(q.data.points, q.data.activity.sensor_summary || {}),
        620,
        320,
      )
    : null;
  return (
    <>
      <Feedback state={q} />
      {q.data?.activity && route && (
        <>
          <h2>Saved route · {q.data.activity.source}</h2>
          <svg
            className="route-trace"
            viewBox="0 0 620 320"
            role="img"
            aria-label="Saved route; gaps remain separate"
          >
            <rect width="620" height="320" fill="#eef3e9" rx="12" />
            {route.paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="#245741"
                strokeWidth="3"
              />
            ))}
          </svg>
          <p>
            {q.data.points.length} samples. {q.data.activity.verification_note}
          </p>
          <details>
            <summary>Sensor and pause metadata</summary>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(q.data.activity.sensor_summary, null, 2)}
            </pre>
          </details>
        </>
      )}
    </>
  );
}
export function AthleteAppeal({ id, status }: { id: string; status: string }) {
  const a = useAction();
  const q = useData(
    "appeal-" + id,
    async () =>
      checked(
        await db()
          .from("activity_appeals")
          .select("*")
          .eq("activity_id", id)
          .maybeSingle(),
      ) as Appeal | null,
    ["activity_appeals"],
  );
  if (!["flagged", "rejected", "submitted"].includes(status) && !q.data)
    return null;
  return (
    <section className="card">
      <h2>
        {status === "submitted" ? "Check verification" : "Activity appeal"}
      </h2>
      <Feedback state={q} />
      <Feedback state={a} />
      {status === "submitted" ? (
        <button
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await rpc("pc_verify_activity", { p_id: id });
              window.location.reload();
            }, "Verification checked.")
          }
        >
          Check activity
        </button>
      ) : q.data ? (
        <>
          <p>Appeal: {q.data.status}</p>
          <p>{q.data.reason}</p>
          {q.data.review_note && (
            <p className="soft-note">{q.data.review_note}</p>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void a.run(async () => {
              await rpc("pc_submit_appeal", {
                p_id: id,
                p_reason: f.get("reason"),
              });
              q.reload();
            }, "Appeal submitted for review.");
          }}
        >
          <label>
            Tell us what happened
            <textarea name="reason" minLength={3} maxLength={2000} required />
          </label>
          <button disabled={a.busy}>Submit appeal</button>
        </form>
      )}
    </section>
  );
}
