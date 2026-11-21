import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "./config";

export async function serverClient() {
  const store = await cookies();
  const { url, key } = connection();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (updates) => {
        try {
          for (const item of updates)
            store.set(item.name, item.value, item.options);
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them.
        }
      },
    },
  });
}
