export type ActivityType = "walk" | "run" | "ride";
export type Point = {
  sample: number;
  segment: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
};
export type Fix = Omit<Point, "sample" | "segment" | "accuracy"> & {
  accuracy: number | null;
  mocked?: boolean;
};
export type MotionSummary = {
  accelerometer: string;
  gyroscope: string;
  accelerationSamples: number;
  rotationSamples: number;
  peakG: number;
  peakRotation: number;
  alertAt: number;
};
export type SafetyEvent = {
  id: string;
  activityId: string;
  kind: "manual_sos" | "unusual_motion" | "sudden_stop";
  detectedAt: number;
  status: "prompted" | "confirmed_ok" | "no_response" | "call_requested";
  respondedAt: number | null;
  latitude: number | null;
  longitude: number | null;
};
export type RecordingOptions = {
  clubId?: string | null;
  challengeId?: string | null;
};
export type LocalActivity = {
  clubId?: string | null;
  challengeId?: string | null;
  motion?: MotionSummary;
  safetyEvents?: SafetyEvent[];
  version: 1;
  id: string;
  userId: string;
  type: ActivityType;
  phase: "recording" | "paused" | "finished";
  sync: "draft" | "queued" | "synced";
  startedAt: number;
  endedAt: number | null;
  updatedAt: number;
  activeMs: number;
  activeSince: number | null;
  distanceM: number;
  pointCount: number;
  rejected: number;
  segment: number;
  lastPoint: Point | null;
  lastSampleAt: number;
  pauseReason: string;
  syncError: string;
};
export const MAX_ACCURACY_M = 35;
export const MAX_GAP_MS = 20_000;
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
export function createActivity(
  id: string,
  userId: string,
  type: ActivityType,
  now: number,
): LocalActivity {
  return {
    version: 1,
    id,
    userId,
    type,
    phase: "recording",
    sync: "draft",
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    activeMs: 0,
    activeSince: now,
    distanceM: 0,
    pointCount: 0,
    rejected: 0,
    segment: 0,
    lastPoint: null,
    lastSampleAt: 0,
    pauseReason: "",
    syncError: "",
  };
}
export function activeMs(a: LocalActivity, now: number) {
  return (
    a.activeMs +
    (a.phase === "recording" && a.activeSince !== null
      ? Math.max(0, now - a.activeSince)
      : 0)
  );
}
export function pauseActivity(
  a: LocalActivity,
  now: number,
  reason: string,
): LocalActivity {
  if (a.phase !== "recording") return a;
  const at = Math.max(a.updatedAt, now);
  return {
    ...a,
    phase: "paused",
    activeMs: activeMs(a, at),
    activeSince: null,
    lastPoint: null,
    segment: a.segment + 1,
    updatedAt: at,
    pauseReason: reason,
  };
}
export function resumeActivity(a: LocalActivity, now: number): LocalActivity {
  if (a.phase !== "paused")
    throw new Error("Only a paused activity can resume.");
  if (now < a.updatedAt || now - a.startedAt >= MAX_SESSION_MS)
    throw new Error("Finish this activity and start a new one.");
  return {
    ...a,
    phase: "recording",
    activeSince: now,
    updatedAt: now,
    pauseReason: "",
    lastPoint: null,
  };
}
export function recoverActivity(a: LocalActivity): LocalActivity {
  // Never count time after the last durable checkpoint when the process was killed.
  return pauseActivity(
    recoverCheckIns(a),
    a.updatedAt,
    "Recording was interrupted. Your saved route is safe. Tap Resume when ready.",
  );
}
export function finishActivity(a: LocalActivity, now: number): LocalActivity {
  if (a.phase === "finished") return a;
  const paused = pauseActivity(a, now, "");
  return {
    ...paused,
    phase: "finished",
    endedAt: Math.max(now, paused.updatedAt),
    updatedAt: Math.max(now, paused.updatedAt),
  };
}
export function distanceBetween(
  a: Pick<Point, "latitude" | "longitude">,
  b: Pick<Point, "latitude" | "longitude">,
) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function addFix(
  a: LocalActivity,
  fix: Fix,
  now: number,
): { activity: LocalActivity; point?: Point; signal: string } {
  if (a.phase !== "recording") return { activity: a, signal: "Paused" };
  const valid =
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    fix.accuracy !== null &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    fix.accuracy <= MAX_ACCURACY_M &&
    Number.isFinite(fix.timestamp) &&
    fix.timestamp >= (a.activeSince ?? now) &&
    fix.timestamp > a.lastSampleAt &&
    fix.timestamp <= now + 2000 &&
    now - fix.timestamp <= 15_000 &&
    !fix.mocked;
  if (!valid)
    return {
      activity: { ...a, rejected: a.rejected + 1 },
      signal: "Waiting for an accurate GPS fix",
    };
  let segment = a.segment;
  let distance = 0;
  if (a.lastPoint) {
    const dt = fix.timestamp - a.lastPoint.timestamp;
    const gap = distanceBetween(a.lastPoint, fix);
    if (dt > MAX_GAP_MS) segment++;
    else if (gap / (dt / 1000) > { walk: 7, run: 12, ride: 40 }[a.type]) {
      return {
        activity: {
          ...a,
          rejected: a.rejected + 1,
          lastPoint: null,
          segment: segment + 1,
          lastSampleAt: fix.timestamp,
        },
        signal: "GPS jump ignored",
      };
    } else if (
      gap < Math.max(3, Math.min(a.lastPoint.accuracy, fix.accuracy!) / 2)
    ) {
      return { activity: a, signal: "GPS ready" };
    } else distance = gap;
  }
  const point: Point = {
    sample: a.pointCount,
    segment,
    timestamp: fix.timestamp,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy: fix.accuracy!,
  };
  return {
    activity: {
      ...a,
      distanceM: a.distanceM + distance,
      pointCount: a.pointCount + 1,
      segment,
      lastPoint: point,
      lastSampleAt: fix.timestamp,
      updatedAt: Math.max(a.updatedAt, now),
    },
    point,
    signal: "GPS ready",
  };
}
export function submissionProblem(a: LocalActivity) {
  if (a.phase !== "finished" || a.endedAt === null)
    return "Finish the activity before submitting.";
  if (a.pointCount < 2 || a.distanceM < 10 || a.activeMs < 10_000)
    return "Record at least 10 metres and 10 seconds with GPS before submitting.";
  return "";
}
export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export function pace(distanceM: number, seconds: number) {
  if (distanceM < 10 || seconds <= 0) return "—";
  const value = Math.round(seconds / (distanceM / 1000));
  return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, "0")}`;
}

// On recovery, an unanswered prompt is never treated as confirmation of safety.
export function recoverCheckIns(a: LocalActivity): LocalActivity {
  if (!a.safetyEvents?.some((e) => e.status === "prompted")) return a;
  return {
    ...a,
    sync: a.sync === "synced" ? "queued" : a.sync,
    safetyEvents: a.safetyEvents.map((e) =>
      e.status === "prompted"
        ? { ...e, status: "no_response", respondedAt: null }
        : e,
    ),
  };
}
