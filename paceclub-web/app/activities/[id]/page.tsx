import { AthleteAppeal } from "../../components/moderation";
import { notFound, redirect } from "next/navigation";
import { loadAccount } from "@/lib/account";
import {
  ACTIVITY_COLUMNS,
  formatDate,
  formatDuration,
  formatPace,
  metrics,
  routeSegments,
  statusLabel,
  type Activity,
  type RoutePoint,
} from "@/lib/activities";
import { routeGeometry } from "@/lib/route-geometry";
import ActivityHeader from "../activity-header";
export const dynamic = "force-dynamic";
export const metadata = { title: "Activity details · PaceClub" };

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const account = await loadAccount();
  if (!account.user || !account.profile?.is_active) redirect("/");
  if (account.error || !account.complete) redirect("/onboarding");
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const { data, error } = await account.supabase
    .from("activities")
    .select(ACTIVITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error)
    return (
      <main className="home-page">
        <ActivityHeader />
        <section className="card error-message">
          <h1>Unable to load.</h1>
          <p>This activity could not load. Please retry.</p>
          <a className="text-link" href={`/activities/${id}`}>
            Retry
          </a>
        </section>
      </main>
    );
  if (!data) notFound();
  const a = data as Activity,
    m = metrics(a);
  const points: RoutePoint[] = [];
  let routeError = false,
    truncated = false;
  for (let offset = 0; offset < 25_000; offset += 1000) {
    const batch = await account.supabase
      .from("activity_points")
      .select("sample_number,recorded_at,latitude,longitude,accuracy_m")
      .eq("activity_id", id)
      .order("sample_number")
      .range(offset, offset + 999);
    if (batch.error) {
      routeError = true;
      break;
    }
    points.push(...(batch.data as RoutePoint[]));
    if (batch.data.length < 1000) break;
    if (offset === 24_000) truncated = true;
  }
  const summary = a.sensor_summary ?? {};
  const route = routeGeometry(routeSegments(points, summary), 620, 320);
  const complete = ["submitted", "verified", "flagged", "rejected"].includes(
    a.status,
  );
  return (
    <main className="home-page activity-detail">
      <ActivityHeader />
      <a className="back-link" href="/activities">
        ← All activities
      </a>
      <div className="detail-title">
        <div>
          <p className="eyebrow">YOUR ACTIVITY · {a.source?.toUpperCase()}</p>
          <h1>{a.activity_type[0].toUpperCase() + a.activity_type.slice(1)}</h1>
          <p className="muted">
            <time dateTime={a.started_at}>{formatDate(a.started_at)}</time> ·
            Philippine time
          </p>
        </div>
        <span className={`badge activity-status status-${a.status}`}>
          {statusLabel(a.status)}
        </span>
      </div>
      <section className="card">
        <p className="eyebrow">{m.label}</p>
        <div className="activity-stats detail-stats">
          <div>
            <strong>
              {m.distance === null
                ? "—"
                : (Number(m.distance) / 1000).toFixed(2)}
            </strong>
            <span>kilometres</span>
          </div>
          <div>
            <strong>{formatDuration(m.seconds)}</strong>
            <span>
              {a.status === "verified" ? "moving time" : "active time"}
            </span>
          </div>
          <div>
            <strong>
              {a.activity_type === "ride"
                ? m.distance !== null && m.seconds && m.seconds > 0
                  ? ((Number(m.distance) / m.seconds) * 3.6).toFixed(1)
                  : "—"
                : formatPace(m.distance, m.seconds)}
            </strong>
            <span>
              {a.activity_type === "ride" ? "average km/h" : "average min/km"}
            </span>
          </div>
        </div>
        <p className="muted">Elapsed time: {formatDuration(m.elapsed)}</p>
        {a.status !== "verified" && (
          <p className="soft-note">
            These are estimates reported by your phone. Active time excludes
            pauses and is not yet verified moving time.
          </p>
        )}
      </section>
      <section className="card">
        <div className="history-heading">
          <h2>Your route</h2>
          <span className="muted">
            {points.length.toLocaleString()} GPS samples
          </span>
        </div>
        {routeError ? (
          <p role="alert" className="message error-message">
            The complete route could not load.{" "}
            <a href={`/activities/${id}`}>Retry</a>
          </p>
        ) : !points.length ? (
          <p className="muted">
            {complete
              ? "No GPS route was supplied for this activity."
              : "The route is still uploading. Keep PaceClub open on your phone, then refresh this page."}
          </p>
        ) : (
          <>
            <svg
              className="route-trace"
              viewBox="0 0 620 320"
              role="img"
              aria-label="Recorded route trace. Green start, amber end; gaps indicate pauses or missing GPS. North is up."
            >
              <rect width="620" height="320" rx="14" fill="#f0f4eb" />
              {[40, 80, 120, 160, 200, 240, 280].map((y) => (
                <path key={y} d={`M0 ${y} H620`} stroke="#dfe7d9" />
              ))}
              {route.paths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#245741"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {route.first && (
                <circle
                  cx={route.first.x}
                  cy={route.first.y}
                  r="6"
                  fill="white"
                  stroke="#245741"
                  strokeWidth="2"
                />
              )}
              {route.last && (
                <circle
                  cx={route.last.x}
                  cy={route.last.y}
                  r="4"
                  fill="#b87035"
                />
              )}
            </svg>
            <p className="route-caption">
              Green start · amber end · north up. Route trace without a street
              map; pauses and GPS gaps stay separate.
            </p>
          </>
        )}
        {truncated && (
          <p className="soft-note">
            Preview limited to the first 25,000 samples.
          </p>
        )}
      </section>
      <section className="card">
        <h2>Verification</h2>
        <p>
          {a.status === "verified"
            ? "This activity has been verified."
            : a.status === "submitted"
              ? "Your activity was received and is awaiting verification. No verified progress has been awarded."
              : a.status === "flagged"
                ? "This activity needs review before it can count toward verified progress."
                : a.status === "rejected"
                  ? "This activity was rejected and does not count toward verified progress."
                  : "This upload has not been submitted yet. Open PaceClub on your phone to finish the upload."}
        </p>
        {a.verification_note && (
          <p className="soft-note">{a.verification_note}</p>
        )}
        {a.verified_at && (
          <p className="muted">Verified: {formatDate(a.verified_at)}</p>
        )}
        <a className="text-link" href={`/activities/${id}`}>
          Refresh activity
        </a>
      </section>
      {a.user_id === account.user.id && (
        <AthleteAppeal id={id} status={a.status} />
      )}
    </main>
  );
}
