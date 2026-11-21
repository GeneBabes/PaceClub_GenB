import type { SupabaseClient } from "@supabase/supabase-js";
export type ImportedPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  segment: number;
  accuracy: number | null;
};
export function validateImport(points: ImportedPoint[]) {
  if (points.length < 2 || points.length > 25000)
    throw Error("Supply 2–25,000 track points.");
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (
      !Number.isFinite(p.latitude) ||
      Math.abs(p.latitude) > 90 ||
      !Number.isFinite(p.longitude) ||
      Math.abs(p.longitude) > 180 ||
      !Number.isFinite(p.timestamp)
    )
      throw Error("Each point needs valid coordinates and a timestamp.");
    if (i && p.timestamp <= points[i - 1].timestamp)
      throw Error("Track timestamps must increase.");
  }
  const elapsed = points.at(-1)!.timestamp - points[0].timestamp;
  if (elapsed < 10000 || elapsed > 43200000)
    throw Error("Choose a track between 10 seconds and 12 hours long.");
  return points;
}
export function parseGPX(xml: string) {
  if (xml.length > 10 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Choose a GPX under 10 MiB without embedded entities.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (
    doc.getElementsByTagName("parsererror").length ||
    doc.documentElement.localName !== "gpx"
  )
    throw Error("This is not a valid GPX document.");
  const points: ImportedPoint[] = [];
  const segments = Array.from(doc.getElementsByTagNameNS("*", "trkseg"));
  for (let segment = 0; segment < segments.length; segment++)
    for (const p of Array.from(
      segments[segment].getElementsByTagNameNS("*", "trkpt"),
    )) {
      const time = p.getElementsByTagNameNS("*", "time")[0]?.textContent;
      const lat = p.getAttribute("lat"),
        lon = p.getAttribute("lon");
      if (!time || lat === null || lon === null)
        throw Error(
          "GPX track points need latitude, longitude and time. Untimed routes cannot be verified.",
        );
      points.push({
        latitude: Number(lat),
        longitude: Number(lon),
        timestamp: Date.parse(time),
        segment,
        accuracy: null,
      });
    }
  return validateImport(points);
}
export function practicePoints(now = Date.now()): ImportedPoint[] {
  const start = now - 120000;
  return Array.from({ length: 13 }, (_, i) => ({
    latitude: 16 + i * 0.00004,
    longitude: 120 + Math.sin(i / 3) * 0.00003,
    timestamp: start + i * 10000,
    segment: 0,
    accuracy: 5,
  }));
}
export async function importActivity(
  client: SupabaseClient,
  id: string,
  type: string,
  source: "gpx" | "simulation",
  points: ImportedPoint[],
  gpx?: string,
) {
  validateImport(points);
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user) throw Error("Sign in before importing.");
  const fail = (e: { message: string } | null) => {
    if (e) throw Error(e.message);
  };
  let existing = await client
    .from("activities")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  fail(existing.error);
  if (
    existing.data &&
    ["submitted", "verified", "flagged", "rejected"].includes(
      existing.data.status,
    )
  )
    return id;
  if (!existing.data) {
    const r = await client
      .from("activities")
      .insert({
        id,
        user_id: user.id,
        activity_type: type,
        source,
        started_at: new Date(points[0].timestamp).toISOString(),
      });
    if (r.error?.code !== "23505") fail(r.error);
    existing = await client
      .from("activities")
      .select("id,status")
      .eq("id", id)
      .single();
    fail(existing.error);
  }
  for (let offset = 0; offset < points.length; offset += 250) {
    const result = await client.from("activity_points").upsert(
      points
        .slice(offset, offset + 250)
        .map((p, i) => ({
          activity_id: id,
          sample_number: offset + i,
          latitude: p.latitude,
          longitude: p.longitude,
          recorded_at: new Date(p.timestamp).toISOString(),
          accuracy_m: p.accuracy,
        })),
      { onConflict: "activity_id,sample_number", ignoreDuplicates: true },
    );
    fail(result.error);
  }
  let filePath: string | undefined;
  if (gpx) {
    filePath = `${user.id}/${id}.gpx`;
    const r = await client.storage
      .from("gpx-imports")
      .upload(filePath, new TextEncoder().encode(gpx), {
        contentType: "application/gpx+xml",
        upsert: true,
      });
    fail(r.error);
  }
  const result = await client
    .from("activities")
    .update({
      ended_at: new Date(points.at(-1)!.timestamp).toISOString(),
      sensor_summary: {
        recorder:
          source === "simulation"
            ? "paceclub-desk-simulation"
            : "paceclub-gpx-import",
        segment_starts: points.flatMap((p, i) =>
          !i || p.segment !== points[i - 1].segment ? [i] : [],
        ),
        point_count: points.length,
        motion:
          source === "simulation"
            ? {
                synthetic: true,
                accelerometer_samples: 480,
                gyroscope_samples: 480,
              }
            : null,
      },
      ...(filePath ? { gpx_file_path: filePath } : {}),
    })
    .eq("id", id)
    .select("id")
    .single();
  fail(result.error);
  if (existing.data?.status !== "completed")
    fail(
      (
        await client.rpc("pc_set_activity_status", {
          p_activity_id: id,
          p_status: "completed",
        })
      ).error,
    );
  fail(
    (
      await client.rpc("pc_set_activity_status", {
        p_activity_id: id,
        p_status: "submitted",
      })
    ).error,
  );
  return id;
}
