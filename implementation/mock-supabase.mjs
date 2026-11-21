// Isolated UI fixture service. Run only on localhost for screen tests.
import http from "node:http";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  club = "40000000-0000-4000-8000-000000000001",
  challenge = "60000000-0000-4000-8000-000000000001",
  activity = "70000000-0000-4000-8000-000000000001",
  conversation = "80000000-0000-4000-8000-000000000001";
const date = new Date().toISOString(),
  profile = {
    id: A,
    display_name: "Alex Rivera",
    avatar_path: null,
    clan_id: 3,
    is_active: true,
  },
  onboarding = { user_id: A, answers: {}, tutorial_completed_at: date };
const week = new Date();
week.setDate(week.getDate() - 21);
const dashboard = {
  totals: { distance_m: 24600, moving_seconds: 14640, activities: 8 },
  pending: 1,
  balances: { xp: 720, coins: 85 },
  competitive_ready: true,
  weeks: [4.1, 5.2, 7.3, 8].map((distance_km, i) => ({
    week_start: new Date(week.getTime() + i * 604800000)
      .toISOString()
      .slice(0, 10),
    activity_type: "walk",
    distance_km,
    active_minutes: distance_km * 10,
    pace_min_per_km: 10 - i * 0.3,
    activities: 2,
  })),
  bests: [
    {
      activity_id: activity,
      activity_type: "walk",
      distance_m: 1000,
      started_at: date,
      elapsed_seconds: 590,
      best_seconds: 590,
    },
  ],
};
const activities = [
  {
    id: activity,
    user_id: A,
    activity_type: "walk",
    source: "gps",
    status: "verified",
    started_at: date,
    ended_at: date,
    distance_m: 4100,
    moving_seconds: 2400,
    elapsed_seconds: 2500,
    reported_distance_m: 4100,
    reported_moving_seconds: 2400,
    reported_elapsed_seconds: 2500,
    verification_note: "Route and timestamp checks passed.",
    sensor_summary: { segment_starts: [0] },
    selected_club_id: club,
    verified_at: date,
  },
];
const tables = {
  profiles: [
    profile,
    { ...profile, id: B, display_name: "Maya Santos", clan_id: 4 },
  ],
  onboarding_answers: [onboarding],
  activities,
  activity_points: [],
  activity_appeals: [],
  reward_ledger: [],
  user_inventory: [
    {
      user_id: A,
      item_id: "50000000-0000-4000-8000-000000000003",
      equipped: true,
    },
  ],
  reward_items: [
    {
      id: "50000000-0000-4000-8000-000000000002",
      name: "Sunrise theme",
      type: "theme",
      price_coins: 20,
    },
    {
      id: "50000000-0000-4000-8000-000000000003",
      name: "Gold circle",
      type: "avatar_frame",
      price_coins: 30,
    },
  ],
  challenges: [
    {
      id: challenge,
      title: "A little further, together",
      activity_type: "walk",
      mode: "club",
      club_id: club,
      personal: false,
      created_by: A,
      starts_at: date,
      ends_at: new Date(Date.now() + 604800000).toISOString(),
      status: "open",
      finalized_at: null,
      rules: {
        goal_m: 25000,
        daily_cap_m: 10000,
        tie_rule: "Equal scores share first place.",
        review_hours: 48,
      },
    },
  ],
  challenge_participants: [{ challenge_id: challenge, user_id: A }],
  pc_challenge_leaderboard: [
    { challenge_id: challenge, user_id: A, total_points: 4100, position: 1 },
  ],
  club_members: [
    { club_id: club, user_id: A, role: "owner", status: "active" },
    { club_id: club, user_id: B, role: "member", status: "active" },
  ],
  conversations: [
    { id: conversation, type: "global", direct_status: null, created_at: date },
  ],
  messages: [
    {
      id: "m1",
      conversation_id: conversation,
      sender_id: B,
      body: "A good morning for a gentle walk. Who is joining this weekend?",
      created_at: date,
      removed_at: null,
    },
  ],
  user_blocks: [],
  post_comments: [],
  notifications: [
    {
      id: "n1",
      title: "Your activity is verified",
      body: "Your morning walk is ready to share.",
      created_at: date,
      read_at: null,
    },
  ],
  play_zones: [
    {
      id: "zone-1",
      name: "Community park",
      is_active: true,
      season_key: "Season 1",
      boundary_geojson: {
        type: "Polygon",
        coordinates: [
          [
            [120, 16],
            [120.002, 16],
            [120.002, 16.002],
            [120, 16.002],
            [120, 16],
          ],
        ],
      },
    },
  ],
  territories: [],
  territory_claims: [],
  content_reports: [],
  message_reports: [],
};
const clubs = [
  {
    id: club,
    name: "Weekend Wanderers",
    description: "Easy routes, good conversations, and room for everyone.",
    is_open: true,
    created_by: A,
    member_count: 12,
    my_role: "owner",
  },
];
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,apikey,x-client-info,content-type,prefer,range,x-supabase-api-version",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1:54440");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {}
  let result = [];
  if (url.pathname === "/auth/v1/user")
    result = {
      id: A,
      aud: "authenticated",
      email: "alex@example.invalid",
      role: "authenticated",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: profile.display_name },
      created_at: date,
    };
  else if (url.pathname.includes("/rpc/")) {
    const rpc = url.pathname.split("/").at(-1);
    if (rpc === "pc_my_role") result = "admin";
    else if (rpc === "pc_app_version") result = "full-v1";
    else if (rpc === "pc_dashboard") result = dashboard;
    else if (rpc === "pc_competitive_ready" || rpc === "pc_reserve_insight")
      result = true;
    else if (rpc === "pc_club_directory") result = clubs;
    else if (rpc === "pc_feed")
      result = [
        {
          id: "post-1",
          activity_id: activity,
          author_id: B,
          caption:
            "Small steps and a little sunshine. A good start to the week.",
          photo_path: null,
          visibility: "members",
          club_id: null,
          created_at: date,
          display_name: "Maya Santos",
          avatar_path: null,
          activity_type: "walk",
          source: "gps",
          distance_m: 3200,
          moving_seconds: 1900,
          kudos: 7,
          liked: false,
          comments: 0,
        },
      ];
    else if (rpc === "pc_territory_board") result = [];
    else result = null;
  } else if (url.pathname.includes("/rest/v1/")) {
    const table = url.pathname.split("/").at(-1);
    let rows = [...(tables[table] || [])];
    for (const [key, value] of url.searchParams) {
      if (value.startsWith("eq."))
        rows = rows.filter((r) => String(r[key]) === value.slice(3));
      if (value.startsWith("neq."))
        rows = rows.filter((r) => String(r[key]) !== value.slice(4));
      if (value.startsWith("in.("))
        rows = rows.filter((r) =>
          value.slice(4, -1).split(",").includes(String(r[key])),
        );
    }
    if (req.method === "POST" && Array.isArray(tables[table])) {
      const row = {
        id: body.id || crypto.randomUUID(),
        created_at: date,
        ...body,
      };
      tables[table].push(row);
      rows = [row];
    }
    if (req.method === "PATCH") {
      rows.forEach((r) => Object.assign(r, body));
    }
    const offset = Number(url.searchParams.get("offset") || 0),
      limit = Number(url.searchParams.get("limit") || 1000);
    rows = rows.slice(offset, offset + limit);
    res.setHeader(
      "Content-Range",
      `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
    );
    result = String(req.headers.accept).includes("vnd.pgrst.object")
      ? (rows[0] ?? null)
      : rows;
  }
  res.end(JSON.stringify(result));
});
server.listen(54440, "127.0.0.1", () =>
  console.log(
    "Local fixture service ready on 54440. No live accounts or database.",
  ),
);
