import "server-only";

import { createHash } from "node:crypto";

import { todayIso, type ObligationPriority, type ObligationStatus } from "@/lib/finance/states";
import { currencyExponent, parseMinor } from "@/lib/money";
import { canonicalPlanInputs, type PlanInputs } from "@/lib/planner/plan";
import type { WorkspaceContext } from "@/server/auth/session";
import { getBalanceOverview } from "@/server/balances/queries";

export type ReservePolicyView = {
  id: string;
  currency: string;
  exponent: number;
  amountMinor: bigint;
  enabled: boolean;
  updatedAt: string;
};

export async function listReservePolicies({ supabase, workspace }: WorkspaceContext): Promise<ReservePolicyView[]> {
  const { data, error } = await supabase
    .from("reserve_policies")
    .select("id, currency, enabled, updated_at, amount:reserve_amount_minor::text")
    .eq("workspace_id", workspace.id)
    .order("currency");
  if (error) throw new Error("Could not load reserve policies.");
  return data.map((row) => ({
    id: row.id,
    currency: row.currency,
    exponent: currencyExponent(row.currency),
    amountMinor: parseMinor(row.amount) ?? 0n,
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }));
}

/**
 * Everything the planner needs, grouped by currency. A currency is planned when it has a live
 * obligation or a reserve policy; balances alone do not create a plan.
 */
export async function loadPlanInputs(context: WorkspaceContext, today = todayIso()): Promise<Map<string, PlanInputs>> {
  const { supabase, workspace } = context;
  const [balances, reserves, obligations, receipts] = await Promise.all([
    getBalanceOverview(context),
    listReservePolicies(context),
    supabase
      .from("obligations")
      .select(
        "id, payee_name, description, invoice_reference, currency, due_date, priority, status, beneficiary_id, beneficiary_label, allow_partial_payment, version, is_demo, amount:amount_minor::text",
      )
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .not("status", "in", "(paid,cancelled)"),
    supabase
      .from("expected_receipt_progress")
      .select("id, payer_name, reference, currency, expected_date, is_demo, outstanding:outstanding_amount_minor::text")
      .eq("workspace_id", workspace.id)
      .is("cancelled_at", null)
      .is("archived_at", null),
  ]);
  if (obligations.error || receipts.error) throw new Error("Could not load planning inputs.");

  const currencies = new Set<string>([
    ...obligations.data.map((row) => row.currency),
    ...reserves.map((policy) => policy.currency),
  ]);

  const plans = new Map<string, PlanInputs>();
  for (const currency of [...currencies].sort()) {
    const snapshot = balances.latest?.balances.find((balance) => balance.currency === currency) ?? null;
    const reserve = reserves.find((policy) => policy.currency === currency) ?? null;
    plans.set(currency, {
      currency,
      exponent: currencyExponent(currency),
      today,
      balance: snapshot
        ? { snapshotId: snapshot.id, availableMinor: snapshot.availableMinor, fetchedAt: balances.latest!.fetchedAt }
        : null,
      reserve: reserve ? { amountMinor: reserve.amountMinor, enabled: reserve.enabled } : null,
      obligations: obligations.data
        .filter((row) => row.currency === currency)
        .map((row) => ({
          id: row.id,
          payeeName: row.payee_name,
          description: row.description,
          invoiceReference: row.invoice_reference,
          amountMinor: parseMinor(row.amount) ?? 0n,
          dueDate: row.due_date,
          priority: row.priority as ObligationPriority,
          status: row.status as ObligationStatus,
          hasPaymentDetails: Boolean(row.beneficiary_id),
          beneficiaryLabel: row.beneficiary_label,
          allowPartialPayment: row.allow_partial_payment,
          version: row.version,
          isDemo: row.is_demo,
        })),
      receipts: receipts.data
        .filter((row) => row.currency === currency)
        .map((row) => ({
          id: row.id!,
          payerName: row.payer_name!,
          reference: row.reference!,
          outstandingMinor: parseMinor(row.outstanding) ?? 0n,
          expectedDate: row.expected_date!,
          isDemo: row.is_demo ?? false,
        })),
    });
  }
  return plans;
}

export function planInputsHash(inputs: PlanInputs): string {
  return createHash("sha256").update(canonicalPlanInputs(inputs)).digest("hex");
}
