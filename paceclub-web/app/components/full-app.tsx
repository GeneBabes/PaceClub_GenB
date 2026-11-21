"use client";
import { useEffect } from "react";
import { Analytics, Notifications, Overview, Rewards } from "./overview";
import { Clubs, Play } from "./play";
import { Chat, Community } from "./social";
import { Territories } from "./territory";
import { Moderation } from "./moderation";
import { ImportPractice } from "./import-practice";
import { rpc, useData } from "./data";
export type Section =
  | "home"
  | "play"
  | "clubs"
  | "community"
  | "chat"
  | "analytics"
  | "rewards"
  | "notifications"
  | "territory"
  | "moderation"
  | "import"
  | "practice";
const navigation = [
  ["home", "Overview", "◉"],
  ["play", "Play", "↗"],
  ["clubs", "Clubs", "◎"],
  ["community", "Community", "◇"],
  ["chat", "Messages", "▤"],
  ["analytics", "Analytics", "▥"],
  ["rewards", "Rewards", "✦"],
  ["territory", "Territory", "⌖"],
  ["notifications", "Updates", "◷"],
] as const;
export default function FullApp({
  section,
  user,
  role,
}: {
  section: Section;
  user: { id: string; name: string; clan: number | null };
  role: string;
}) {
  const version = useData("app-version", () => rpc<string>("pc_app_version"));
  const cosmetics = useData(
    "app-cosmetics",
    async () => {
      const { db, checked } = await import("./data");
      return checked(
        await db()
          .from("user_inventory")
          .select("item_id")
          .eq("equipped", true),
      ) as { item_id: string }[];
    },
    ["user_inventory"],
  );
  useEffect(() => {
    const sunrise = cosmetics.data?.some(
      (i) => i.item_id === "50000000-0000-4000-8000-000000000002",
    );
    document.documentElement.dataset.theme = sunrise ? "sunrise" : "forest";
    document.documentElement.dataset.frame = cosmetics.data?.some((i) =>
      i.item_id.endsWith("0003"),
    )
      ? "gold"
      : "";
    document.documentElement.dataset.bubble = cosmetics.data?.some((i) =>
      i.item_id.endsWith("0005"),
    )
      ? "sage"
      : "";
    return () => {
      delete document.documentElement.dataset.theme;
      delete document.documentElement.dataset.frame;
      delete document.documentElement.dataset.bubble;
    };
  }, [cosmetics.data]);
  return (
    <div className="pc-shell">
      <aside className="pc-sidebar">
        <a className="brand" href="/home">
          PACECLUB<span className="brand-dot">●</span>
        </a>
        <p className="sidebar-caption">MOVE. CONNECT. GROW.</p>
        <nav aria-label="PaceClub navigation">
          {navigation.map(([key, label, icon]) => (
            <a
              key={key}
              href={"/" + key}
              aria-current={section === key ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </a>
          ))}
          <a href="/activities">
            <span aria-hidden="true">≋</span>Activity history
          </a>
          <a href="/import">
            <span aria-hidden="true">↑</span>Import GPX
          </a>
          <a href="/practice">
            <span aria-hidden="true">△</span>Practice lab
          </a>
          {["admin", "moderator"].includes(role) && (
            <a
              href="/moderation"
              aria-current={section === "moderation" ? "page" : undefined}
            >
              <span aria-hidden="true">✓</span>Moderation
            </a>
          )}
        </nav>
        <a className="sidebar-profile" href="/profile">
          <span className="profile-initial">{user.name[0]}</span>
          <div>
            <strong>{user.name}</strong>
            {cosmetics.data?.some((i) => i.item_id.endsWith("0004")) && (
              <small>✦ Trail explorer</small>
            )}
            <small>
              {user.clan
                ? ["", "Virtus", "Sapientia", "Constantia", "Libertas"][
                    user.clan
                  ]
                : "Your profile"}
            </small>
          </div>
        </a>
      </aside>
      <main className="pc-main">
        <div className="pc-topline">
          <span>Your pace. Your community.</span>
          <a href="/profile">Profile & account ↗</a>
        </div>
        {version.error && (
          <div className="soft-note" role="alert">
            The full-app database migration is not available: {version.error}.
            Apply database/03-full-app.sql and database/04-territory.sql to your
            existing project.
          </div>
        )}
        {section === "home" ? (
          <Overview name={user.name} />
        ) : section === "analytics" ? (
          <Analytics />
        ) : section === "rewards" ? (
          <Rewards />
        ) : section === "notifications" ? (
          <Notifications />
        ) : section === "play" ? (
          <Play userId={user.id} role={role} />
        ) : section === "clubs" ? (
          <Clubs userId={user.id} />
        ) : section === "community" ? (
          <Community userId={user.id} />
        ) : section === "chat" ? (
          <Chat userId={user.id} />
        ) : section === "territory" ? (
          <Territories userId={user.id} role={role} />
        ) : section === "moderation" ? (
          <Moderation userId={user.id} role={role} />
        ) : (
          <ImportPractice practice={section === "practice"} userId={user.id} />
        )}
        <footer className="pc-footer">
          Your progress belongs to you. Move at your own pace.
        </footer>
      </main>
    </div>
  );
}
