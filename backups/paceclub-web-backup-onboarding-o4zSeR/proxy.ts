import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { connection } from './lib/supabase/config';

export async function proxy(request: NextRequest) {
  const { url, key } = connection();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (updates, headers) => {
        for (const item of updates) request.cookies.set(item.name, item.value);
        response = NextResponse.next({ request });
        for (const item of updates) response.cookies.set(item.name, item.value, item.options);
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });
  // Validate/refresh tokens; never use an unverified getSession() for authorization.
  await supabase.auth.getClaims();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: ['/', '/auth/callback'] };
