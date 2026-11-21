import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { useAccountData } from "./Context";
import { useRecorder } from "../providers/RecorderProvider";
import { checked, db, date, useAction, useData } from "./data";
import { Button, Card, Choices, Feedback, Field, Frame, H, P } from "./ui";
import type { SafetyEvent } from "../activity/model";
const key = (id: string) => "paceclub:safety-contact:" + id;
export function Safety() {
  const id = useAccountData().data!.profile.id,
    [phoneDraft, setPhone] = useState<string | null>(null),
    [enabledDraft, setEnabled] = useState<string | null>(null),
    [timeoutDraft, setTimeoutValue] = useState<string | null>(null),
    a = useAction();
  const q = useData("safety", async () => ({
    settings: checked(
      await db.from("safety_settings").select("*").eq("user_id", id).single(),
    ),
    events: checked(
      await db
        .from("safety_events")
        .select("*")
        .eq("user_id", id)
        .order("detected_at", { ascending: false })
        .limit(50),
    ),
    phone: (await AsyncStorage.getItem(key(id))) || "",
  }));
  const phone = phoneDraft ?? q.data?.phone ?? "",
    enabled = enabledDraft ?? String(q.data?.settings?.enabled || false),
    timeout =
      timeoutDraft ?? String(q.data?.settings?.prompt_timeout_seconds || 30);
  return (
    <Frame
      title="Check in with yourself."
      subtitle="Optional prompts while PaceClub is open. Motion signals can miss incidents or trigger by mistake. This is not an emergency monitoring service."
    >
      <Feedback state={q} />
      <Feedback state={a} />
      <Card>
        <Choices
          label="Motion check-in prompts"
          value={enabled}
          onChange={setEnabled}
          options={[
            { id: "true", label: "Enabled" },
            { id: "false", label: "Disabled" },
          ]}
        />
        <Field
          label="Response window (15–120 seconds)"
          value={timeout}
          onChange={setTimeoutValue}
          keyboardType="number-pad"
        />
        <Field
          label="Your chosen contact phone number"
          value={phone}
          onChange={setPhone}
          keyboardType="phone-pad"
          maxLength={25}
        />
        <P>
          The number stays on this device. No one is contacted automatically.
          You must tap to open the dialer and choose to call.
        </P>
        <Button
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              const seconds = Number(timeout);
              if (!Number.isInteger(seconds) || seconds < 15 || seconds > 120)
                throw Error("Choose 15 to 120 seconds.");
              const number = phone.replace(/[\s()-]/g, "");
              if (number && !/^\+?\d{3,15}$/.test(number))
                throw Error("Enter a valid phone number.");
              checked(
                await db
                  .from("safety_settings")
                  .update({
                    enabled: enabled === "true",
                    prompt_timeout_seconds: seconds,
                  })
                  .eq("user_id", id)
                  .select("user_id")
                  .single(),
              );
              await AsyncStorage.setItem(key(id), number);
              q.reload();
            })
          }
        >
          Save preferences
        </Button>
      </Card>
      <Card>
        <H>Private check-in history</H>
        {q.data?.events?.map((e) => (
          <P key={e.id}>
            {date(e.detected_at)} · {e.event_type.replace("_", " ")} ·{" "}
            {e.status.replace("_", " ")}
          </P>
        ))}
        <P>
          “No response” means no response was recorded. It does not mean the
          athlete is safe.
        </P>
      </Card>
    </Frame>
  );
}
export function SafetyPrompt() {
  const r = useRecorder(),
    activity = r.activity,
    id = activity?.userId || "",
    [event, setEvent] = useState<SafetyEvent | null>(null),
    [now, setNow] = useState(() => Date.now()),
    handled = useRef(0),
    a = useAction();
  const q = useData("safety-prompt-" + id, async () => ({
    settings: checked(
      await db.from("safety_settings").select("*").eq("user_id", id).single(),
    ),
    phone: (await AsyncStorage.getItem(key(id))) || "",
  }));
  const activeEvent = event?.activityId === activity?.id ? event : null;
  const update = async (next: SafetyEvent) => {
    await r.saveSafety(next);
    setEvent(next);
  };
  const begin = (kind: SafetyEvent["kind"]) => {
    if (!activity) return;
    const e: SafetyEvent = {
      id: randomUUID(),
      activityId: activity.id,
      kind,
      detectedAt: Date.now(),
      status: "prompted",
      respondedAt: null,
      latitude: activity.lastPoint?.latitude ?? null,
      longitude: activity.lastPoint?.longitude ?? null,
    };
    void a.run(() => update(e), "");
  };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const at = activity?.motion?.alertAt || 0;
    if (
      q.data?.settings?.enabled &&
      activity?.phase === "recording" &&
      at > handled.current &&
      at > Date.now() - 10000 &&
      activeEvent?.status !== "prompted"
    ) {
      handled.current = at;
      begin("unusual_motion");
    }
    // A fresh sensor alert creates one prompt; interval checkpoints don't recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.motion?.alertAt, q.data?.settings?.enabled, activity?.phase]);
  useEffect(() => {
    if (
      activeEvent?.status === "prompted" &&
      now - activeEvent.detectedAt >=
        (q.data?.settings?.prompt_timeout_seconds || 30) * 1000
    )
      void a.run(
        () =>
          update({ ...activeEvent, status: "no_response", respondedAt: null }),
        "No response recorded. No call was made.",
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, activeEvent?.status]);
  const saveSafety = r.saveSafety;
  const pending = useRef<SafetyEvent | null>(null);
  useEffect(() => {
    pending.current = activeEvent;
  }, [activeEvent]);
  useEffect(
    () => () => {
      if (pending.current?.status === "prompted")
        void saveSafety({
          ...pending.current,
          status: "no_response",
          respondedAt: null,
        }).catch(() => {});
    },
    [saveSafety],
  );
  if (!activity) return null;
  return (
    <Card>
      <H>Check-in & help options</H>
      {activeEvent?.status === "prompted" ? (
        <>
          <P note>
            Are you okay?{" "}
            {Math.max(
              0,
              Math.ceil(
                (activeEvent.detectedAt +
                  (q.data?.settings?.prompt_timeout_seconds || 30) * 1000 -
                  now) /
                  1000,
              ),
            )}{" "}
            seconds left.
          </P>
          <Button
            disabled={a.busy}
            onPress={() =>
              void a.run(
                () =>
                  update({
                    ...activeEvent,
                    status: "confirmed_ok",
                    respondedAt: Date.now(),
                  }),
                "Check-in saved.",
              )
            }
          >
            I’m okay
          </Button>
        </>
      ) : (
        <Button secondary disabled={a.busy} onPress={() => begin("manual_sos")}>
          Open a check-in
        </Button>
      )}
      {q.data?.phone && activeEvent && (
        <Button
          secondary
          disabled={a.busy}
          onPress={() =>
            void a.run(async () => {
              await update({
                ...activeEvent,
                status: "call_requested",
                respondedAt: Date.now(),
              });
              await Linking.openURL("tel:" + q.data!.phone);
            }, "Dialer requested. PaceClub cannot confirm a call was placed.")
          }
        >
          Open dialer for {q.data.phone}
        </Button>
      )}
      <P>No automatic calls. Add a contact in Check-ins before recording.</P>
      <Feedback state={a} />
    </Card>
  );
}
