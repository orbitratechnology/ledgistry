/**
 * Payment approval rules (PRD §8.7). Pure: the server recomputes everything from fresh records
 * before sending; nothing here trusts client state, model output or an earlier approval.
 */

import { formatMoney } from "@/lib/money";
import type { ObligationStatus } from "@/lib/finance/states";
import type { PlanDecision } from "@/lib/planner/plan";

export const APPROVAL_RULE_VERSION = "ledgistry-approval-v1";
/** A review must be approved within this window, then it expires. */
export const APPROVAL_TTL_MINUTES = 10;
/** The balance used for a decision must be at most this old (it is re-read live before sending). */
export const BALANCE_MAX_AGE_MINUTES = 5;

/** Every material parameter of a transfer and the policy it was checked against. */
export type PaymentIntent = {
  workspaceId: string;
  obligationId: string;
  obligationVersion: number;
  payeeName: string;
  amountMinor: bigint;
  currency: string;
  beneficiaryId: string;
  transferMethod: string;
  reference: string;
  reserveMinor: bigint;
  reserveEnabled: boolean;
};

/**
 * Canonical serialisation bound into the approval fingerprint. Any change to an amount, payee,
 * beneficiary, currency, reference, method, obligation version or reserve yields a different
 * fingerprint, so an approval of the old values can no longer be used.
 */
export function canonicalPaymentIntent(intent: PaymentIntent): string {
  return JSON.stringify([
    APPROVAL_RULE_VERSION,
    intent.workspaceId,
    intent.obligationId,
    intent.obligationVersion,
    intent.payeeName,
    intent.amountMinor.toString(),
    intent.currency,
    intent.beneficiaryId,
    intent.transferMethod,
    intent.reference,
    intent.reserveMinor.toString(),
    intent.reserveEnabled,
  ]);
}

/** Reference sent to Airwallex: the invoice reference when there is one, else a short description. */
export function transferReference(invoiceReference: string | null, description: string): string {
  const source = (invoiceReference?.trim() || description.trim()).replace(/[^A-Za-z0-9 .,/-]/g, " ");
  return source.replace(/\s+/g, " ").trim().slice(0, 35) || "Ledgistry payment";
}

export type GateFacts = {
  sandbox: boolean;
  obligation: {
    status: ObligationStatus;
    archived: boolean;
    amountMinor: bigint;
    currency: string;
    exponent: number;
    hasActiveOperation: boolean;
  };
  beneficiary:
    | { state: "none" }
    | { state: "not_found" }
    | { state: "found"; currency: string | null; transferMethods: string[] };
  balance: { availableMinor: bigint | null; fetchedAt: string } | null;
  reserveMinor: bigint;
  /** The obligation's decision in a plan built from the same fresh balance. */
  planDecision: PlanDecision | null;
  planReason: string | null;
  now: Date;
};

export type GateBlocker = { code: string; message: string };

const PAYABLE_STATUSES: readonly ObligationStatus[] = ["planned", "approval_required", "failed"];

/** Every reason this payment may not be approved or sent right now. Empty means it may. */
export function evaluatePaymentGate(facts: GateFacts): GateBlocker[] {
  const { obligation } = facts;
  const money = (minor: bigint) => formatMoney(minor, obligation.currency, obligation.exponent);
  const blockers: GateBlocker[] = [];

  if (!facts.sandbox) {
    blockers.push({ code: "not_sandbox", message: "Transfers are only sent to Airwallex Sandbox in this MVP." });
  }
  if (obligation.archived) {
    blockers.push({ code: "archived", message: "This obligation is archived." });
  } else if (!PAYABLE_STATUSES.includes(obligation.status)) {
    blockers.push({
      code: "status",
      message: `Only planned obligations can be paid; this one is ${obligation.status.replace("_", " ")}.`,
    });
  }
  if (obligation.hasActiveOperation) {
    blockers.push({ code: "in_flight", message: "A payment for this obligation is already in progress." });
  }
  if (obligation.amountMinor <= 0n) {
    blockers.push({ code: "amount", message: "The amount must be greater than zero." });
  }

  if (facts.beneficiary.state === "none") {
    blockers.push({ code: "no_beneficiary", message: "Link an Airwallex beneficiary before paying." });
  } else if (facts.beneficiary.state === "not_found") {
    blockers.push({ code: "beneficiary_not_found", message: "The linked beneficiary was not found in Airwallex." });
  } else {
    if (facts.beneficiary.currency !== obligation.currency) {
      blockers.push({
        code: "beneficiary_currency",
        message: `The beneficiary receives ${facts.beneficiary.currency ?? "an unknown currency"}, but the obligation is in ${obligation.currency}. No FX conversion is assumed.`,
      });
    }
    if (facts.beneficiary.transferMethods.length === 0) {
      blockers.push({ code: "transfer_method", message: "The beneficiary has no supported transfer method." });
    }
  }

  const available = facts.balance?.availableMinor ?? null;
  if (!facts.balance || available === null) {
    blockers.push({ code: "no_balance", message: `No current ${obligation.currency} balance from Airwallex.` });
  } else {
    const ageMinutes = (facts.now.getTime() - Date.parse(facts.balance.fetchedAt)) / 60_000;
    if (ageMinutes > BALANCE_MAX_AGE_MINUTES) {
      blockers.push({ code: "stale_balance", message: "The balance is out of date. Refresh it before paying." });
    }
    const after = available - obligation.amountMinor;
    if (after < facts.reserveMinor) {
      blockers.push({
        code: "reserve",
        message: `Paying ${money(obligation.amountMinor)} would leave ${money(after)}, below your ${money(facts.reserveMinor)} reserve.`,
      });
    }
  }

  if (facts.planDecision !== "recommended" && !blockers.some((blocker) => blocker.code === "reserve")) {
    blockers.push({
      code: "not_recommended",
      message: facts.planReason ?? "The current plan does not recommend paying this now.",
    });
  }
  return blockers;
}
