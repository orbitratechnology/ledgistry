import "server-only";

import type { WorkspaceContext } from "@/server/auth/session";

export type AuditEventRow = {
  id: string;
  createdAt: string;
  actorType: "user" | "system";
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  outcome: "success" | "failure" | "pending" | "info";
  summary: string;
};

export async function listAuditEvents(
  { supabase, workspace }: WorkspaceContext,
  { limit = 50 }: { limit?: number } = {},
): Promise<AuditEventRow[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, created_at, actor_type, event_type, entity_type, entity_id, outcome, summary")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load the activity timeline.");

  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorType: row.actor_type as AuditEventRow["actorType"],
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    outcome: row.outcome as AuditEventRow["outcome"],
    summary: row.summary,
  }));
}
