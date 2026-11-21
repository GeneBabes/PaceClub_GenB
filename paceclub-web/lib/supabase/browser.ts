import { createBrowserClient } from "@supabase/ssr";
import { connection } from "./config";

export function browserClient() {
  const { url, key } = connection();
  return createBrowserClient(url, key);
}
