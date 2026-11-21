import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";
import { duration, submissionProblem, type Point } from "../../activity/model";
import { localStore } from "../../activity/store";
import { useAuth } from "../../providers/AuthProvider";
import { useRecorder } from "../../providers/RecorderProvider";
import {
  AccountRequired,
  activityLabel,
  Button,
  Metrics,
  RouteTrace,
  Screen,
  ui,
} from "../../components/ActivityUI";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const r = useRecorder();
  const owner = session?.user.id;
  const a = r.activities.find((a) => a.id === id);
  const [route, setRoute] = useState<{
    owner: string;
    id: string;
    points: Point[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (owner && id)
      void localStore
        .points(owner, id)
        .then((points) => {
          if (live) setRoute({ owner, id, points });
        })
        .catch(() => {
          if (live)
            setError(
              "The saved route could not load. Reopen this screen to retry.",
            );
        });
    return () => {
      live = false;
    };
  }, [id, owner]);
  if (!session) return <AccountRequired />;
  if (!r.ready)
    return (
      <Screen>
        <Text style={ui.text}>Loading saved activity…</Text>
        {r.fatal && <Button onPress={r.reload}>Reload</Button>}
      </Screen>
    );
  if (!a)
    return (
      <Screen>
        <Text style={ui.heading}>Activity not found on this phone.</Text>
        <Link href="/activities" style={ui.link}>
          Back to saved activities
        </Link>
      </Screen>
    );
  if (a.phase !== "finished")
    return (
      <Screen>
        <Text style={ui.heading}>This activity is still in progress.</Text>
        <Link href="/record" style={ui.link}>
          Return to recorder
        </Link>
      </Screen>
    );
  const points =
    route && route.owner === owner && route.id === id ? route.points : null;
  const problem = submissionProblem(a);
  return (
    <Screen>
      <Text style={ui.eyebrow}>YOUR ACTIVITY</Text>
      <Text style={ui.title}>A little more progress.</Text>
      <Text style={ui.text}>
        {a.type[0].toUpperCase() + a.type.slice(1)} ·{" "}
        {new Date(a.startedAt).toLocaleString()}
      </Text>
      <View style={ui.card}>
        <Text style={ui.badge}>{activityLabel(a)}</Text>
        <Metrics activity={a} seconds={a.activeMs / 1000} />
        {points ? (
          <RouteTrace points={points} />
        ) : (
          <Text style={ui.text}>Loading route…</Text>
        )}
        <Text style={ui.text}>
          Elapsed time: {duration((a.endedAt! - a.startedAt) / 1000)} ·{" "}
          {a.pointCount} GPS samples
        </Text>
        <Text style={ui.text}>
          Phone estimates. Active time excludes manual and automatic pauses; it
          is not a verified moving-time measurement.
        </Text>
      </View>
      {!!error && <Text style={[ui.note, ui.error]}>{error}</Text>}
      {!!r.message && <Text style={[ui.note, ui.error]}>{r.message}</Text>}
      {a.sync === "synced" ? (
        <Text style={ui.note}>
          Submitted to PaceClub. Open online history below for the verified
          measurements, explanation and appeal. This screen keeps your local
          copy.
        </Text>
      ) : a.sync === "queued" ? (
        <>
          <Text accessibilityLiveRegion="polite" style={ui.note}>
            {r.syncing
              ? "Uploading your saved activity…"
              : "Saved on this phone. Upload will retry when PaceClub is open and a connection is available."}
          </Text>
          {!!a.syncError && (
            <Text style={[ui.note, ui.error]}>
              Last upload attempt: {a.syncError}
            </Text>
          )}
          <Button disabled={r.syncing} onPress={() => void r.retry()}>
            {r.syncing ? "Uploading…" : "Retry upload"}
          </Button>
        </>
      ) : (
        <>
          <Text style={ui.note}>
            Submit sends this route and its GPS coordinates to your PaceClub
            account for verification. It stays on your phone if the connection
            fails. The server recalculates measurements before awarding eligible
            credit.
          </Text>
          {!!problem && <Text style={[ui.note, ui.error]}>{problem}</Text>}
          <Button
            disabled={r.busy || !!problem || !points || !!error}
            onPress={() => void r.submit(a.id)}
          >
            Submit activity
          </Button>
          <Button
            secondary
            disabled={r.busy}
            onPress={() =>
              Alert.alert(
                "Discard this saved activity?",
                "This cannot be undone. No activity has been submitted.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () =>
                      void r
                        .discard(a.id)
                        .then(() => router.replace("/activities")),
                  },
                ],
              )
            }
          >
            Discard from phone
          </Button>
        </>
      )}
      <Link href="/hub/history" style={ui.link}>
        Online history & verification
      </Link>
      <Link href="/activities" style={ui.link}>
        Back to saved activities
      </Link>
      <Link href="/record" style={ui.link}>
        Record another activity
      </Link>
    </Screen>
  );
}
