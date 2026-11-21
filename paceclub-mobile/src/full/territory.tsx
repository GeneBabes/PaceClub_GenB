import { useState } from "react";
import Svg, { Path } from "react-native-svg";
import { useAccountData } from "./Context";
import { checked, db, date, rpc, useAction, useData } from "./data";
import {
  Button,
  Card,
  Choices,
  Confirm,
  Feedback,
  Field,
  Frame,
  H,
  P,
} from "./ui";
import type { Zone, Territory as Land, RemoteActivity } from "./types";
import { mapGeometry } from "./map-geometry";
type Claim = {
  id: string;
  activity_id: string;
  user_id: string;
  status: string;
  decision_note: string | null;
  zone_id: string;
  created_at: string;
};
export function Territory() {
  const account = useAccountData(),
    role = account.data!.role,
    userId = account.data!.profile.id,
    [zone, setZone] = useState(""),
    [activity, setActivity] = useState(""),
    [note, setNote] = useState(""),
    [season, setSeason] = useState("Season 2"),
    a = useAction();
  const q = useData(
    "territory-" + zone,
    async () => {
      const zones = checked(
        await db
          .from("play_zones")
          .select("*")
          .eq("is_active", true)
          .order("name"),
      ) as Zone[];
      const id = zone || zones[0]?.id;
      return {
        zones,
        id,
        ready: await rpc<boolean>("pc_competitive_ready"),
        land: id
          ? (checked(
              await db.from("territories").select("*").eq("zone_id", id),
            ) as Land[])
          : [],
        board: id
          ? await rpc<
              {
                owner_id: string;
                display_name: string;
                area_m2: number;
                position: number;
              }[]
            >("pc_territory_board", { p_zone: id })
          : [],
        claims: id
          ? (checked(
              await db
                .from("territory_claims")
                .select("*")
                .eq("zone_id", id)
                .order("created_at", { ascending: false })
                .limit(100),
            ) as Claim[])
          : [],
        activities: checked(
          await db
            .from("activities")
            .select("*")
            .eq("user_id", userId)
            .eq("status", "verified")
            .eq("source", "gps")
            .in("activity_type", ["walk", "run"])
            .order("started_at", { ascending: false })
            .limit(100),
        ) as RemoteActivity[],
      };
    },
    ["territories", "territory_claims"],
  );
  const active = q.data?.zones.find((z) => z.id === q.data?.id),
    paths = active
      ? mapGeometry(
          [
            active.boundary_geojson,
            ...q.data!.land.map((l) => l.boundary_geojson),
          ],
          320,
          270,
        )
      : [];
  return (
    <Frame
      title="Explore. Complete a loop."
      subtitle="Claim only inside approved play zones. These are game boundaries, not permission to enter property."
    >
      <Feedback state={q} />
      <Feedback state={a} />
      <Choices
        label="Approved zone"
        value={q.data?.id || ""}
        onChange={setZone}
        options={(q.data?.zones || []).map((z) => ({
          id: z.id,
          label: z.name + " · " + z.season_key,
        }))}
      />
      {active && (
        <Card>
          <H>{active.name}</H>
          <Svg
            width="100%"
            height={270}
            viewBox="0 0 320 270"
            accessibilityLabel="Current territory polygons inside the approved zone"
          >
            <Path
              d={paths[0]}
              fill="#e9eee2"
              stroke="#697e6c"
              strokeWidth={2}
            />
            {q.data?.land.map((l, i) => (
              <Path
                key={l.id}
                d={paths[i + 1]}
                fill={l.owner_id === userId ? "#245741" : "#d8aa72"}
                fillRule="evenodd"
                fillOpacity={0.6}
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </Svg>
          <P>
            Green: yours. Amber: other members. This shows claimed land, never
            live athlete positions.
          </P>
          {q.data?.board.map((b) => (
            <P key={b.owner_id}>
              {b.position}. {b.display_name} · {Number(b.area_m2).toFixed(0)} m²
            </P>
          ))}
        </Card>
      )}
      <Card>
        <H>Submit a closed loop</H>
        <P>
          A verified GPS walk or run, one uninterrupted segment, accuracy within
          15 metres, gaps no longer than 20 seconds, endpoints within 15 metres,
          at least 100 m², and fully inside the approved zone. Intersecting
          loops, rides, imports and simulations do not count.
        </P>
        <P>
          Later accepted claims take only the overlapping area. Results can
          change after moderator review.
        </P>
        {!q.data?.ready && (
          <P note>
            Complete the tutorial and three verified GPS activities across two
            dates to unlock territory.
          </P>
        )}
        <Choices
          label="Activity"
          value={activity}
          onChange={setActivity}
          options={(q.data?.activities || []).map((x) => ({
            id: x.id,
            label: x.activity_type + " · " + date(x.started_at),
          }))}
        />
        <Button
          disabled={a.busy || !activity || !active || !q.data?.ready}
          onPress={() =>
            void a.run(async () => {
              await rpc("pc_claim_territory", {
                p_activity: activity,
                p_zone: q.data!.id,
              });
              q.reload();
            }, "Claim checked. Read its decision below.")
          }
        >
          Check this loop
        </Button>
      </Card>
      {q.data?.claims.map((c) => (
        <Card key={c.id}>
          <H>{c.status}</H>
          <P>
            {date(c.created_at)} ·{" "}
            {c.user_id === userId ? "Your claim" : "Member claim"}
          </P>
          <P>{c.decision_note}</P>
          {role !== "athlete" &&
            c.status === "accepted" &&
            c.user_id !== userId && (
              <>
                <Field
                  label="Review explanation"
                  value={note}
                  onChange={setNote}
                  multiline
                />
                <Button
                  secondary
                  disabled={a.busy || note.trim().length < 3}
                  onPress={() =>
                    Confirm(
                      "Reverse claim?",
                      "The previous ownership will be restored where appropriate.",
                      () =>
                        void a.run(async () => {
                          await rpc("pc_reverse_claim", {
                            p_id: c.id,
                            p_note: note,
                          });
                          q.reload();
                        }),
                    )
                  }
                >
                  Reverse claim
                </Button>
              </>
            )}
        </Card>
      ))}
      {role === "admin" && (
        <>
          <CreateZone reload={q.reload} />
          {active && (
            <Card>
              <H>Start the next season</H>
              <Field
                label="Season name"
                value={season}
                onChange={setSeason}
                maxLength={40}
              />
              <Button
                disabled={a.busy}
                onPress={() =>
                  Confirm(
                    "Start a fresh season?",
                    "Current claims remain in the historical season. The same zone will open with no owners.",
                    () =>
                      void a.run(async () => {
                        setZone(
                          await rpc<string>("pc_new_zone_season", {
                            p_id: active.id,
                            p_season: season,
                          }),
                        );
                        q.reload();
                      }),
                  )
                }
              >
                Start next season
              </Button>
            </Card>
          )}
        </>
      )}
    </Frame>
  );
}
function CreateZone({ reload }: { reload: () => void }) {
  const [name, setName] = useState(""),
    [north, setNorth] = useState(""),
    [south, setSouth] = useState(""),
    [east, setEast] = useState(""),
    [west, setWest] = useState(""),
    [season, setSeason] = useState("Season 1"),
    a = useAction();
  return (
    <Card>
      <H>Approve a rectangular play zone</H>
      <P>
        Administrator: check public access, safe boundaries, and local
        permission before publishing. Area must be 100 m² to 10 km².
      </P>
      <Field
        label="Zone name"
        value={name}
        onChange={setName}
        maxLength={100}
      />
      <Field
        label="Season"
        value={season}
        onChange={setSeason}
        maxLength={40}
      />
      {[
        ["North latitude", north, setNorth],
        ["South latitude", south, setSouth],
        ["East longitude", east, setEast],
        ["West longitude", west, setWest],
      ].map(([label, value, set]) => (
        <Field
          key={label as string}
          label={label as string}
          value={value as string}
          onChange={set as (s: string) => void}
          keyboardType="numbers-and-punctuation"
        />
      ))}
      <Button
        disabled={a.busy}
        onPress={() =>
          void a.run(async () => {
            const n = Number(north),
              s = Number(south),
              e = Number(east),
              w = Number(west);
            if (
              ![north, south, east, west].every((x) => x.trim()) ||
              ![n, s, e, w].every(Number.isFinite) ||
              n <= s ||
              e <= w
            )
              throw Error(
                "Enter valid north, south, east and west boundaries.",
              );
            await rpc("pc_create_zone", {
              p_name: name,
              p_season: season,
              p_boundary: {
                type: "Polygon",
                coordinates: [
                  [
                    [w, s],
                    [e, s],
                    [e, n],
                    [w, n],
                    [w, s],
                  ],
                ],
              },
            });
            reload();
          }, "Approved zone published.")
        }
      >
        Approve zone
      </Button>
      <Feedback state={a} />
    </Card>
  );
}
