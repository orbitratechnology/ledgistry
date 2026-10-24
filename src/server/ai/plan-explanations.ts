import "server-only";

import type { Json } from "@/lib/db/database.types";
import type { PlanChange } from "@/lib/planner/diff";
import type { PlanResult } from "@/lib/planner/plan";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { planExplanationSchema, type PlanExplanationContent } from "./schemas";
import { AI_FAILURE_MESSAGE, type AiFailureKind } from "./service";
import { explainPlan } from "./tasks";

export type PlanExplanationState =
  | { status: "ready"; content: PlanExplanationContent; modelId: string | null }
  | { status: "failed"; kind: AiFailureKind; message: string; attempts: number };

const isFailureKind = (value: string | null): value is AiFailureKind =>
  value !== null && value in AI_FAILURE_MESSAGE;

async function generateAndStore(
  context: WorkspaceContext,
  planId: string,
  version: number,
  plan: PlanResult,
  changes: PlanChange[],
  previousAttempts: number | null,
): Promise<PlanExplanationState> {
  const { supabase, workspace, user } = context;
  const result = await explainPlan(plan, version, changes);
  // AI switched off is configuration, not an outcome for this plan: never cached or audited, so
  // the plan is explained as soon as AI is configured again.
  if (!result.ok && result.kind === "disabled") {
    return { status: "failed", kind: result.kind, message: result.message, attempts: previousAttempts ?? 0 };
  }
  const attempts = (previousAttempts ?? 0) + 1;
  const row = result.ok
    ? { status: "ready", content: result.value as unknown as Json, failure_kind: null, model_id: result.modelId, attempts }
    : { status: "failed", content: null, failure_kind: result.kind, model_id: null, attempts };

  const write =
    previousAttempts === null
      ? await supabase.from("plan_explanations").insert({ ...row, plan_id: planId, workspace_id: workspace.id })
      : await supabase.from("plan_explanations").update(row).eq("plan_id", planId);
  // A concurrent render may have stored it first; that copy is equally valid.
  if (write.error && write.error.code !== "23505") console.warn("[ai] could not cache plan explanation");

  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: result.ok ? "ai.plan_explained" : "ai.plan_explanation_failed",
    entityType: "financial_plan",
    entityId: planId,
    outcome: result.ok ? "info" : "failure",
    summary: result.ok
      ? `Claude explained ${plan.currency} plan v${version}. Explanation only: amounts come from the planner.`
      : `No AI explanation for ${plan.currency} plan v${version}: ${result.message}`,
    metadata: { model_id: result.ok ? result.modelId : null, failure_kind: result.ok ? null : result.kind, attempts },
  });

  return result.ok
    ? { status: "ready", content: result.value, modelId: result.modelId }
    : { status: "failed", kind: result.kind, message: result.message, attempts };
}

/**
 * Read-through cache: plans are immutable, so one explanation per plan version is enough.
 * A failure is cached too (no automatic retries on every view); the operator can retry.
 */
export async function getPlanExplanation(
  context: WorkspaceContext,
  planId: string,
  version: number,
  plan: PlanResult,
  changes: PlanChange[],
): Promise<PlanExplanationState> {
  const { data } = await context.supabase
    .from("plan_explanations")
    .select("status, content, failure_kind, model_id, attempts")
    .eq("plan_id", planId)
    .maybeSingle();

  if (data?.status === "ready") {
    const parsed = planExplanationSchema.safeParse(data.content);
    if (parsed.success) return { status: "ready", content: parsed.data, modelId: data.model_id };
  }
  // Older rows may hold a cached "disabled" failure: regenerate those (cheap while AI is still off).
  if (data?.status === "failed" && data.failure_kind !== "disabled") {
    const kind = isFailureKind(data.failure_kind) ? data.failure_kind : "provider_error";
    return { status: "failed", kind, message: AI_FAILURE_MESSAGE[kind], attempts: data.attempts };
  }
  return generateAndStore(context, planId, version, plan, changes, data ? data.attempts : null);
}

/** Explicit retry from the UI after a cached failure. */
export async function retryPlanExplanation(
  context: WorkspaceContext,
  planId: string,
  version: number,
  plan: PlanResult,
  changes: PlanChange[],
): Promise<PlanExplanationState> {
  const { data } = await context.supabase
    .from("plan_explanations")
    .select("attempts")
    .eq("plan_id", planId)
    .maybeSingle();
  return generateAndStore(context, planId, version, plan, changes, data ? data.attempts : null);
}
