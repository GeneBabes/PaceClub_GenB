import { useState } from "react";
import { View } from "react-native";
import { checked, db, date, rpc, useAction, useData } from "./data";
import { useAccountData } from "./Context";
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
  styles,
} from "./ui";
import { RouteTrace } from "../components/ActivityUI";
import type { Point } from "../activity/model";
import type { RemoteActivity, Profile } from "./types";
type Appeal = {
  id: string;
  reason: string;
  status: string;
  review_note: string | null;
};
export function RemoteRoute({ activity }: { activity: RemoteActivity }) {
  const q = useData("route-" + activity.id, async () => {
    const meta = checked(
      await db
        .from("activities")
        .select("sensor_summary")
        .eq("id", activity.id)
        .single(),
    );
    const starts = new Set<number>(meta?.sensor_summary?.segment_starts || []);
    const rows: {
      sample_number: number;
      recorded_at: string;
      latitude: number;
      longitude: number;
      accuracy_m: number;
    }[] = [];
    for (let offset = 0; offset < 25000; offset += 1000) {
      const batch =
        checked(
          await db
            .from("activity_points")
            .select("*")
            .eq("activity_id", activity.id)
            .order("sample_number")
            .range(offset, offset + 999),
        ) || [];
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
    let segment = 0;
    const points: Point[] = rows.map((r, i) => {
      if (
        i &&
        (starts.has(r.sample_number) ||
          Date.parse(r.recorded_at) - Date.parse(rows[i - 1].recorded_at) >
            (activity.source === "gpx" ? 60000 : 20000))
      )
        segment++;
      return {
        sample: r.sample_number,
        segment,
        timestamp: Date.parse(r.recorded_at),
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy_m || 0,
      };
    });
    return { points, meta };
  });
  return (
    <>
      <Feedback state={q} />
      {q.data && (
        <>
          <RouteTrace points={q.data.points} />
          <P>
            Saved GPS samples: {q.data.points.length}. Gaps remain separate.
          </P>
          <P>
            Device signals:{" "}
            {JSON.stringify(
              q.data.meta?.sensor_summary?.motion || { status: "not recorded" },
            )}
          </P>
        </>
      )}
    </>
  );
}
export function RemoteReview({ activity: x }: { activity: RemoteActivity }) {
  const q = useData(
    "appeal-" + x.id,
    async () =>
      checked(
        await db
          .from("activity_appeals")
          .select("*")
          .eq("activity_id", x.id)
          .maybeSingle(),
      ) as Appeal | null,
    ["activity_appeals"],
  );
  const [reason, setReason] = useState(""),
    a = useAction();
  return (
    <>
      <RemoteRoute activity={x} />
      <P>{x.verification_note}</P>
      {["flagged", "rejected"].includes(x.status) && (
        <>
          <H>Activity appeal</H>
          {q.data ? (
            <>
              <P>
                {q.data.status}: {q.data.reason}
              </P>
              <P>{q.data.review_note}</P>
            </>
          ) : (
            <>
              <Field
                label="What happened?"
                value={reason}
                onChange={setReason}
                multiline
              />
              <Button
                disabled={a.busy || reason.trim().length < 3}
                onPress={() =>
                  void a.run(async () => {
                    await rpc("pc_submit_appeal", {
                      p_id: x.id,
                      p_reason: reason,
                    });
                    q.reload();
                  }, "Appeal submitted.")
                }
              >
                Submit appeal
              </Button>
            </>
          )}
        </>
      )}
      {x.status === "submitted" && (
        <Button
          disabled={a.busy}
          onPress={() =>
            void a.run(
              () => rpc("pc_verify_activity", { p_id: x.id }),
              "Verification checked. Refresh your history.",
            )
          }
        >
          Retry verification
        </Button>
      )}
      <Feedback state={q} />
      <Feedback state={a} />
    </>
  );
}
export function Moderation() {
  const account = useAccountData(),
    role = account.data!.role,
    [filter, setFilter] = useState("flagged"),
    [selected, setSelected] = useState(""),
    [note, setNote] = useState(""),
    a = useAction();
  const q = useData(
    "moderation-" + filter,
    async () => {
      if (!["admin", "moderator"].includes(role)) return null;
      return {
        activities: checked(
          await db
            .from("activities")
            .select("*")
            .eq("status", filter)
            .order("started_at", { ascending: false })
            .limit(100),
        ) as RemoteActivity[],
        profiles: checked(
          await db.from("profiles").select("id,display_name").limit(1000),
        ) as Profile[],
        appeals: checked(
          await db.from("activity_appeals").select("*").eq("status", "pending"),
        ) as (Appeal & { activity_id: string })[],
        reports: checked(
          await db
            .from("content_reports")
            .select("*")
            .eq("status", "pending")
            .limit(100),
        ) as Report[],
        messages: checked(
          await db
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
      <Frame title="Moderator access required.">
        <P>This screen and its actions are restricted by the database.</P>
      </Frame>
    );
  const activity = q.data?.activities.find((x) => x.id === selected);
  return (
    <Frame
      title="Review with context."
      subtitle="GPS and sensor signals are imperfect. Explain each decision and ask another moderator to review your own activities."
    >
      <Choices
        label="Activity status"
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setSelected("");
        }}
        options={["flagged", "submitted", "rejected", "verified"].map((id) => ({
          id,
          label: id,
        }))}
      />
      <Feedback state={q} />
      <Feedback state={a} />
      {q.data?.activities.map((x) => (
        <Card key={x.id}>
          <H>
            {q.data?.profiles.find((p) => p.id === x.user_id)?.display_name ||
              "Athlete"}{" "}
            · {x.activity_type}
          </H>
          <P>
            {date(x.started_at)} · {x.status}
          </P>
          <P>{x.verification_note}</P>
          {q.data?.appeals
            .filter((p) => p.activity_id === x.id)
            .map((p) => (
              <P key={p.id} note>
                Appeal: {p.reason}
              </P>
            ))}
          <Button
            secondary
            onPress={() => setSelected(selected === x.id ? "" : x.id)}
          >
            Review
          </Button>
        </Card>
      ))}
      {activity && (
        <Card>
          <RemoteRoute activity={activity} />
          {activity.user_id === account.data!.profile.id ? (
            <P>Another moderator must review your own activity.</P>
          ) : (
            <>
              <Field
                label="Decision explanation"
                value={note}
                onChange={setNote}
                multiline
              />
              {activity.status === "verified" ? (
                <Button
                  disabled={a.busy || note.trim().length < 3}
                  onPress={() =>
                    Confirm(
                      "Revoke verified activity?",
                      "Rewards, challenge credit, and territory will be reconciled.",
                      () =>
                        void a.run(async () => {
                          await rpc("pc_revoke_activity", {
                            p_id: activity.id,
                            p_note: note,
                          });
                          q.reload();
                          setSelected("");
                        }),
                    )
                  }
                >
                  Revoke activity
                </Button>
              ) : (
                <>
                  {[true, false].map((accept) => (
                    <Button
                      key={String(accept)}
                      secondary={!accept}
                      disabled={a.busy || note.trim().length < 3}
                      onPress={() =>
                        void a.run(async () => {
                          await rpc("pc_review_activity", {
                            p_id: activity.id,
                            p_accept: accept,
                            p_note: note,
                          });
                          q.reload();
                          setSelected("");
                        }, "Review saved and athlete notified.")
                      }
                    >
                      {accept
                        ? "Approve reliable measurements"
                        : "Reject activity"}
                    </Button>
                  ))}
                </>
              )}
            </>
          )}
        </Card>
      )}
      {(["reports", "messages"] as const).map((kind) => (
        <Card key={kind}>
          <H>{kind === "reports" ? "Feed reports" : "Message reports"}</H>
          {q.data?.[kind].map((r) => (
            <View key={r.id} style={styles.divider}>
              <P>
                {r.snapshot?.body ||
                  r.message_snapshot?.body ||
                  "Reported content"}
              </P>
              <P note>{r.reason}</P>
              {[true, false].map((remove) => (
                <Button
                  key={String(remove)}
                  secondary={!remove}
                  disabled={a.busy}
                  onPress={() =>
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
                    })
                  }
                >
                  {remove ? "Remove content" : "Dismiss report"}
                </Button>
              ))}
            </View>
          ))}
          {q.data?.[kind].length === 0 && <P>No pending reports.</P>}
        </Card>
      ))}
    </Frame>
  );
}
type Report = {
  id: string;
  reason: string;
  snapshot?: { body?: string };
  message_snapshot?: { body?: string };
};
