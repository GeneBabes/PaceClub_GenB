"use client";
import { useState } from "react";
import type { Challenge, Club, Profile } from "@/lib/full-types";
import { checked, db, date, Feedback, rpc, useAction, useData } from "./data";
import { PageTitle } from "./overview";
export function Play({ userId, role }: { userId: string; role: string }) {
  const q = useData(
    "play",
    async () => ({
      challenges: checked(
        await db()
          .from("challenges")
          .select("*")
          .order("starts_at", { ascending: false })
          .limit(100),
      ) as Challenge[],
      joined: checked(
        await db()
          .from("challenge_participants")
          .select("challenge_id")
          .eq("user_id", userId),
      ) as { challenge_id: string }[],
      clubs: await rpc<Club[]>("pc_club_directory"),
      ready: await rpc<boolean>("pc_competitive_ready"),
    }),
    ["challenges", "challenge_entries", "activities"],
  );
  const a = useAction();
  const [selected, setSelected] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="FIND YOUR NEXT STEP"
        title="A goal worth showing up for."
        text="Start with a personal quest, or join a shared challenge. Walking, running, and cycling have separate competitions."
      />
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data && (
        <>
          <p className="soft-note">
            {q.data.ready
              ? "Competitive play is unlocked."
              : "Casual quests are available now. Ranked play unlocks after the tutorial and three verified GPS activities across two Philippine dates."}{" "}
            Join before starting, then select the challenge in the mobile
            recorder. Imports and practice do not count.
          </p>
          <details className="card">
            <summary>Create a quest or challenge</summary>
            <ChallengeForm
              role={role}
              clubs={q.data.clubs}
              onSaved={q.reload}
            />
          </details>
          <div className="pc-grid">
            {q.data.challenges.map((c) => {
              const joined = q.data!.joined.some(
                (j) => j.challenge_id === c.id,
              );
              return (
                <section key={c.id} className="card">
                  <div className="section-heading">
                    <span className="tag">
                      {c.personal
                        ? "PERSONAL QUEST"
                        : c.mode.toUpperCase().replace("_", " ")}
                    </span>
                    <span className="tag">{c.activity_type}</span>
                  </div>
                  <h2>{c.title}</h2>
                  <p>
                    {(c.rules.goal_m / 1000).toLocaleString()} km{" "}
                    {c.mode === "time_trial"
                      ? "fixed-distance elapsed effort"
                      : "goal"}
                  </p>
                  <p className="muted">
                    {date(c.starts_at)} – {date(c.ends_at)}
                  </p>
                  <details>
                    <summary>Rules & rewards</summary>
                    <p>
                      GPS {c.activity_type} activities only, started after
                      joining and within these dates. Select this challenge
                      before recording.
                      {c.club_id
                        ? " Select its club too; you must be a member throughout the activity."
                        : ""}
                    </p>
                    <p>
                      {c.mode === "time_trial"
                        ? "Best eligible elapsed time wins; pauses never reduce elapsed time."
                        : `${c.rules.daily_cap_m / 1000} km per athlete per day counts, using Philippine dates. Reaching the goal earns 50 cosmetic tokens.`}{" "}
                      Results close after a 48-hour review window. Ranked first
                      place earns 100 tokens and 100 season rank points; ties
                      share the prize.
                    </p>
                    <p>{c.rules.tie_rule}</p>
                  </details>
                  <div className="actions">
                    {!joined && c.status === "open" ? (
                      <button
                        disabled={
                          a.busy || (!q.data!.ready && c.mode !== "casual")
                        }
                        onClick={() =>
                          void a.run(async () => {
                            await rpc("pc_join_challenge", { p_id: c.id });
                            q.reload();
                          }, "Joined. Select this challenge before your next recording.")
                        }
                      >
                        Join challenge
                      </button>
                    ) : (
                      <span className="status-pill">
                        {joined ? "Joined" : c.status}
                      </span>
                    )}
                    <button
                      className="secondary"
                      onClick={() => setSelected(selected === c.id ? "" : c.id)}
                    >
                      Leaderboard
                    </button>
                    {(c.created_by === userId || role !== "athlete") &&
                      !c.finalized_at &&
                      new Date(c.ends_at).getTime() + 172800000 <
                        Date.now() && (
                        <button
                          onClick={() =>
                            void a.run(async () => {
                              await rpc("pc_finalize_challenge", {
                                p_id: c.id,
                              });
                              q.reload();
                            })
                          }
                        >
                          Finalize results
                        </button>
                      )}
                  </div>
                  {selected === c.id && (
                    <Leaderboard
                      id={c.id}
                      trial={c.mode === "time_trial"}
                      shared={c.mode === "club"}
                    />
                  )}
                </section>
              );
            })}
          </div>
          {!q.data.challenges.length && (
            <section className="card empty-note">
              No challenges yet. Create your first personal quest above.
            </section>
          )}
        </>
      )}
    </>
  );
}
function ChallengeForm({
  role,
  clubs,
  onSaved,
}: {
  role: string;
  clubs: Club[];
  onSaved: () => void;
}) {
  const a = useAction();
  const [mode, setMode] = useState("casual");
  const owners = clubs.filter((c) => c.my_role === "owner");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void a.run(async () => {
          await rpc("pc_create_challenge", {
            p_title: f.get("title"),
            p_type: f.get("type"),
            p_mode: mode,
            p_start: new Date(String(f.get("start"))).toISOString(),
            p_end: new Date(String(f.get("end"))).toISOString(),
            p_goal: Math.round(Number(f.get("goal")) * 1000),
            p_cap: Math.round(Number(f.get("cap")) * 1000),
            p_club: f.get("club") || null,
          });
          onSaved();
        }, "Challenge created. Join it before recording.");
      }}
    >
      <label>
        Title
        <input name="title" required maxLength={120} />
      </label>
      <div className="pc-grid">
        <label>
          Activity
          <select name="type">
            <option value="walk">Walk</option>
            <option value="run">Run</option>
            <option value="ride">Ride</option>
          </select>
        </label>
        <label>
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="casual">Casual quest</option>
            {(owners.length > 0 || role !== "athlete") && (
              <>
                <option value="weekly">Weekly distance</option>
                <option value="club">Club challenge</option>
                <option value="time_trial">Time trial</option>
              </>
            )}
          </select>
        </label>
      </div>
      <label>
        Club
        <select name="club">
          <option value="">
            {role === "athlete" ? "Personal quest" : "Global challenge"}
          </option>
          {owners.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="pc-grid">
        <label>
          Starts (your local time)
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          Ends (your local time)
          <input name="end" type="datetime-local" required />
        </label>
      </div>
      <div className="pc-grid">
        <label>
          Goal (km)
          {mode === "time_trial" ? (
            <select name="goal">
              {[1, 5, 10, 21.097, 42.195].map((n) => (
                <option value={n} key={n}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              name="goal"
              type="number"
              min=".1"
              max="1000"
              step=".1"
              defaultValue="5"
              required
            />
          )}
        </label>
        <label>
          Daily distance cap (km)
          <input
            name="cap"
            type="number"
            min=".1"
            max="100"
            step=".1"
            defaultValue="20"
            required
          />
        </label>
      </div>
      <p className="muted">
        Published rules are fixed. A normal account creates personal casual
        quests; club owners manage their club’s challenges, and moderators can
        publish global challenges.
      </p>
      <button disabled={a.busy}>Create</button>
      <Feedback state={a} />
    </form>
  );
}
function Leaderboard({
  id,
  trial,
  shared,
}: {
  id: string;
  trial: boolean;
  shared: boolean;
}) {
  const q = useData(
    "leaderboard-" + id,
    async () => {
      const entries = checked(
        await db()
          .from("pc_challenge_leaderboard")
          .select("*")
          .eq("challenge_id", id)
          .order("position")
          .limit(100),
      ) as { user_id: string; position: number; total_points: number }[];
      const users = entries.length
        ? (checked(
            await db()
              .from("profiles")
              .select("id,display_name")
              .in(
                "id",
                entries.map((e) => e.user_id),
              ),
          ) as Profile[])
        : [];
      return entries.map((e) => ({
        ...e,
        name: users.find((u) => u.id === e.user_id)?.display_name || "Athlete",
      }));
    },
    ["challenge_entries"],
  );
  return (
    <>
      <Feedback state={q} />
      {shared && q.data && (
        <p className="soft-note">
          Shared club progress:{" "}
          {(
            q.data.reduce((s, e) => s + Number(e.total_points), 0) / 1000
          ).toFixed(2)}{" "}
          km. Each contributor receives the goal reward when the shared goal is
          reached.
        </p>
      )}
      {!q.data?.length ? (
        <p className="muted">Eligible verified activities will appear here.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Athlete</th>
              <th>{trial ? "Best elapsed" : "Counted distance"}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((e) => (
              <tr key={e.user_id}>
                <td>{e.position}</td>
                <td>{e.name}</td>
                <td>
                  {trial
                    ? (1000000 / Number(e.total_points) / 60).toFixed(2) +
                      " min"
                    : (Number(e.total_points) / 1000).toFixed(2) + " km"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
export function Clubs({ userId }: { userId: string }) {
  const q = useData("clubs", () => rpc<Club[]>("pc_club_directory"), [
    "club_members",
  ]);
  const a = useAction();
  const [selected, setSelected] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="BETTER TOGETHER"
        title="Find your people."
        text="Join a club, mix clans freely, and work toward shared goals."
      />
      <details className="card">
        <summary>Create a club</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void a.run(async () => {
              await rpc("pc_create_club", {
                p_name: f.get("name"),
                p_description: f.get("description"),
              });
              q.reload();
            }, "Club created.");
          }}
        >
          <label>
            Club name
            <input name="name" maxLength={80} required />
          </label>
          <label>
            About your club
            <textarea name="description" maxLength={2000} />
          </label>
          <button disabled={a.busy}>Create club</button>
        </form>
      </details>
      <Feedback state={q} />
      <Feedback state={a} />
      <div className="pc-grid">
        {q.data?.map((c) => (
          <section className="card" key={c.id}>
            <p className="eyebrow">
              {c.member_count} MEMBERS · {c.is_open ? "OPEN" : "INVITE CLOSED"}
            </p>
            <h2>{c.name}</h2>
            <p>{c.description || "A little movement, in good company."}</p>
            <div className="actions">
              {c.my_role ? (
                <>
                  <span className="status-pill">{c.my_role}</span>
                  <button
                    className="secondary"
                    onClick={() => setSelected(selected === c.id ? "" : c.id)}
                  >
                    Members
                  </button>
                  {c.my_role !== "owner" && (
                    <button
                      className="secondary"
                      disabled={a.busy}
                      onClick={() => {
                        if (window.confirm("Leave " + c.name + "?"))
                          void a.run(async () => {
                            await rpc("pc_leave_club", { p_club_id: c.id });
                            q.reload();
                          });
                      }}
                    >
                      Leave
                    </button>
                  )}
                </>
              ) : (
                <button
                  disabled={a.busy || !c.is_open}
                  onClick={() =>
                    void a.run(async () => {
                      await rpc("pc_join_club", { p_club_id: c.id });
                      q.reload();
                    }, "Joined club. Members agree to respectful participation and fair recording.")
                  }
                >
                  Join club
                </button>
              )}
            </div>
            {c.my_role === "owner" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void a.run(async () => {
                    checked(
                      await db()
                        .from("clubs")
                        .update({
                          name: f.get("name"),
                          description: f.get("description"),
                          is_open: f.get("open") === "on",
                        })
                        .eq("id", c.id),
                    );
                    q.reload();
                  });
                }}
              >
                <details>
                  <summary>Manage club</summary>
                  <label>
                    Name
                    <input
                      name="name"
                      defaultValue={c.name}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      name="description"
                      defaultValue={c.description}
                      maxLength={2000}
                    />
                  </label>
                  <label className="check-row">
                    <input
                      name="open"
                      type="checkbox"
                      defaultChecked={c.is_open}
                    />
                    Open for joining
                  </label>
                  <button disabled={a.busy}>Save club</button>
                </details>
              </form>
            )}
            {selected === c.id && (
              <Members club={c} userId={userId} reload={q.reload} />
            )}
          </section>
        ))}
      </div>
      {q.data?.length === 0 && (
        <section className="card empty-note">
          Start the first club for your community.
        </section>
      )}
    </>
  );
}
function Members({
  club,
  userId,
  reload,
}: {
  club: Club;
  userId: string;
  reload: () => void;
}) {
  const a = useAction();
  const q = useData(
    "members-" + club.id,
    async () => {
      const members = checked(
        await db()
          .from("club_members")
          .select("user_id,role")
          .eq("club_id", club.id)
          .eq("status", "active"),
      ) as { user_id: string; role: string }[];
      const users = members.length
        ? (checked(
            await db()
              .from("profiles")
              .select("id,display_name")
              .in(
                "id",
                members.map((m) => m.user_id),
              ),
          ) as Profile[])
        : [];
      return members.map((m) => ({
        ...m,
        name: users.find((u) => u.id === m.user_id)?.display_name || "Athlete",
      }));
    },
    ["club_members"],
  );
  return (
    <>
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.map((m) => (
        <div className="list-row" key={m.user_id}>
          <div>
            <strong>{m.name}</strong>
            <p>{m.role}</p>
          </div>
          {club.my_role === "owner" && m.user_id !== userId && (
            <div className="actions">
              <button
                className="secondary"
                disabled={a.busy}
                onClick={() => {
                  if (
                    window.confirm("Transfer club ownership to " + m.name + "?")
                  )
                    void a.run(async () => {
                      await rpc("pc_transfer_club", {
                        p_id: club.id,
                        p_user: m.user_id,
                      });
                      q.reload();
                      reload();
                    });
                }}
              >
                Make owner
              </button>
              <button
                className="danger"
                disabled={a.busy}
                onClick={() => {
                  if (window.confirm("Remove " + m.name + " from the club?"))
                    void a.run(async () => {
                      await rpc("pc_remove_club_member", {
                        p_club_id: club.id,
                        p_user_id: m.user_id,
                      });
                      q.reload();
                      reload();
                    });
                }}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
