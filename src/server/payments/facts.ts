import "server-only";

import { createHash } from "node:crypto";

import type { ObligationPriority, ObligationStatus } from "@/lib/finance/states";
import { getAirwallexConfig, readServerEnv } from "@/lib/env";
import { currencyExponent, formatMoney, parseMinor } from "@/lib/money";
import {
  canonicalPaymentIntent,
  evaluatePaymentGate,
  transferReference,
  type GateBlocker,
  type PaymentIntent,
} from "@/lib/payments/approval";
import { ACTIVE_PAYMENT_STATUSES } from "@/lib/payments/status";
import { buildPlan, type PlanItem } from "@/lib/planner/plan";
import type { WorkspaceContext } from "@/server/auth/session";
import { listBeneficiaries, type BeneficiarySummary } from "@/server/airwallex/beneficiaries";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";
import { TRANSFER_REASON } from "@/server/airwallex/transfers";
import { refreshBalances } from "@/server/balances/sync";
import { loadPlanInputs } from "@/server/planner/inputs";
import { recalculatePlans } from "@/server/planner/recalculate";

export type PayableObligation = {
  id: string;
  payeeName: string;
  description: string;
  invoiceReference: string | null;
  amountMinor: bigint;
  currency: string;
  exponent: number;
  dueDate: string;
  priority: ObligationPriority;
  status: ObligationStatus;
  beneficiaryId: string | null;
  beneficiaryLabel: string | null;
  version: number;
  archived: boolean;
};

/** Operator-facing review of one payment: every value shown is computed server-side. */
export type PaymentReview = {
  obligationId: string;
  payee: string;
  description: string;
  invoiceReference: string | null;
  dueDate: string;
  priority: ObligationPriority;
  amount: string;
  currency: string;
  beneficiary: { label: string; currency: string | null; country: string | null; transferMethod: string | null } | null;
  source: string;
  reference: string;
  reason: string;
  fees: string;
  availableNow: string | null;
  balanceFetchedAt: string | null;
  reserve: string;
  reserveProtected: boolean;
  availableAfter: string | null;
  headroomAfter: string | null;
  planVersion: number | null;
  whyRecommended: string | null;
  sandbox: boolean;
};

export type PaymentFacts = {
  obligation: PayableObligation;
  beneficiary: BeneficiarySummary | null;
  intent: PaymentIntent | null;
  fingerprint: string | null;
  blockers: GateBlocker[];
  planId: string | null;
  balanceSnapshotId: string | null;
  review: PaymentReview;
};

const REASON_LABEL: Record<string, string> = { business_expenses: "Business expenses" };

export async function loadPayableObligation(
  { supabase, workspace }: WorkspaceContext,
  obligationId: string,
): Promise<PayableObligation | null> {
  const { data } = await supabase
    .from("obligations")
    .select(
      "id, payee_name, description, invoice_reference, currency, due_date, priority, status, beneficiary_id, beneficiary_label, version, archived_at, amount:amount_minor::text",
    )
    .eq("workspace_id", workspace.id)
    .eq("id", obligationId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    payeeName: data.payee_name,
    description: data.description,
    invoiceReference: data.invoice_reference,
    amountMinor: parseMinor(data.amount) ?? 0n,
    currency: data.currency,
    exponent: currencyExponent(data.currency),
    dueDate: data.due_date,
    priority: data.priority as ObligationPriority,
    status: data.status as ObligationStatus,
    beneficiaryId: data.beneficiary_id,
    beneficiaryLabel: data.beneficiary_label,
    version: data.version,
    archived: data.archived_at !== null,
  };
}

/** True only for the exact sandbox host with sandbox-only mode on (PRD §8.7 environment guard). */
export function sandboxTransfersAllowed(): boolean {
  const config = getAirwallexConfig();
  return config.ok && config.environment === "sandbox" && readServerEnv().AIRWALLEX_SANDBOX_ONLY;
}

export const fingerprintOf = (intent: PaymentIntent) =>
  createHash("sha256").update(canonicalPaymentIntent(intent)).digest("hex");

/**
 * Re-reads everything a payment decision depends on: a live Airwallex balance, the beneficiary,
 * the reserve and a plan rebuilt from them. Used both to open a review and again right before
 * sending, so an approval can never rest on stale facts.
 */
