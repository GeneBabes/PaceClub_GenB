import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { connection } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url));
  response.headers.set("Cache-Control", "private, no-store");
  const { url, key } = connection();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updates, headers) => {
        for (const item of updates) {
          request.cookies.set(item.name, item.value);
          response.cookies.set(item.name, item.value, item.options);
        }
        for (const [name, value] of Object.entries(headers ?? {}))
          response.headers.set(name, value);
      },
    },
  });
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (!error) return response;
  }
  // Preserve any cookie changes on the same response; never accept a user-supplied redirect.
  response.headers.set(
    "Location",
    new URL("/?auth_error=1", request.url).toString(),
  );
  return response;
}
