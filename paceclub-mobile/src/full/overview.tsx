import { RemoteReview } from "./moderation";
import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import Svg, { Path, Rect } from "react-native-svg";
import { checked, db, date, km, rpc, useAction, useData } from "./data";
import { useAccountData } from "./Context";
import {
  Button,
  Card,
  Choices,
  Feedback,
  Frame,
  H,
  LinkButton,
  P,
  ui,
} from "./ui";
import type { Dashboard, Item, Notice, RemoteActivity } from "./types";
import { enablePush, disablePush } from "./push";
export function Home() {
  const account = useAccountData(),
    q = useData("dashboard", () => rpc<Dashboard>("pc_dashboard"), [
      "activities",
      "reward_ledger",
    ]);
  return (
    <Frame
      title="A little movement. A little more you."
      subtitle={
        "Welcome back, " +
        (account.data?.profile.display_name.split(" ")[0] || "athlete") +
        "."
      }
    >
      <Button onPress={() => router.push("/record")}>
        Record a walk, run, or ride ↗
      </Button>
      <Feedback state={q} />
      {q.data && (
        <>
          <Card>
            <H>{km(q.data.totals.distance_m)} together with yourself.</H>
            <P>
              {q.data.totals.activities} verified activities ·{" "}
              {Math.round(q.data.totals.moving_seconds / 60)} active minutes
            </P>
            <P>
              Level {1 + Math.floor(Math.max(0, q.data.balances.xp) / 500)} ·{" "}
              {q.data.balances.xp} XP · {q.data.balances.coins} cosmetic tokens
            </P>
            <P note>
              {q.data.competitive_ready
                ? "Competitive play is unlocked."
                : "Ranked play unlocks after the tutorial and three verified GPS activities across two Philippine dates."}
            </P>
          </Card>
          <LinkButton section="play" label="Find your next goal" />
          <LinkButton section="community" label="See your community" />
        </>
      )}
      <Button secondary onPress={() => router.push("/activities")}>
        Saved on this phone & uploads
      </Button>
      {["admin", "moderator"].includes(account.data?.role || "") && (
        <LinkButton section="moderation" label="Moderation desk" />
      )}
      <P>
        Your GPS route stays private. Choose what to share after verification.
      </P>
    </Frame>
  );
}
function Chart({
  title,
  unit,
  points,
  line = false,
}: {
  title: string;
  unit: string;
  points: { label: string; value: number }[];
  line?: boolean;
}) {
  const values = points.filter((p) => Number.isFinite(p.value)),
    max = Math.max(1, ...values.map((p) => p.value)),
    gap = 280 / Math.max(1, values.length),
    x = (i: number) => 20 + (i + 0.5) * gap,
    y = (v: number) => 150 - (v / max) * 120;
  return (
    <Card>
      <H>{title}</H>
      {values.length ? (
        <>
          <View
            accessibilityRole="image"
            accessibilityLabel={title + ", values listed below."}
          >
            <Svg width="100%" height={170} viewBox="0 0 320 170">
              <Path d="M20 20 V150 H300" stroke="#b2c4b6" fill="none" />
              {line ? (
                <Path
                  d={values
                    .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`)
                    .join(" ")}
                  stroke="#245741"
                  strokeWidth={3}
                  fill="none"
                />
              ) : (
                values.map((p, i) => (
                  <Rect
                    key={i}
                    x={x(i) - gap * 0.32}
                    y={y(p.value)}
                    width={gap * 0.64}
                    height={150 - y(p.value)}
                    fill="#598361"
                    rx={3}
                  />
                ))
              )}
            </Svg>
          </View>
          {values.map((p, i) => (
            <P key={i}>
              {p.label}: {p.value.toFixed(2)} {unit}
            </P>
          ))}
        </>
      ) : (
        <P>Verified activities will build this chart.</P>
      )}
    </Card>
  );
}
export function Analytics() {
  const [type, setType] = useState("walk"),
    [distance, setDistance] = useState("1000"),
    [insight, setInsight] = useState("");
  const q = useData(
      "analytics-" + type,
      () => rpc<Dashboard>("pc_dashboard", { p_type: type }),
      ["activities"],
    ),
    a = useAction();
  return (
    <Frame title="Every little bit adds up.">
      <Choices
        label="Activity"
        value={type}
        onChange={setType}
        options={["walk", "run", "ride"].map((id) => ({ id, label: id }))}
      />
      <Choices
        label="Personal-best distance"
        value={distance}
        onChange={setDistance}
        options={[1000, 5000, 10000, 21097, 42195].map((d) => ({
          id: String(d),
          label: d / 1000 + " km",
        }))}
      />
      <Feedback state={q} />
      {q.data && (
        <>
          <P>
            {q.data.pending} pending or flagged. Imports contribute to personal
            totals; practice sessions do not.
          </P>
          <Chart
            title="Weekly distance"
            unit="km"
            points={q.data.weeks.map((w) => ({
              label: w.week_start,
              value: Number(w.distance_km),
            }))}
          />
          <Chart
            title="Pace trend"
            unit="min/km"
            line
            points={q.data.weeks
              .filter((w) => w.pace_min_per_km !== null)
              .map((w) => ({
                label: w.week_start,
                value: Number(w.pace_min_per_km),
              }))}
          />
          <Chart
            title="Active time"
            unit="minutes"
            points={q.data.weeks.map((w) => ({
              label: w.week_start,
              value: Number(w.active_minutes),
            }))}
          />
          <Chart
            title="Personal-best progress"
            unit="elapsed minutes"
            line
            points={q.data.bests
              .filter((b) => b.distance_m === Number(distance))
              .reverse()
              .map((b) => ({
                label: date(b.started_at),
                value: Number(b.best_seconds) / 60,
              }))}
          />
          <P>
            Weeks use Philippine time. Personal bests use GPS elapsed time to a
            fixed distance in the first uninterrupted segment.
          </P>
          <Button
            disabled={a.busy}
            onPress={() =>
              void a.run(async () => {
                const url = process.env.EXPO_PUBLIC_WEB_URL;
                if (!url) {
                  setInsight(
                    `You have ${q.data!.totals.activities} verified activities and ${km(q.data!.totals.distance_m)} recorded for ${type}. Keep choosing a pace that fits your day.`,
                  );
                  return;
                }
                const auth = await db.auth.getSession();
                if (auth.error) throw auth.error;
                const session = auth.data.session;
                if (!session) throw Error("Sign in again.");
                const res = await fetch(
                  url.replace(/\/$/, "") + "/api/insights",
                  {
                    method: "POST",
                    headers: {
                      Authorization: "Bearer " + session.access_token,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ type }),
                  },
                );
                const body = await res.json();
                if (!res.ok) throw Error(body.error || "Summary unavailable");
                setInsight(
                  body.text +
                    " " +
                    (body.mode === "ai"
                      ? "AI selected these checked highlights."
                      : "Calculated from your activity data."),
                );
              })
            }
          >
            Explain my progress
          </Button>
          <Feedback state={a} />
          {!!insight && <P note>{insight}</P>}
        </>
      )}
    </Frame>
  );
}
export function Rewards() {
  const account = useAccountData(),
    a = useAction(),
    q = useData(
      "rewards",
      async () => ({
        dashboard: await rpc<Dashboard>("pc_dashboard"),
        items: checked(
          await db.from("reward_items").select("*").order("price_coins"),
        ) as Item[],
        inventory: checked(
          await db.from("user_inventory").select("item_id,equipped"),
        ) as { item_id: string; equipped: boolean }[],
      }),
      ["reward_ledger", "user_inventory"],
    );
  return (
    <Frame
      title="Wear your progress."
      subtitle="Cosmetics never change scores, distance, or territory."
    >
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data && (
        <>
          <P note>
            {q.data.dashboard.balances.coins} cosmetic tokens ·{" "}
            {q.data.dashboard.balances.xp} XP. These tokens have no cash value.
          </P>
          {q.data.items.map((i) => {
            const owned = q.data!.inventory.find((x) => x.item_id === i.id);
            return (
              <Card key={i.id}>
                <H>{i.name}</H>
                <P>
                  {i.type.replace("_", " ")} · {i.price_coins} tokens
                </P>
                <Button
                  disabled={a.busy}
                  secondary={!!owned}
                  onPress={() =>
                    void a.run(async () => {
                      await rpc(
                        owned ? "pc_equip_item" : "pc_buy_item",
                        owned
                          ? { p_id: i.id, p_equipped: !owned.equipped }
                          : { p_id: i.id },
                      );
                      q.reload();
                      account.reload();
                    })
                  }
                >
                  {owned ? (owned.equipped ? "Unequip" : "Equip") : "Buy"}
                </Button>
              </Card>
            );
          })}
        </>
      )}
    </Frame>
  );
}
export function Notifications() {
  const account = useAccountData(),
    a = useAction(),
    [page, setPage] = useState(0);
  const q = useData(
    "inbox-" + page,
    async () =>
      checked(
        await db
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * 30, page * 30 + 29),
      ) as Notice[],
    ["notifications"],
  );
  return (
    <Frame title="Your updates.">
      <Card>
        <H>Phone notifications</H>
        <P>
          Opt in to updates on this device. Delivery needs your project’s
          configured push credentials and running notification worker.
        </P>
        <Button
          disabled={a.busy}
          onPress={() =>
            void a.run(
              () => enablePush(account.data!.profile.id),
              "Phone notifications enabled.",
            )
          }
        >
          Enable push
        </Button>
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(
              () => disablePush(account.data!.profile.id),
              "Push disabled for this device.",
            )
          }
        >
          Disable push
        </Button>
      </Card>
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.map((n) => (
        <Card key={n.id}>
          <H>{n.title}</H>
          <P>{n.body}</P>
          <P>
            {date(n.created_at)} · {n.read_at ? "Read" : "Unread"}
          </P>
          {!n.read_at && (
            <Button
              secondary
              disabled={a.busy}
              onPress={() =>
                void a.run(async () => {
                  checked(
                    await db
                      .from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .eq("id", n.id),
                  );
                  q.reload();
                })
              }
            >
              Mark read
            </Button>
          )}
        </Card>
      ))}
      {q.data?.length === 0 && <P>No notifications yet.</P>}
      <View style={ui.row}>
        <Button
          secondary
          disabled={!page}
          onPress={() => setPage((p) => p - 1)}
        >
          Newer
        </Button>
        <Button
          secondary
          disabled={!q.data || q.data.length < 30}
          onPress={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
      </View>
    </Frame>
  );
}
export function History() {
  const [page, setPage] = useState(0),
    [selected, setSelected] = useState("");
  const q = useData(
    "history-" + page,
    async () =>
      checked(
        await db
          .from("activities")
          .select("*")
          .eq("user_id", (await db.auth.getUser()).data.user!.id)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * 20, page * 20 + 19),
      ) as RemoteActivity[],
    ["activities"],
  );
  return (
    <Frame title="Your activity story.">
      <Button secondary onPress={() => router.push("/activities")}>
        Local recordings & pending uploads
      </Button>
      <Feedback state={q} />
      {q.data?.map((x) => (
        <Card key={x.id}>
          <H>
            {x.activity_type.toUpperCase()} ·{" "}
            {km(x.status === "verified" ? x.distance_m : x.reported_distance_m)}
          </H>
          <P>
            {date(x.started_at)} · {x.source.toUpperCase()} · {x.status}
          </P>
          <P>{x.verification_note}</P>
          <Button
            secondary
            onPress={() => setSelected(selected === x.id ? "" : x.id)}
          >
            Review & appeal
          </Button>
          {selected === x.id && <RemoteReview activity={x} />}
        </Card>
      ))}
      {q.data?.length === 0 && (
        <P>Your uploaded activities will appear here.</P>
      )}
      <View style={ui.row}>
        <Button
          secondary
          disabled={!page}
          onPress={() => setPage((p) => p - 1)}
        >
          Newer
        </Button>
        <Button
          secondary
          disabled={!q.data || q.data.length < 20}
          onPress={() => setPage((p) => p + 1)}
        >
          Older
        </Button>
      </View>
    </Frame>
  );
}
