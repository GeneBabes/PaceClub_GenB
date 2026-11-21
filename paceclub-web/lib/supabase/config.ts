export function connection() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || url.includes("YOUR_PROJECT") || key.startsWith("YOUR_")) {
    throw new Error(
      "Fill in paceclub-web/.env.local, then restart npm run dev.",
    );
  }
  return { url, key };
}
