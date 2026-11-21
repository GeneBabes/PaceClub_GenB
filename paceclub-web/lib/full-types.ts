export type ActivityType = "walk" | "run" | "ride";
export type Dashboard = {
  totals: { distance_m: number; moving_seconds: number; activities: number };
  pending: number;
  weeks: {
    week_start: string;
    activity_type: ActivityType;
    distance_km: number;
    active_minutes: number;
    pace_min_per_km: number | null;
    activities: number;
  }[];
  bests: {
    activity_id: string;
    activity_type: ActivityType;
    distance_m: number;
    started_at: string;
    elapsed_seconds: number;
    best_seconds: number;
  }[];
  balances: { xp: number; coins: number };
  competitive_ready: boolean;
};
export type Club = {
  id: string;
  name: string;
  description: string;
  created_by: string;
  is_open: boolean;
  member_count: number;
  my_role: "owner" | "member" | null;
};
export type Challenge = {
  id: string;
  title: string;
  activity_type: ActivityType;
  mode: string;
  club_id: string | null;
  personal: boolean;
  created_by: string;
  starts_at: string;
  ends_at: string;
  status: string;
  finalized_at: string | null;
  rules: {
    goal_m: number;
    daily_cap_m: number;
    tie_rule: string;
    review_hours: number;
  };
};
export type RemoteActivity = {
  id: string;
  activity_type: ActivityType;
  source: string;
  status: string;
  started_at: string;
  ended_at: string;
  distance_m: number | null;
  moving_seconds: number | null;
  elapsed_seconds: number | null;
  reported_distance_m: number | null;
  verification_note: string | null;
  user_id: string;
  selected_club_id: string | null;
};
export type Post = {
  id: string;
  activity_id: string;
  author_id: string;
  caption: string;
  photo_path: string | null;
  visibility: string;
  club_id: string | null;
  created_at: string;
  display_name: string;
  avatar_path: string | null;
  activity_type: ActivityType;
  source: string;
  distance_m: number;
  moving_seconds: number;
  kudos: number;
  liked: boolean;
  comments: number;
};
export type Item = {
  id: string;
  name: string;
  type: string;
  price_coins: number;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};
export type Conversation = {
  id: string;
  type: string;
  clan_id: number | null;
  club_id: string | null;
  direct_user_a: string | null;
  direct_user_b: string | null;
  requested_by: string | null;
  direct_status: string | null;
};
export type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  removed_at: string | null;
};
export type Profile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  clan_id: number | null;
};
export type Geometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};
export type Zone = {
  id: string;
  name: string;
  season_key: string;
  boundary_geojson: Geometry;
};
export type Territory = {
  id: string;
  claim_id: string;
  owner_id: string;
  zone_id: string;
  area_m2: number;
  boundary_geojson: Geometry;
};
