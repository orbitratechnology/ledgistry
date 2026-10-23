"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { isOperatorEmailAllowed } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/server/audit/record";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
});

export type SignInState = {
  email?: string;
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
};

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = credentialsSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    const fieldErrors: SignInState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "email" || field === "password") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { email, fieldErrors };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    // Deliberately generic: do not reveal whether the account exists.
    return { email, error: "Email or password is incorrect." };
  }

  if (!isOperatorEmailAllowed(data.user.email)) {
    await supabase.auth.signOut({ scope: "local" });
    return { email, error: "This account is not authorised to operate this workspace." };
  }

  const { data: workspace } = await supabase.rpc("ensure_workspace");
  if (workspace) {
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: data.user.id },
      eventType: "auth.signed_in",
      outcome: "success",
      summary: "Operator signed in.",
    });
  }

  redirect("/overview");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
