"use client";
import { useState } from "react";
import type { RemoteActivity, Territory, Zone } from "@/lib/full-types";
import { mapGeometry } from "@/lib/map-geometry";
import { checked, db, date, Feedback, rpc, useAction, useData } from "./data";
import { PageTitle } from "./overview";
type Claim = {
  id: string;
  user_id: string;
  activity_id: string;
  status: string;
  area_m2: number | null;
  decision_note: string | null;
  created_at: string;
};
export function Territories({
  userId,
  role,
}: {
  userId: string;
  role: string;
}) {
  const a = useAction();
  const q = useData(
    "zones",
    async () => ({
      zones: checked(
        await db()
          .from("play_zones")
          .select("*")
          .eq("is_active", true)
          .order("name"),
      ) as Zone[],
      activities: checked(
        await db()
          .from("activities")
          .select("id,activity_type,started_at")
          .eq("user_id", userId)
          .eq("status", "verified")
          .eq("source", "gps")
          .in("activity_type", ["walk", "run"])
          .order("started_at", { ascending: false })
          .limit(100),
      ) as RemoteActivity[],
      ready: await rpc<boolean>("pc_competitive_ready"),
    }),
    ["activities", "territories"],
  );
  const [selected, setSelected] = useState("");
  const zone = q.data?.zones.find((z) => z.id === selected) || q.data?.zones[0];
  const details = useData(
    "territory-" + (zone?.id || ""),
    async () =>
      zone
        ? {
            territories: checked(
              await db().from("territories").select("*").eq("zone_id", zone.id),
            ) as Territory[],
            board: await rpc<
              {
                owner_id: string;
                display_name: string;
                area_m2: number;
                position: number;
              }[]
            >("pc_territory_board", { p_zone: zone.id }),
            claims: checked(
              await db()
                .from("territory_claims")
                .select("*")
                .eq("zone_id", zone.id)
                .order("created_at", { ascending: false })
                .limit(50),
            ) as Claim[],
          }
        : { territories: [], board: [], claims: [] },
    ["territories"],
  );
  const paths = zone
    ? mapGeometry([
        zone.boundary_geojson,
        ...(details.data?.territories.map((t) => t.boundary_geojson) || []),
      ])
    : [];
  return (
    <>
      <PageTitle
        eyebrow="EXPLORE A LITTLE FURTHER"
        title="Make a loop. Make your mark."
        text="Walk or run a continuous loop inside an approved zone. Ownership changes only after server validation."
      />
      <p className="soft-note">
        One simple loop, accurate GPS, no paused or missing segments. Finish
        within 15 metres of the start and enclose at least 100 m². Later
        accepted claims take only their overlap. Current owned area determines
        the leaderboard. These maps are for gameplay, not navigation.
      </p>
      <Feedback state={q} />
      <Feedback state={details} />
      <Feedback state={a} />
      {role === "admin" && (
        <details className="card">
          <summary>Approve a new play zone</summary>
          <ZoneForm reload={q.reload} />
        </details>
      )}
      {!q.data?.zones.length && !q.busy ? (
        <section className="card empty-note">
          No approved play zones yet. An administrator must add a campus or park
          boundary before territory play.
        </section>
      ) : (
        zone && (
          <>
            <div className="toolbar">
              <label>
                Play zone
                <select
                  value={zone.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {q.data?.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name} · {z.season_key}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <section className="card">
              <div className="section-heading">
                <h2>{zone.name}</h2>
                <span className="tag">{zone.season_key}</span>
              </div>
              <svg
                className="territory-map"
                viewBox="0 0 700 380"
                role="img"
                aria-label="Approved zone and current captured areas, north up"
              >
                {paths.map((path, i) => (
                  <path
                    key={i}
                    d={path}
                    fill={
                      i === 0
                        ? "#e7eddf"
                        : details.data?.territories[i - 1].owner_id === userId
                          ? "#487853"
                          : "#c68c5e"
                    }
                    fillOpacity={i === 0 ? 1 : 0.7}
                    stroke={i === 0 ? "#415c40" : "white"}
                    strokeWidth={i === 0 ? 2 : 1}
                    fillRule="evenodd"
                  >
                    <title>
                      {i === 0
                        ? "Approved boundary"
                        : details.data?.board.find(
                            (b) =>
                              b.owner_id ===
                              details.data?.territories[i - 1].owner_id,
                          )?.display_name || "Captured area"}
                    </title>
                  </path>
                ))}
              </svg>
              <p className="muted">
                Green: your area. Amber: other members. Unfilled land is
                unclaimed. North is up; raw activities stay private.
              </p>
            </section>
            <div className="pc-grid">
              <section className="card">
                <h2>Submit a loop</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void a.run(async () => {
                      await rpc("pc_claim_territory", {
                        p_activity: f.get("activity"),
                        p_zone: zone.id,
                      });
                      details.reload();
                    }, "Loop evaluated. Read its decision below.");
                  }}
                >
                  <label>
                    Verified walk/run
                    <select name="activity" required>
                      <option value="">Choose your loop</option>
                      {q.data?.activities.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.activity_type} · {date(x.started_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={a.busy || !q.data?.ready}>
                    Check and claim
                  </button>
                  {!q.data?.ready && (
                    <p className="muted">
                      Finish the tutorial and three verified GPS activities
                      across two days first.
                    </p>
                  )}
                </form>
              </section>
              <section className="card">
                <h2>Current owned area</h2>
                {!details.data?.board.length ? (
                  <p className="muted">
                    The first accepted loop will appear here.
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Member</th>
                        <th>m²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.data.board.map((b) => (
                        <tr key={b.owner_id}>
                          <td>{b.position}</td>
                          <td>{b.display_name}</td>
                          <td>{Number(b.area_m2).toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
            <section className="card">
              <h2>{role === "athlete" ? "Your claims" : "Claim review"}</h2>
              {details.data?.claims.map((c) => (
                <div className="list-row" key={c.id}>
                  <div>
                    <strong>
                      {c.status}{" "}
                      {c.area_m2
                        ? "· " + Number(c.area_m2).toFixed(0) + " m²"
                        : ""}
                    </strong>
                    <p>{c.decision_note}</p>
                    <small>{date(c.created_at)}</small>
                    {role !== "athlete" &&
                      c.status === "accepted" &&
                      c.user_id !== userId && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            if (
                              window.confirm(
                                "Reverse this claim and recalculate ownership?",
                              )
                            )
                              void a.run(async () => {
                                await rpc("pc_reverse_claim", {
                                  p_id: c.id,
                                  p_note: f.get("note"),
                                });
                                details.reload();
                              }, "Claim reversed; ownership replayed.");
                          }}
                        >
                          <label>
                            Review explanation
                            <input
                              name="note"
                              minLength={3}
                              maxLength={2000}
                              required
                            />
                          </label>
                          <button className="danger" disabled={a.busy}>
                            Reverse claim
                          </button>
                        </form>
                      )}
                  </div>
                  <a href={`/activities/${c.activity_id}`}>Activity</a>
                </div>
              ))}
            </section>
            {role === "admin" && (
              <details className="card">
                <summary>Start a new season</summary>
                <p>
                  Archives this zone’s leaderboard and creates a new empty
                  season with the same approved boundary.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    if (
                      window.confirm(
                        "Archive the current zone season and start a new one?",
                      )
                    )
                      void a.run(async () => {
                        const id = await rpc<string>("pc_new_zone_season", {
                          p_id: zone.id,
                          p_season: f.get("season"),
                        });
                        setSelected(id);
                        q.reload();
                      }, "New season created.");
                  }}
                >
                  <label>
                    Season name
                    <input name="season" required maxLength={40} />
                  </label>
                  <button disabled={a.busy}>Start season</button>
                </form>
              </details>
            )}
          </>
        )
      )}
    </>
  );
}
function ZoneForm({ reload }: { reload: () => void }) {
  const a = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const w = Number(f.get("west")),
          east = Number(f.get("east")),
          s = Number(f.get("south")),
          n = Number(f.get("north"));
        void a.run(async () => {
          if (w >= east || s >= n)
            throw Error("West must be west of East, and South below North.");
          await rpc("pc_create_zone", {
            p_name: f.get("name"),
            p_season: f.get("season"),
            p_boundary: {
              type: "Polygon",
              coordinates: [
                [
                  [w, s],
                  [east, s],
                  [east, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
          });
          reload();
        }, "Approved play zone created.");
      }}
    >
      <p>
        Add a rectangle inside an approved campus or park. Check the actual
        boundary before publishing; do not include homes or restricted land. Use
        longitude for west/east and latitude for south/north.
      </p>
      <label>
        Zone name
        <input name="name" required minLength={3} maxLength={100} />
      </label>
      <label>
        Season
        <input name="season" defaultValue="Season 1" maxLength={40} required />
      </label>
      <div className="pc-grid">
        {["west", "east", "south", "north"].map((side) => (
          <label key={side}>
            {side}
            <input type="number" step="any" name={side} required />
          </label>
        ))}
      </div>
      <button disabled={a.busy}>Approve zone</button>
      <Feedback state={a} />
    </form>
  );
}
