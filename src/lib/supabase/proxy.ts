import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isOperatorAllowed, parseOperatorAllowlist } from "@/lib/auth/operator-allowlist";
import type { Database } from "@/lib/db/database.types";
import { getSupabasePublicConfig } from "./config";

const PUBLIC_PATHS = ["/login", "/access-denied"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie and applies optimistic route protection.
 * Pages and actions still verify the user themselves (see src/server/auth).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  let config: { url: string; key: string };
  try {
    config = getSupabasePublicConfig();
  } catch {
    // Let the page render so its error boundary can explain the missing configuration.
    return supabaseResponse;
  }

  const supabase = createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  if (!claims) {
    return isPublicPath(pathname) ? supabaseResponse : redirectTo("/login");
  }

  const email = typeof claims.email === "string" ? claims.email : null;
  const allowlist = parseOperatorAllowlist(process.env.LEDGISTRY_OPERATOR_EMAILS);

  if (!isOperatorAllowed(email, allowlist)) {
    return pathname === "/access-denied" ? supabaseResponse : redirectTo("/access-denied");
  }
  if (isPublicPath(pathname)) {
    return redirectTo("/overview");
  }
  return supabaseResponse;
}
