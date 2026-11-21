import { SafetyPrompt } from "../full/safety";
import { Choices } from "../full/ui";
import { useData, checked, db, rpc } from "../full/data";
import type { Club, Challenge } from "../full/types";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { Link, router } from "expo-router";
import { activeMs, type ActivityType } from "../activity/model";
import { useAuth } from "../providers/AuthProvider";
import { useRecorder } from "../providers/RecorderProvider";
import {
  AccountRequired,
  Button,
  Metrics,
  RouteTrace,
  Screen,
  ui,
} from "../components/ActivityUI";

export default function RecordScreen() {
  const { session, ready: authReady } = useAuth();
  const recorder = useRecorder();
  const [club, setClub] = useState(""),
    [challenge, setChallenge] = useState("");
  const choices = useData("record-options", async () => ({
    clubs: (await rpc<Club[]>("pc_club_directory")).filter((c) => c.my_role),
    challenges: checked(
      await db
        .from("challenges")
        .select("*")
        .eq("status", "open")
        .gt("ends_at", new Date().toISOString()),
    ) as Challenge[],
    joined: checked(
      await db
        .from("challenge_participants")
        .select("challenge_id")
        .eq("user_id", session!.user.id),
    ) as { challenge_id: string }[],
  }));
  const [type, setType] = useState<ActivityType>("walk");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!authReady)
    return (
      <Screen>
        <Text style={ui.text}>Loading your account…</Text>
      </Screen>
    );
  if (!session) return <AccountRequired />;
  const a = recorder.activity;
  const disabled = recorder.busy || !recorder.ready || recorder.fatal;
  const finish = () =>
    Alert.alert(
      "Finish this activity?",
      "Your route will be saved on this phone for review.",
      [
        { text: "Keep recording", style: "cancel" },
        {
          text: "Finish",
          onPress: () =>
            void recorder.finish().then((id) => {
              if (id)
                router.push({ pathname: "/activity/[id]", params: { id } });
            }),
        },
      ],
    );
  return (
    <Screen>
      <Text style={ui.eyebrow}>ONE STEP AT A TIME</Text>
      <Text style={ui.title}>
        {a ? `Your ${a.type}. Your pace.` : "Let’s get moving."}
      </Text>
      <Text style={ui.text}>
        Keep PaceClub open while recording. Your screen stays awake; switching
        apps or locking the phone pauses the activity.
      </Text>
      {!recorder.ready && !recorder.fatal && (
        <Text style={ui.text}>Loading saved activities…</Text>
      )}
      {!!recorder.message && (
        <Text accessibilityLiveRegion="polite" style={[ui.note, ui.error]}>
          {recorder.message}
        </Text>
      )}
      {recorder.fatal && (
        <Button secondary onPress={recorder.reload}>
          Reload saved activity
        </Button>
      )}
      {!a ? (
        <View style={ui.card}>
          <Text style={ui.heading}>Choose your activity</Text>
          <View style={ui.row}>
            {(["walk", "run", "ride"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: type === value, disabled }}
                disabled={disabled}
                onPress={() => {
                  setType(value);
                  setChallenge("");
                }}
                style={[
                  ui.button,
                  { flex: 1, paddingHorizontal: 10 },
                  type !== value && ui.secondary,
                ]}
              >
                <Text
                  style={[ui.buttonText, type !== value && ui.secondaryText]}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Choices
            label="Credit a club (optional)"
            value={club}
            onChange={(v) => {
              setClub(v);
              setChallenge("");
            }}
            options={[
              { id: "", label: "Personal" },
              ...(choices.data?.clubs || []).map((c) => ({
                id: c.id,
                label: c.name,
              })),
            ]}
          />
          <Choices
            label="Joined challenge (optional)"
            value={challenge}
            onChange={setChallenge}
            options={[
              { id: "", label: "No challenge" },
              ...(choices.data?.challenges || [])
                .filter(
                  (c) =>
                    c.activity_type === type &&
                    (!c.club_id || c.club_id === club) &&
                    choices.data?.joined.some((j) => j.challenge_id === c.id),
                )
                .map((c) => ({ id: c.id, label: c.title })),
            ]}
          />
          {!!choices.error && (
            <Text style={ui.note}>
              {choices.error} You can still record a personal activity offline.
            </Text>
          )}
          <Text style={ui.text}>
            Step outside for a clear GPS signal. Location is used only while you
            record.
          </Text>
          <Button
            disabled={disabled}
            onPress={() =>
              void recorder.start(type, {
                clubId: club || null,
                challengeId: challenge || null,
              })
            }
          >
            {recorder.busy ? "Starting…" : `Start ${type}`}
          </Button>
        </View>
      ) : (
        <View style={ui.card}>
          <Text style={ui.badge}>
            {a.phase === "recording" ? "● Recording" : "Paused"}
          </Text>
          <Metrics activity={a} seconds={activeMs(a, now) / 1000} />
          <Text style={ui.text}>
            {a.phase === "paused"
              ? a.pauseReason
              : now - a.lastSampleAt > 20_000
                ? "Waiting for GPS · move into an open area"
                : recorder.signal}
          </Text>
          <RouteTrace points={recorder.points} />
          <Text style={ui.text}>
            Active time excludes your pauses. Distance and pace are estimates
            from your phone.
          </Text>
          {a.phase === "recording" ? (
            <Button
              disabled={disabled}
              secondary
              onPress={() => void recorder.pause()}
            >
              Pause
            </Button>
          ) : (
            <Button disabled={disabled} onPress={() => void recorder.resume()}>
              Resume
            </Button>
          )}
          <Button disabled={disabled} secondary onPress={finish}>
            Finish & review
          </Button>
          <Button
            disabled={disabled}
            secondary
            onPress={() =>
              Alert.alert(
                "Discard this activity?",
                "This removes the unsent activity and its route from this phone.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => void recorder.discard(a.id),
                  },
                ],
              )
            }
          >
            Discard activity
          </Button>
        </View>
      )}
      {a && <SafetyPrompt />}
      <Link href="/activities" style={ui.link}>
        Saved activities & uploads
      </Link>
      <Pressable
        accessibilityRole="button"
        onPress={() => void Linking.openSettings()}
      >
        <Text style={ui.link}>Open phone settings</Text>
      </Pressable>
      <Text style={ui.note}>
        The route preview shows your recorded path without a street map. Pauses
        and GPS gaps stay separate.
      </Text>
    </Screen>
  );
}
