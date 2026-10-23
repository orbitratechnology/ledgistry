import "server-only";

import type { Json } from "@/lib/db/database.types";
import type { SupabaseServerClient } from "@/lib/supabase/server";

export type AuditOutcome = "success" | "failure" | "pending" | "info";

export type AuditEventInput = {
  workspaceId: string;
  actor: { type: "user"; userId: string } | { type: "system" };
  eventType: string;
  entityType?: string;
  entityId?: string;
  outcome: AuditOutcome;
  summary: string;
  /** Redacted, non-secret context only: never tokens, headers or full bank details. */
  metadata?: Record<string, Json>;
};

/**
 * Appends an audit event. The table is append-only (no UPDATE/DELETE grants plus a trigger).
 * Returns false instead of throwing so a failed audit write never masks the primary outcome;
 * callers that must guarantee an audit trail check the result.
 */
export async function recordAuditEvent(
  supabase: SupabaseServerClient,
  event: AuditEventInput,
): Promise<boolean> {
  const { error } = await supabase.from("audit_events").insert({
    workspace_id: event.workspaceId,
    actor_type: event.actor.type,
    actor_user_id: event.actor.type === "user" ? event.actor.userId : null,
    event_type: event.eventType,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    outcome: event.outcome,
    summary: event.summary.slice(0, 500),
    metadata: event.metadata ?? {},
  });
  if (error) {
    console.error("[audit] failed to record event", { eventType: event.eventType, code: error.code });
    return false;
  }
  return true;
}