export async function gatherPaymentFacts(context: WorkspaceContext, obligation: PayableObligation): Promise<PaymentFacts> {
  const money = (minor: bigint) => formatMoney(minor, obligation.currency, obligation.exponent);
  const extraBlockers: GateBlocker[] = [];

  const refreshed = await refreshBalances(context);
  if (!refreshed.ok) extraBlockers.push({ code: "balance_refresh", message: `Balances could not be refreshed: ${refreshed.message}` });
  const replanned = await recalculatePlans(context, "balance_refresh");
  const planRef = replanned.ok ? replanned.plans.find((plan) => plan.currency === obligation.currency) : undefined;

  const inputs = (await loadPlanInputs(context)).get(obligation.currency);
  const plan = inputs ? buildPlan(inputs) : null;
  const item: PlanItem | undefined = plan?.items.find((candidate) => candidate.obligationId === obligation.id);
  const reserveMinor = plan?.reserveMinor ?? 0n;

  let beneficiary: BeneficiarySummary | null = null;
  if (obligation.beneficiaryId) {
    try {
      beneficiary = (await listBeneficiaries(getAirwallexClient())).find((item) => item.id === obligation.beneficiaryId) ?? null;
    } catch (error) {
      extraBlockers.push({
        code: "beneficiary_check",
        message: `Could not check the beneficiary with Airwallex: ${error instanceof AirwallexError ? error.safeMessage : "unexpected error"}`,
      });
    }
  }

  const { count: active } = await context.supabase
    .from("payment_operations")
    .select("id", { count: "exact", head: true })
    .eq("obligation_id", obligation.id)
    .in("status", [...ACTIVE_PAYMENT_STATUSES]);

  const sandbox = sandboxTransfersAllowed();
  const blockers = [
    ...extraBlockers,
    ...evaluatePaymentGate({
      sandbox,
      obligation: {
        status: obligation.status,
        archived: obligation.archived,
        amountMinor: obligation.amountMinor,
        currency: obligation.currency,
        exponent: obligation.exponent,
        hasActiveOperation: (active ?? 0) > 0,
      },
      beneficiary: beneficiary
        ? { state: "found", currency: beneficiary.currency, transferMethods: beneficiary.transferMethods }
        : { state: obligation.beneficiaryId ? "not_found" : "none" },
      balance: inputs?.balance ? { availableMinor: inputs.balance.availableMinor, fetchedAt: inputs.balance.fetchedAt } : null,
      reserveMinor,
      planDecision: item?.decision ?? null,
      planReason: item?.reason ?? null,
      now: new Date(),
    }),
  ];

  const transferMethod = beneficiary?.transferMethods[0] ?? null;
  const reference = transferReference(obligation.invoiceReference, obligation.description);
  const intent: PaymentIntent | null =
    obligation.beneficiaryId && transferMethod
      ? {
          workspaceId: context.workspace.id,
          obligationId: obligation.id,
          obligationVersion: obligation.version,
          payeeName: obligation.payeeName,
          amountMinor: obligation.amountMinor,
          currency: obligation.currency,
          beneficiaryId: obligation.beneficiaryId,
          transferMethod,
          reference,
          reserveMinor,
          reserveEnabled: plan?.reserveEnabled ?? false,
        }
      : null;

  const available = inputs?.balance?.availableMinor ?? null;
  const after = available === null ? null : available - obligation.amountMinor;
  return {
    obligation,
    beneficiary,
    intent,
    fingerprint: intent ? fingerprintOf(intent) : null,
    blockers,
    planId: planRef?.planId ?? null,
    balanceSnapshotId: inputs?.balance?.snapshotId ?? null,
    review: {
      obligationId: obligation.id,
      payee: obligation.payeeName,
      description: obligation.description,
      invoiceReference: obligation.invoiceReference,
      dueDate: obligation.dueDate,
      priority: obligation.priority,
      amount: money(obligation.amountMinor),
      currency: obligation.currency,
      beneficiary: beneficiary
        ? { label: beneficiary.label, currency: beneficiary.currency, country: beneficiary.country, transferMethod }
        : obligation.beneficiaryLabel
          ? { label: obligation.beneficiaryLabel, currency: null, country: null, transferMethod: null }
          : null,
      source: `Airwallex wallet, ${obligation.currency} balance (no currency conversion)`,
      reference,
      reason: REASON_LABEL[TRANSFER_REASON] ?? TRANSFER_REASON,
      fees: "Shown by Airwallex once the transfer is created; paid by you.",
      availableNow: available === null ? null : money(available),
      balanceFetchedAt: inputs?.balance?.fetchedAt ?? null,
      reserve: money(reserveMinor),
      reserveProtected: plan?.reserveEnabled ?? false,
      availableAfter: after === null ? null : money(after),
      headroomAfter: after === null ? null : money(after - reserveMinor),
      planVersion: planRef?.version ?? null,
      whyRecommended: item?.decision === "recommended" ? item.reason : null,
      sandbox,
    },
  };
}
