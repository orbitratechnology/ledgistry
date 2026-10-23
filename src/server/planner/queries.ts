import "server-only";

import { diffPlans, type PlanChange } from "@/lib/planner/diff";
import type { PlanResult } from "@/lib/planner/plan";
import { parseStoredPlan } from "@/lib/planner/serialize";
import type { WorkspaceContext } from "@/server/auth/session";
import { loadPlanInputs, planInputsHash } from "./inputs";

export type StoredPlan = {
  id: string;
  version: number;
  createdAt: string;
  reason: string;
  plan: PlanResult;
};

export type CurrencyPlanView = {
  currency: string;
  latest: StoredPlan | null;
  previousVersion: number | null;
  changes: PlanChange[];
  /** Records changed since the latest version was calculated (or no version exists yet). */
  stale: boolean;
};

async function latestPlans({ supabase, workspace }: WorkspaceContext, currency: string) {
  const { data, error } = await supabase
    .from("financial_plans")
    .select("id, plan_version, plan_results, plan_inputs_hash, recalc_reason, created_at")
    .eq("workspace_id", workspace.id)
    .eq("currency", currency)
    .order("plan_version", { ascending: false })
    .limit(2);
  if (error) throw new Error("Could not load the cash plan.");
  return data;
}

/** One stored plan by id, with what changed since its previous version. */
export async function getStoredPlan(
  { supabase, workspace }: WorkspaceContext,
  planId: string,
): Promise<(StoredPlan & { changes: PlanChange[] }) | null> {
  const { data } = await supabase
    .from("financial_plans")
    .select("id, plan_version, plan_results, recalc_reason, created_at, previous_plan_id")
    .eq("workspace_id", workspace.id)
    .eq("id", planId)
    .maybeSingle();
  const plan = data ? parseStoredPlan(data.plan_results) : null;
  if (!data || !plan) return null;

  let changes: PlanChange[] = [];
  if (data.previous_plan_id) {
    const { data: previous } = await supabase
      .from("financial_plans")
      .select("plan_results")
      .eq("id", data.previous_plan_id)
      .maybeSingle();
    const previousPlan = previous ? parseStoredPlan(previous.plan_results) : null;
    if (previousPlan) changes = diffPlans(previousPlan, plan);
  }
  return {
    id: data.id,
    version: data.plan_version,
    createdAt: data.created_at,
    reason: data.recalc_reason,
    plan,
    changes,
  };
}

/** The latest plan per planned currency, what changed since the version before, and staleness. */
export async function getPlanOverview(context: WorkspaceContext): Promise<CurrencyPlanView[]> {
  const inputs = await loadPlanInputs(context);
  return Promise.all(
    [...inputs].map(async ([currency, planInputs]) => {
      const rows = await latestPlans(context, currency);
      const [latestRow, previousRow] = rows;
      const latestPlan = latestRow ? parseStoredPlan(latestRow.plan_results) : null;
      const previousPlan = previousRow ? parseStoredPlan(previousRow.plan_results) : null;
      return {
        currency,
        latest:
          latestRow && latestPlan
            ? {
                id: latestRow.id,
                version: latestRow.plan_version,
                createdAt: latestRow.created_at,
                reason: latestRow.recalc_reason,
                plan: latestPlan,
              }
            : null,
        previousVersion: previousRow?.plan_version ?? null,
        changes: latestPlan && previousPlan ? diffPlans(previousPlan, latestPlan) : [],
        stale: !latestRow || latestRow.plan_inputs_hash !== planInputsHash(planInputs),
      };
    }),
  );
}
