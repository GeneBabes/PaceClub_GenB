import { useState } from "react";
import { View } from "react-native";
import { useAccountData } from "./Context";
import { checked, db, date, km, rpc, useAction, useData } from "./data";
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
  ui,
} from "./ui";
import type { Challenge, Club, Profile } from "./types";
export function Play() {
  const [now] = useState(() => Date.now());
  const account = useAccountData(),
    id = account.data!.profile.id,
    role = account.data!.role;
  const [create, setCreate] = useState(false),
    [selected, setSelected] = useState(""),
    a = useAction();
  const q = useData(
    "play",
    async () => ({
      challenges: checked(
        await db
          .from("challenges")
          .select("*")
          .order("starts_at", { ascending: false })
          .limit(100),
      ) as Challenge[],
      joined: checked(
        await db
          .from("challenge_participants")
          .select("challenge_id")
          .eq("user_id", id),
      ) as { challenge_id: string }[],
      clubs: await rpc<Club[]>("pc_club_directory"),
      ready: await rpc<boolean>("pc_competitive_ready"),
    }),
    ["challenges", "challenge_entries", "activities"],
  );
  return (
    <Frame title="A goal worth showing up for.">
      <Feedback state={q} />
      <Feedback state={a} />
      <P note>
        {q.data?.ready
          ? "Competition unlocked."
          : "Personal quests are ready. Competition needs the tutorial and three verified GPS activities across two Philippine dates."}{" "}
        Join before starting, then choose your challenge in the recorder. GPX
        and practice never count.
      </P>
      <Button secondary onPress={() => setCreate(!create)}>
        Create a quest or challenge
      </Button>
      {create && q.data && (
        <CreateChallenge role={role} clubs={q.data.clubs} reload={q.reload} />
      )}
      {q.data?.challenges.map((c) => (
        <Card key={c.id}>
          <P>
            {c.personal ? "PERSONAL QUEST" : c.mode.toUpperCase()} ·{" "}
            {c.activity_type} · {c.status}
          </P>
          <H>{c.title}</H>
          <P>
            {km(c.rules.goal_m)}{" "}
            {c.mode === "time_trial"
              ? "fixed elapsed effort"
              : c.mode === "club"
                ? "shared club goal"
                : "goal"}
            . Daily cap: {km(c.rules.daily_cap_m)} per athlete.
          </P>
          <P>
            {date(c.starts_at)} — {date(c.ends_at)}
          </P>
          <P>
            {c.mode === "time_trial"
              ? "Your fastest elapsed effort wins; pauses never improve elapsed time."
              : "Distance goals earn 50 tokens. Club goals reward each contributor once the shared goal is reached."}{" "}
            Ranked first place earns 100 tokens and 100 season rank points after
            48 hours of review; ties share the award.
          </P>
          {!q.data?.joined.some((j) => j.challenge_id === c.id) &&
            c.status === "open" && (
              <Button
                disabled={a.busy || (c.mode !== "casual" && !q.data?.ready)}
                onPress={() =>
                  void a.run(async () => {
                    await rpc("pc_join_challenge", { p_id: c.id });
                    q.reload();
                  })
                }
              >
                Join
              </Button>
            )}
          <Button
            secondary
            onPress={() => setSelected(selected === c.id ? "" : c.id)}
          >
            Progress & leaderboard
          </Button>
          {selected === c.id && <Leaderboard challenge={c} />}
          {(role !== "athlete" || c.created_by === id) &&
            !c.finalized_at &&
            Date.parse(c.ends_at) + 172800000 < now && (
              <Button
                disabled={a.busy}
                onPress={() =>
                  void a.run(async () => {
                    await rpc("pc_finalize_challenge", { p_id: c.id });
                    q.reload();
                  })
                }
              >
                Finalize results
              </Button>
            )}
        </Card>
      ))}
      {q.data?.challenges.length === 0 && (
        <P>No challenges yet. Create your first quest.</P>
      )}
    </Frame>
  );
}
function CreateChallenge({
  role,
  clubs,
  reload,
}: {
  role: string;
  clubs: Club[];
  reload: () => void;
}) {
  const [title, setTitle] = useState(""),
    [type, setType] = useState("walk"),
    [mode, setMode] = useState("casual"),
    [club, setClub] = useState(""),
    [goal, setGoal] = useState("5"),
    [cap, setCap] = useState("20"),
    [days, setDays] = useState("7");
  const a = useAction(),
    owners = clubs.filter((c) => c.my_role === "owner");
  return (
    <Card>
      <Field label="Title" value={title} onChange={setTitle} maxLength={120} />
      <Choices
        label="Activity"
        value={type}
        onChange={setType}
        options={["walk", "run", "ride"].map((id) => ({ id, label: id }))}
      />
      <Choices
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          "casual",
          ...(role !== "athlete" || owners.length
            ? ["weekly", "club", "time_trial"]
            : []),
        ].map((id) => ({ id, label: id.replace("_", " ") }))}
      />
      <Choices
        label="Club"
        value={club}
        onChange={setClub}
        options={[
          { id: "", label: role === "athlete" ? "Personal quest" : "Global" },
          ...owners.map((c) => ({ id: c.id, label: c.name })),
        ]}
      />
      {mode === "time_trial" ? (
        <Choices
          label="Distance"
          value={goal}
          onChange={setGoal}
          options={[1, 5, 10, 21.097, 42.195].map((d) => ({
            id: String(d),
            label: d + " km",
          }))}
        />
      ) : (
        <Field
          label="Goal (km)"
          value={goal}
          onChange={setGoal}
          keyboardType="decimal-pad"
        />
      )}
      <Field
        label="Daily cap (km)"
        value={cap}
        onChange={setCap}
        keyboardType="decimal-pad"
      />
      <Field
        label="Duration in days, starting now (1–90)"
        value={days}
        onChange={setDays}
        keyboardType="number-pad"
      />
      <P>
        Rules are fixed after creation. Join the new challenge before recording.
      </P>
      <Button
        disabled={a.busy}
        onPress={() =>
          void a.run(async () => {
            const n = Number(days);
            if (!Number.isInteger(n) || n < 1 || n > 90)
              throw Error("Choose 1 to 90 days.");
            await rpc("pc_create_challenge", {
              p_title: title,
              p_type: type,
              p_mode: mode,
              p_start: new Date().toISOString(),
              p_end: new Date(Date.now() + n * 86400000).toISOString(),
              p_goal: Math.round(Number(goal) * 1000),
              p_cap: Math.round(Number(cap) * 1000),
              p_club: club || null,
            });
            setTitle("");
            reload();
          }, "Created. Join the challenge to participate.")
        }
      >
        Create
      </Button>
      <Feedback state={a} />
    </Card>
  );
}
function Leaderboard({ challenge: c }: { challenge: Challenge }) {
  const q = useData(
    "board-" + c.id,
    async () => {
      const rows = checked(
        await db
          .from("pc_challenge_leaderboard")
          .select("*")
          .eq("challenge_id", c.id)
          .order("position")
          .limit(100),
      ) as { user_id: string; total_points: number; position: number }[];
      const profiles = rows.length
        ? (checked(
            await db
              .from("profiles")
              .select("id,display_name")
              .in(
                "id",
                rows.map((r) => r.user_id),
              ),
          ) as Profile[])
        : [];
      return rows.map((r) => ({
        ...r,
        name:
          profiles.find((p) => p.id === r.user_id)?.display_name || "Athlete",
      }));
    },
    ["challenge_entries"],
  );
  return (
    <View style={{ gap: 8 }}>
      <Feedback state={q} />
      {c.mode === "club" && (
        <P note>
          Shared progress:{" "}
          {km(q.data?.reduce((n, r) => n + Number(r.total_points), 0))} /{" "}
          {km(c.rules.goal_m)}
        </P>
      )}
      {q.data?.map((r) => (
        <P key={r.user_id}>
          {r.position}. {r.name} —{" "}
          {c.mode === "time_trial"
            ? (1000000 / Number(r.total_points) / 60).toFixed(2) + " min"
            : km(r.total_points)}
        </P>
      ))}
      {q.data?.length === 0 && <P>No eligible verified entries yet.</P>}
    </View>
  );
}
export function Clubs() {
  const id = useAccountData().data!.profile.id,
    a = useAction(),
    q = useData("clubs", () => rpc<Club[]>("pc_club_directory"), [
      "club_members",
    ]);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [selected, setSelected] = useState(""),
    [creating, setCreating] = useState(false);
  return (
    <Frame
      title="Find your people."
      subtitle="Mixed clans, shared goals, a little encouragement."
    >
      <Button secondary onPress={() => setCreating(!creating)}>
        Create a club
      </Button>
      {creating && (
        <Card>
          <Field
            label="Club name"
            value={name}
            onChange={setName}
            maxLength={80}
          />
          <Field
            label="Description"
            value={description}
            onChange={setDescription}
            multiline
          />
          <Button
            disabled={a.busy}
            onPress={() =>
              void a.run(async () => {
                await rpc("pc_create_club", {
                  p_name: name,
                  p_description: description,
                });
                setName("");
                setCreating(false);
                q.reload();
              })
            }
          >
            Create club
          </Button>
        </Card>
      )}
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.map((c) => (
        <Card key={c.id}>
          <H>{c.name}</H>
          <P>{c.description}</P>
          <P>
            {c.member_count} members ·{" "}
            {c.is_open ? "Open to join" : "Closed to new members"}{" "}
            {c.my_role ? "· " + c.my_role : ""}
          </P>
          {c.my_role ? (
            <>
              <Button
                secondary
                onPress={() => setSelected(selected === c.id ? "" : c.id)}
              >
                Members & club management
              </Button>
              {c.my_role !== "owner" && (
                <Button
                  secondary
                  disabled={a.busy}
                  onPress={() =>
                    Confirm(
                      "Leave club?",
                      "Credit earned during membership stays in your history.",
                      () =>
                        void a.run(async () => {
                          await rpc("pc_leave_club", { p_club_id: c.id });
                          q.reload();
                        }),
                    )
                  }
                >
                  Leave club
                </Button>
              )}
            </>
          ) : (
            <Button
              disabled={a.busy || !c.is_open}
              onPress={() =>
                void a.run(async () => {
                  await rpc("pc_join_club", { p_club_id: c.id });
                  q.reload();
                })
              }
            >
              Join club
            </Button>
          )}
          {selected === c.id && c.my_role && (
            <ClubMembers club={c} userId={id} reload={q.reload} />
          )}
        </Card>
      ))}
      {q.data?.length === 0 && <P>Start the first club in your community.</P>}
    </Frame>
  );
}
function ClubMembers({
  club: c,
  userId,
  reload,
}: {
  club: Club;
  userId: string;
  reload: () => void;
}) {
  const [name, setName] = useState(c.name),
    [about, setAbout] = useState(c.description),
    [open, setOpen] = useState(c.is_open);
  const a = useAction(),
    q = useData(
      "members-" + c.id,
      async () => {
        const members = checked(
          await db
            .from("club_members")
            .select("user_id,role")
            .eq("club_id", c.id)
            .eq("status", "active"),
        ) as { user_id: string; role: string }[];
        const profiles = members.length
          ? (checked(
              await db
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
          name:
            profiles.find((p) => p.id === m.user_id)?.display_name || "Athlete",
        }));
      },
      ["club_members"],
    );
  return (
    <>
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.map((m) => (
        <View key={m.user_id} style={{ gap: 8 }}>
          <P>
            {m.name} · {m.role}
          </P>
          {c.my_role === "owner" && m.user_id !== userId && (
            <View style={ui.row}>
              <Button
                secondary
                disabled={a.busy}
                onPress={() =>
                  Confirm(
                    "Transfer ownership?",
                    m.name + " will become the club owner.",
                    () =>
                      void a.run(async () => {
                        await rpc("pc_transfer_club", {
                          p_id: c.id,
                          p_user: m.user_id,
                        });
                        q.reload();
                        reload();
                      }),
                  )
                }
              >
                Make owner
              </Button>
              <Button
                secondary
                disabled={a.busy}
                onPress={() =>
                  Confirm(
                    "Remove member?",
                    m.name + " will lose access to this club.",
                    () =>
                      void a.run(async () => {
                        await rpc("pc_remove_club_member", {
                          p_club_id: c.id,
                          p_user_id: m.user_id,
                        });
                        q.reload();
                        reload();
                      }),
                  )
                }
              >
                Remove
              </Button>
            </View>
          )}
        </View>
      ))}
      {c.my_role === "owner" && (
        <>
          <H>Club settings</H>
          <Field label="Name" value={name} onChange={setName} maxLength={80} />
          <Field
            label="Description"
            value={about}
            onChange={setAbout}
            multiline
          />
          <Choices
            label="Joining"
            value={String(open)}
            onChange={(v) => setOpen(v === "true")}
            options={[
              { id: "true", label: "Open" },
              { id: "false", label: "Closed" },
            ]}
          />
          <Button
            disabled={a.busy}
            onPress={() =>
              void a.run(async () => {
                checked(
                  await db
                    .from("clubs")
                    .update({ name, description: about, is_open: open })
                    .eq("id", c.id)
                    .select("id")
                    .single(),
                );
                reload();
              })
            }
          >
            Save settings
          </Button>
        </>
      )}
    </>
  );
}
