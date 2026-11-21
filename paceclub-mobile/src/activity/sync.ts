import type { SupabaseClient } from "@supabase/supabase-js";
import { submissionProblem, type LocalActivity, type Point } from "./model";

const terminal = new Set(["submitted", "verified", "flagged", "rejected"]);
function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
export async function uploadActivity(
  client: SupabaseClient,
  a: LocalActivity,
  points: Point[],
) {
  const problem = submissionProblem(a);
  if (problem) throw new Error(problem);
  if (points.length !== a.pointCount || points.some((p, i) => p.sample !== i))
    throw new Error(
      "The saved route is incomplete. Keep this activity on your phone.",
    );
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  fail(authError);
  if (user?.id !== a.userId)
    throw new Error("Sign in to the account that recorded this activity.");
  // Stable UUID + primary-key sample numbers make every retry idempotent.
  const read = async () => {
    const { data, error } = await client
      .from("activities")
      .select("id, status")
      .eq("id", a.id)
      .eq("user_id", a.userId)
      .maybeSingle();
    fail(error);
    return data as { id: string; status: string } | null;
  };
  let remote = await read();
  // A lost response after submission must not attempt writes to the frozen input.
  if (remote && terminal.has(remote.status)) {
    await uploadSafety(client, a);
    return;
  }
  if (!remote) {
    const { error } = await client
      .from("activities")
      .insert({
        id: a.id,
        user_id: a.userId,
        activity_type: a.type,
        source: "gps",
        selected_club_id: a.clubId || null,
        selected_challenge_id: a.challengeId || null,
        started_at: new Date(a.startedAt).toISOString(),
      });
    if (error && error.code !== "23505") fail(error);
    remote = await read();
    if (!remote) throw new Error("Your activity could not be created.");
    if (terminal.has(remote.status)) {
      await uploadSafety(client, a);
      return;
    }
  }
  for (let start = 0; start < points.length; start += 250) {
    const batch = points
      .slice(start, start + 250)
      .map((p) => ({
        activity_id: a.id,
        sample_number: p.sample,
        recorded_at: new Date(p.timestamp).toISOString(),
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy_m: p.accuracy,
      }));
    const { error } = await client
      .from("activity_points")
      .upsert(batch, {
        onConflict: "activity_id,sample_number",
        ignoreDuplicates: true,
      });
    fail(error);
  }
  const segmentStarts = points
    .filter((p, i) => i === 0 || p.segment !== points[i - 1].segment)
    .map((p) => p.sample);
  const { data, error } = await client
    .from("activities")
    .update({
      ended_at: new Date(a.endedAt!).toISOString(),
      reported_distance_m: Math.round(a.distanceM * 100) / 100,
      reported_moving_seconds: Math.floor(a.activeMs / 1000),
      reported_elapsed_seconds: Math.max(
        Math.floor(a.activeMs / 1000),
        Math.floor((a.endedAt! - a.startedAt) / 1000),
      ),
      sensor_summary: {
        recorder: "paceclub-foreground-v1",
        duration_basis: "manual_active_timer",
        verification: "unverified_device_report",
        segment_starts: segmentStarts,
        point_count: points.length,
        rejected_fixes: a.rejected,
        accuracy_limit_m: 35,
        background_recording: false,
        motion: a.motion || { status: "not available" },
      },
    })
    .eq("id", a.id)
    .eq("user_id", a.userId)
    .select("id")
    .single();
  fail(error);
  if (!data) throw new Error("The activity summary could not be saved.");
  if (remote.status !== "completed") {
    const { error } = await client.rpc("pc_set_activity_status", {
      p_activity_id: a.id,
      p_status: "completed",
    });
    fail(error);
  }
  const result = await client.rpc("pc_set_activity_status", {
    p_activity_id: a.id,
    p_status: "submitted",
  });
  fail(result.error);
  await uploadSafety(client, a);
}

async function uploadSafety(client: SupabaseClient, a: LocalActivity) {
  for (const event of a.safetyEvents || []) {
    const inserted = await client
      .from("safety_events")
      .upsert(
        {
          id: event.id,
          user_id: a.userId,
          activity_id: a.id,
          event_type: event.kind,
          detected_at: new Date(event.detectedAt).toISOString(),
          latitude: event.latitude,
          longitude: event.longitude,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
    fail(inserted.error);
    const result = await client
      .from("safety_events")
      .update({
        status: event.status,
        responded_at: event.respondedAt
          ? new Date(event.respondedAt).toISOString()
          : null,
      })
      .eq("id", event.id)
      .eq("user_id", a.userId);
    fail(result.error);
  }
}
