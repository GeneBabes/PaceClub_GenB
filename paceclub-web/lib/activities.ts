export type Activity = {
  id: string;
  user_id: string;
  activity_type: "walk" | "run" | "ride";
  source: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  reported_distance_m: number | null;
  reported_moving_seconds: number | null;
  reported_elapsed_seconds: number | null;
  distance_m: number | null;
  moving_seconds: number | null;
  elapsed_seconds: number | null;
  sensor_summary: Record<string, unknown>;
  verification_note: string | null;
  verified_at: string | null;
};
export const ACTIVITY_COLUMNS =
  "id,user_id,activity_type,source,status,started_at,ended_at,reported_distance_m,reported_moving_seconds,reported_elapsed_seconds,distance_m,moving_seconds,elapsed_seconds,sensor_summary,verification_note,verified_at";
export function statusLabel(status: string) {
  return (
    (
      {
        recording: "Upload in progress",
        paused: "Upload paused",
        completed: "Awaiting submission",
        submitted: "Pending verification",
        verified: "Verified",
        flagged: "Needs review",
        rejected: "Rejected",
      } as Record<string, string>
    )[status] ?? "Unknown status"
  );
}
export function metrics(a: Activity) {
  return a.status === "verified"
    ? {
        distance: a.distance_m,
        seconds: a.moving_seconds,
        elapsed: a.elapsed_seconds,
        label: "Verified metrics",
      }
    : {
        distance: a.reported_distance_m,
        seconds: a.reported_moving_seconds,
        elapsed: a.reported_elapsed_seconds,
        label: "Phone estimates · not verified",
      };
}
export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}
export function formatPace(distance: number | null, seconds: number | null) {
  if (distance === null || seconds === null || distance < 10 || seconds <= 0)
    return "—";
  const s = Math.round(seconds / (distance / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(new Date(iso));
}
export type RoutePoint = {
  sample_number: number;
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
};
export function routeSegments(
  points: RoutePoint[],
  summary: Record<string, unknown>,
) {
  const starts = new Set(
    Array.isArray(summary.segment_starts)
      ? summary.segment_starts.filter((n) => typeof n === "number")
      : [],
  );
  let segment = 0;
  return points.map((p, i) => {
    // Also break a trace if samples are missing or timestamps contain a gap.
    if (
      i > 0 &&
      (starts.has(p.sample_number) ||
        p.sample_number !== points[i - 1].sample_number + 1 ||
        new Date(p.recorded_at).getTime() -
          new Date(points[i - 1].recorded_at).getTime() >
          20_000)
    )
      segment++;
    return { latitude: p.latitude, longitude: p.longitude, segment };
  });
}
