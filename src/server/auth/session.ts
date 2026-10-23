import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { isOperatorEmailAllowed } from "@/lib/env";
import { createClient, type SupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
};

export type WorkspaceContext = {
  user: SessionUser;
  workspace: { id: string; name: string };
  supabase: SupabaseServerClient;
};

/**
 * Verified current user. `getClaims()` validates the JWT, unlike `getSession()`.
 * Deduplicated per request; never cached across requests.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) {
    redirect("/login");
  }
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
});

/**
 * Current operator plus their workspace (created on first use) and an RLS-scoped client.
 * Every page section and Server Action that touches workspace data goes through this.
 */
export const requireWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const user = await getCurrentUser();
  if (!isOperatorEmailAllowed(user.email)) {
    redirect("/access-denied");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_workspace");
  if (error || !data) {
    throw new Error("Could not load your workspace. Check the database connection and try again.");
  }

  return { user, workspace: { id: data.id, name: data.name }, supabase };
});
