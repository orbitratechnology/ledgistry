"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { retryPlanExplanation } from "@/server/ai/plan-explanations";
import { requireWorkspace } from "@/server/auth/session";
import { refreshBalances } from "@/server/balances/sync";
import { getStoredPlan } from "@/server/planner/queries";
import { recalculatePlans } from "@/server/planner/recalculate";

export type RefreshBalancesActionResult =
  | { ok: true; message: string; warnings: string[] }
  | { ok: false; message: string };

/** Pulls current balances from Airwallex Sandbox into a new snapshot, then replans. Authorises itself. */
export async function refreshBalancesAction(): Promise<RefreshBalancesActionResult> {
  const context = await requireWorkspace();
  const result = await refreshBalances(context);
  const plan = result.ok ? await recalculatePlans(context, "balance_refresh") : null;
  refresh();

  if (!result.ok) return result;
  return {
    ok: true,
    message: `Balances refreshed from Airwallex: ${result.fundedCurrencyCount} funded of ${result.currencyCount} currencies.`,
    warnings: [
      ...result.issues.map((issue) => `${issue.currency}: ${issue.message}`),
      ...(plan && !plan.ok ? [plan.message] : []),
    ],
  };
}

/** Rebuilds the cash plan from the latest balance snapshot, reserves and obligations. */
export async function recalculatePlanAction(): Promise<{ ok: boolean; message: string }> {
  const context = await requireWorkspace();
  const result = await recalculatePlans(context, "manual");
  refresh();
  if (!result.ok) return result;
  const created = result.plans.filter((plan) => plan.created);
  if (result.plans.length === 0) {
    return { ok: true, message: "Nothing to plan yet: add an obligation or a reserve first." };
  }
  return {
    ok: true,
    message:
      created.length === 0
        ? "Nothing changed since the last plan, so its version still stands."
        : `New plan version for ${created.map((plan) => `${plan.currency} (v${plan.version})`).join(", ")}.`,
  };
}

/** Asks Claude again to explain a stored plan after an earlier attempt failed. */
export async function retryPlanExplanationAction(planId: string): Promise<{ ok: boolean; message: string }> {
  const context = await requireWorkspace();
  if (!z.uuid().safeParse(planId).success) return { ok: false, message: "Plan not found." };
  const stored = await getStoredPlan(context, planId);
  if (!stored) return { ok: false, message: "Plan not found." };
  const result = await retryPlanExplanation(context, stored.id, stored.version, stored.plan, stored.changes);
  refresh();
  return result.status === "ready"
    ? { ok: true, message: "Explanation ready." }
    : { ok: false, message: `${result.message} The plan itself is unaffected.` };
}
