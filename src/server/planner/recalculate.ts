import "server-only";

import type { Json } from "@/lib/db/database.types";
import { formatMoney } from "@/lib/money";
import { buildPlan, PLANNER_RULE_VERSION, type PlanResult } from "@/lib/planner/plan";
import { serializePlan } from "@/lib/planner/serialize";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { loadPlanInputs, planInputsHash } from "./inputs";

/** Why a recalculation ran; stored with each plan version and its audit event. */
export type RecalcReason =
  | "manual"
  | "balance_refresh"
  | "transaction_sync"
  | "match_decision"
  | "obligation_change"
  | "receipt_change"
  | "reserve_change"
  | "payment_update";

export type RecalculateResult =
  | { ok: true; plans: { currency: string; planId: string; version: number; created: boolean }[] }
  | { ok: false; message: string };

/** Audit summary; the version number the database assigns is recorded in the event metadata. */
function planSummary(plan: PlanResult): string {
  const money = (minor: bigint) => formatMoney(minor, plan.currency, plan.exponent);
  if (plan.status === "no_balance") return `New ${plan.currency} plan: no available balance, nothing recommended.`;
  if (plan.status === "nothing_to_plan") return `New ${plan.currency} plan: no obligations to plan.`;
  const { summary } = plan;
  return [
    `New ${plan.currency} plan:`,
    `${summary.recommendedCount} recommended (${money(summary.recommendedTotalMinor)}),`,
    `${summary.deferredCount} deferred${summary.heldForDetailsMinor > 0n ? `, ${money(summary.heldForDetailsMinor)} held for missing payment details` : ""};`,
    `${money(summary.headroomAfterPlanMinor ?? 0n)} above the ${money(plan.reserveMinor)} reserve afterwards.`,
  ].join(" ");
}

/**
 * Rebuilds every currency's plan from current records and stores a new immutable version where
 * the inputs changed (identical inputs reuse the latest version). Never throws: callers are
 * other actions whose own outcome must not depend on planning.
 */
export async function recalculatePlans(context: WorkspaceContext, reason: RecalcReason): Promise<RecalculateResult> {
  const { supabase, workspace, user } = context;
  try {
    const inputs = await loadPlanInputs(context);
    const plans: { currency: string; planId: string; version: number; created: boolean }[] = [];
    for (const [currency, planInputs] of inputs) {
      const plan = buildPlan(planInputs);
      const { data, error } = await supabase.rpc("record_financial_plan", {
        p_workspace_id: workspace.id,
        p_currency: currency,
        p_balance_snapshot_id: planInputs.balance?.snapshotId ?? null,
        p_policy_snapshot: {
          reserve_minor: plan.reserveMinor.toString(),
          reserve_enabled: plan.reserveEnabled,
          reserve_configured: planInputs.reserve !== null,
          rule_version: PLANNER_RULE_VERSION,
          rules: [...plan.rules],
        },
        p_inputs_hash: planInputsHash(planInputs),
        p_results: serializePlan(plan) as Json,
        p_rule_version: PLANNER_RULE_VERSION,
        p_reason: reason,
        p_summary: planSummary(plan),
      });
      if (error || !data?.[0]) throw new Error(`Could not record the ${currency} plan (${error?.code ?? "no row"})`);
      plans.push({ currency, planId: data[0].plan_id, version: data[0].plan_version, created: data[0].created });
    }
    return { ok: true, plans };
  } catch (error) {
    console.error("[planner] recalculation failed", error instanceof Error ? error.message : error);
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "plan.recalculation_failed",
      outcome: "failure",
      summary: "The cash plan could not be recalculated. The previous plan version is still shown.",
      metadata: { reason },
    });
    return { ok: false, message: "The cash plan could not be recalculated. Try again." };
  }
}
