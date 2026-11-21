import { redirect } from "next/navigation";
import { loadAccount } from "@/lib/account";
import {
  ACTIVITY_COLUMNS,
  formatDate,
  formatDuration,
  metrics,
  statusLabel,
  type Activity,
} from "@/lib/activities";
import ActivityHeader from "./activity-header";
export const dynamic = "force-dynamic";
export const metadata = { title: "Activities · PaceClub" };

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const account = await loadAccount();
  if (!account.user || !account.profile?.is_active) redirect("/");
  if (account.error || !account.complete) redirect("/onboarding");
  const params = await searchParams;
  const parsed = Number(params.page ?? 1);
  const page =
    Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 10_000
      ? parsed
      : 1;
  const limit = 20;
  const { data, error, count } = await account.supabase
    .from("activities")
    .select(ACTIVITY_COLUMNS, { count: "exact" })
    .eq("user_id", account.user.id)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  const activities = (data ?? []) as Activity[];
  return (
    <main className="home-page activity-page">
      <ActivityHeader />
      <p className="eyebrow">YOUR MOVEMENT, ALL TOGETHER</p>
      <h1>
        Every route.
        <br />A little progress.
      </h1>
      <p className="intro">
        Activities you send from your phone appear here. Your route details stay
        in your account.
      </p>
      <div className="history-heading">
        <h2>Your activities</h2>
        <a className="refresh-link" href={`/activities?page=${page}`}>
          Refresh history
        </a>
      </div>
      {error ? (
        <section className="card error-message" role="alert">
          <h2>History could not load.</h2>
          <p>Please check your connection and retry.</p>
          <a className="text-link" href="/activities">
            Try again
          </a>
        </section>
      ) : !activities.length ? (
        <section className="card empty-activities">
          <div className="route-mark" aria-hidden="true">
            ↗
          </div>
          <h2>
            {page === 1
              ? "Your first route is waiting."
              : "No activities on this page."}
          </h2>
          <p className="muted">
            {page === 1
              ? "Open PaceClub on your phone, record a walk, run, or ride, then finish and submit it. Sign in with the same account on both devices."
              : "Return to the first page to see your latest activities."}
          </p>
          {page > 1 && (
            <a href="/activities" className="text-link">
              Back to latest activities
            </a>
          )}
        </section>
      ) : (
        <div className="activity-list">
          {activities.map((a) => {
            const m = metrics(a);
            return (
              <article className="card activity-row" key={a.id}>
                <div className="activity-row-top">
                  <span className={`badge activity-status status-${a.status}`}>
                    {statusLabel(a.status)}
                  </span>
                  <time dateTime={a.started_at}>
                    {formatDate(a.started_at)}
                  </time>
                </div>
                <h2>
                  <a href={`/activities/${a.id}`}>
                    {a.activity_type[0].toUpperCase() +
                      a.activity_type.slice(1)}
                  </a>
                </h2>
                <div className="activity-stats">
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
                </div>
                <div className="activity-row-bottom">
                  <small className="muted">{m.label}</small>
                  <a
                    href={`/activities/${a.id}`}
                    className="text-link"
                    aria-label={`View ${a.activity_type} from ${formatDate(a.started_at)}`}
                  >
                    View activity →
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!error && (page > 1 || (count ?? 0) > page * limit) && (
        <nav className="history-pagination" aria-label="Activity pages">
          {page > 1 && <a href={`/activities?page=${page - 1}`}>← Newer</a>}
          <span>Page {page}</span>
          {(count ?? 0) > page * limit && (
            <a href={`/activities?page=${page + 1}`}>Older →</a>
          )}
        </nav>
      )}
      <p className="soft-note">
        Phone estimates are shown until verification finishes. Pending
        activities do not earn verified progress or leaderboard credit.
      </p>
      <p className="footnote">Dates shown in Philippine time (UTC+8).</p>
    </main>
  );
}
