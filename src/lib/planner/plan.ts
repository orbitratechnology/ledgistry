/**
 * Deterministic cash planner (PRD §8.6). Pure: the same inputs always produce the same plan.
 * It only recommends; approval and execution are separate, human-gated steps. AI may explain
 * a plan but never computes or overrides anything here.
 */

import { formatMoney } from "@/lib/money";
import type { ObligationPriority, ObligationStatus } from "@/lib/finance/states";

/** Bump when ranking or decision rules change: it is part of every plan's inputs hash. */
export const PLANNER_RULE_VERSION = "ledgistry-planner-v1";
export const FORECAST_HORIZON_DAYS = 30;

/** The exact rule ordering, shown in the UI and stored with every plan. */
export const RANKING_RULES = [
  "Your priority: critical first, then high, normal and low.",
  "Due date: overdue and earliest-due obligations first.",
  "Fit above the reserve: an obligation is recommended only if its full amount fits in the cash above your reserve that is left after higher-ranked payments. One that does not fit is deferred; lower-ranked ones that fit can still be recommended.",
  "Payment details: an obligation without a beneficiary keeps its place and its cash is held for it, but it is not recommended until details are added.",
  "Ties keep a stable order: smaller amount first, then payee name.",
] as const;

const PRIORITY_RANK: Record<ObligationPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Statuses the planner allocates cash to. Drafts, your deferrals and payments already in flight are listed, not planned. */
const PLANNABLE_STATUSES: readonly ObligationStatus[] = ["planned", "approval_required", "failed"];
const EXCLUSION_REASON: Partial<Record<ObligationStatus, string>> = {
  draft: "Still a draft: mark it as planned to include it.",
  deferred: "Deferred by you.",
  in_progress: "A payment is already in progress, so it is not planned again.",
};

export type PlanObligation = {
  id: string;
  payeeName: string;
  description: string | null;
  invoiceReference: string | null;
  amountMinor: bigint;
  dueDate: string;
  priority: ObligationPriority;
  status: ObligationStatus;
  hasPaymentDetails: boolean;
  beneficiaryLabel: string | null;
  allowPartialPayment: boolean;
  version: number;
  isDemo: boolean;
};

export type PlanReceipt = {
  id: string;
  payerName: string;
  reference: string;
  outstandingMinor: bigint;
  expectedDate: string;
  isDemo: boolean;
};

export type PlanInputs = {
  currency: string;
  exponent: number;
  /** Workspace date (YYYY-MM-DD) used for due/overdue status. */
  today: string;
  /** Latest Airwallex balance snapshot for the currency; `availableMinor` null when the provider omitted it. */
  balance: { snapshotId: string; availableMinor: bigint | null; fetchedAt: string } | null;
  reserve: { amountMinor: bigint; enabled: boolean } | null;
  obligations: PlanObligation[];
  receipts: PlanReceipt[];
};

export type PlanDecision = "recommended" | "needs_details" | "deferred" | "blocked";
export type PlanReasonCode =
  | "fits_above_reserve"
  | "missing_payment_details"
  | "exceeds_headroom"
  | "below_reserve_already"
  | "no_balance";

export type PlanItem = {
  rank: number;
  obligationId: string;
  obligationVersion: number;
  payeeName: string;
  description: string | null;
  invoiceReference: string | null;
  amountMinor: bigint;
  dueDate: string;
  daysUntilDue: number;
  overdue: boolean;
  priority: ObligationPriority;
  hasPaymentDetails: boolean;
  beneficiaryLabel: string | null;
  isDemo: boolean;
  decision: PlanDecision;
  reasonCode: PlanReasonCode;
  reason: string;
  /** Actual available cash before this item, after the higher-ranked allocations. */
  availableBeforeMinor: bigint | null;
  /** Projected available cash if this item were paid now. */
  availableAfterMinor: bigint | null;
  /** `availableAfterMinor - reserve`: negative means the reserve would be breached. */
  headroomAfterMinor: bigint | null;
};

export type ExcludedObligation = {
  obligationId: string;
  payeeName: string;
  amountMinor: bigint;
  dueDate: string;
  status: ObligationStatus;
  reason: string;
  isDemo: boolean;
};

export type ForecastOutcome = {
  obligationId: string;
  fits: boolean;
  availableAfterMinor: bigint;
};

export type PlanForecast = {
  horizonDays: number;
  receipts: (PlanReceipt & { overdue: boolean })[];
  totalMinor: bigint;
  /** For deferred items only: would they fit if every listed receipt arrived in full? */
  outcomes: ForecastOutcome[];
};

export type PlanWarning = {
  code: "no_reserve" | "reserve_disabled" | "below_reserve" | "no_balance" | "partial_not_planned";
  message: string;
};

export type PlanResult = {
  ruleVersion: string;
  currency: string;
  exponent: number;
  today: string;
  status: "ok" | "no_balance" | "nothing_to_plan";
  balance: PlanInputs["balance"];
  reserveMinor: bigint;
  reserveEnabled: boolean;
  summary: {
    availableMinor: bigint | null;
    spendableNowMinor: bigint;
    recommendedCount: number;
    recommendedTotalMinor: bigint;
    heldForDetailsMinor: bigint;
    deferredCount: number;
    deferredTotalMinor: bigint;
    /** Available cash after every recommended and held allocation. */
    availableAfterPlanMinor: bigint | null;
    headroomAfterPlanMinor: bigint | null;
  };
  items: PlanItem[];
  excluded: ExcludedObligation[];
  forecast: PlanForecast | null;
  warnings: PlanWarning[];
  limitations: string[];
  rules: readonly string[];
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function compareObligations(a: PlanObligation, b: PlanObligation): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.dueDate.localeCompare(b.dueDate) ||
    (a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0) ||
    a.payeeName.localeCompare(b.payeeName) ||
    a.id.localeCompare(b.id)
  );
}

/** Ranks obligations and allocates actual available cash above the reserve. */
export function buildPlan(inputs: PlanInputs): PlanResult {
  const { currency, exponent, today } = inputs;
  const money = (minor: bigint) => formatMoney(minor, currency, exponent);
  const reserveEnabled = inputs.reserve?.enabled ?? false;
  const reserveMinor = reserveEnabled ? (inputs.reserve?.amountMinor ?? 0n) : 0n;
  const available = inputs.balance?.availableMinor ?? null;

  const inCurrency = inputs.obligations.filter((obligation) => obligation.amountMinor > 0n);
  const plannable = inCurrency.filter((obligation) => PLANNABLE_STATUSES.includes(obligation.status));
  const excluded: ExcludedObligation[] = inCurrency
    .filter((obligation) => EXCLUSION_REASON[obligation.status])
    .sort(compareObligations)
    .map((obligation) => ({
      obligationId: obligation.id,
      payeeName: obligation.payeeName,
      amountMinor: obligation.amountMinor,
      dueDate: obligation.dueDate,
      status: obligation.status,
      reason: EXCLUSION_REASON[obligation.status]!,
      isDemo: obligation.isDemo,
    }));

  const warnings: PlanWarning[] = [];
  if (!inputs.reserve) {
    warnings.push({ code: "no_reserve", message: `No ${currency} reserve is set, so none is protected. Set one in Settings.` });
  } else if (!inputs.reserve.enabled) {
    warnings.push({ code: "reserve_disabled", message: `Your ${currency} reserve is switched off, so none is protected.` });
  }
  if (available === null) {
    warnings.push({
      code: "no_balance",
      message: `No available ${currency} balance from Airwallex. Refresh balances; nothing is recommended without actual cash data.`,
    });
  } else if (available < reserveMinor) {
    warnings.push({
      code: "below_reserve",
      message: `Available cash (${money(available)}) is already below your ${money(reserveMinor)} reserve.`,
    });
  }
  if (plannable.some((obligation) => obligation.allowPartialPayment)) {
    warnings.push({
      code: "partial_not_planned",
      message: "Partial payments are not planned: obligations are recommended for their full amount only.",
    });
  }

  const spendableNow = available === null ? 0n : available > reserveMinor ? available - reserveMinor : 0n;
  let committed = 0n;

  const items: PlanItem[] = [...plannable].sort(compareObligations).map((obligation, index) => {
    const daysUntilDue = daysBetween(today, obligation.dueDate);
    const base = {
      rank: index + 1,
      obligationId: obligation.id,
      obligationVersion: obligation.version,
      payeeName: obligation.payeeName,
      description: obligation.description,
      invoiceReference: obligation.invoiceReference,
      amountMinor: obligation.amountMinor,
      dueDate: obligation.dueDate,
      daysUntilDue,
      overdue: daysUntilDue < 0,
      priority: obligation.priority,
      hasPaymentDetails: obligation.hasPaymentDetails,
      beneficiaryLabel: obligation.beneficiaryLabel,
      isDemo: obligation.isDemo,
    };

    if (available === null) {
      return {
        ...base,
        decision: "blocked",
        reasonCode: "no_balance",
        reason: `No available ${currency} balance from Airwallex, so this cannot be planned yet.`,
        availableBeforeMinor: null,
        availableAfterMinor: null,
        headroomAfterMinor: null,
      };
    }

    // Known payer-side fees are not available before a transfer quote (Phase 4); counted as zero.
    const cost = obligation.amountMinor;
    const before = available - committed;
    const after = before - cost;
    const headroomAfter = after - reserveMinor;
    const position = { availableBeforeMinor: before, availableAfterMinor: after, headroomAfterMinor: headroomAfter };

    if (headroomAfter >= 0n) {
      committed += cost;
      const fits =
        reserveMinor > 0n
          ? `Fits above your ${money(reserveMinor)} reserve`
          : "Fits within available cash (no reserve is protected)";
      if (!obligation.hasPaymentDetails) {
        return {
          ...base,
          ...position,
          decision: "needs_details",
          reasonCode: "missing_payment_details",
          reason: `${fits}, but no beneficiary is linked. ${money(cost)} is held for it until payment details are added.`,
        };
      }
      return {
        ...base,
        ...position,
        decision: "recommended",
        reasonCode: "fits_above_reserve",
        reason:
          reserveMinor > 0n
            ? `Paying this leaves ${money(after)} available, ${money(headroomAfter)} above your ${money(reserveMinor)} reserve.`
            : `Paying this leaves ${money(after)} available. No reserve is protected in ${currency}.`,
      };
    }

    if (available <= reserveMinor) {
      return {
        ...base,
        ...position,
        decision: "deferred",
        reasonCode: "below_reserve_already",
        reason: `Available cash (${money(available)}) is already at or below your ${money(reserveMinor)} reserve, so paying this would breach it.`,
      };
    }

    const afterHigherRanked = committed > 0n ? " after the higher-ranked payments above" : "";
    return {
      ...base,
      ...position,
      decision: "deferred",
      reasonCode: "exceeds_headroom",
      reason:
        reserveMinor > 0n
          ? `Paying this${afterHigherRanked} would reduce projected available cash to ${money(after)}, below your ${money(reserveMinor)} reserve.`
          : `Paying this${afterHigherRanked} needs ${money(-after)} more than the cash available.`,
    };
  });

  const recommended = items.filter((item) => item.decision === "recommended");
  const deferred = items.filter((item) => item.decision === "deferred");
  const held = items.filter((item) => item.decision === "needs_details");
  const sum = (list: PlanItem[]) => list.reduce((total, item) => total + item.amountMinor, 0n);

  // Forecast scenario: kept separate from spendable-now and labelled as such in every view.
  let forecast: PlanForecast | null = null;
  if (available !== null) {
    const receipts = inputs.receipts
      .filter((receipt) => receipt.outstandingMinor > 0n && daysBetween(today, receipt.expectedDate) <= FORECAST_HORIZON_DAYS)
      .map((receipt) => ({ ...receipt, overdue: daysBetween(today, receipt.expectedDate) < 0 }))
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.id.localeCompare(b.id));
    const totalMinor = receipts.reduce((total, receipt) => total + receipt.outstandingMinor, 0n);
    let forecastAvailable = available - committed + totalMinor;
    const outcomes = deferred.map((item) => {
      const after = forecastAvailable - item.amountMinor;
      const fits = after >= reserveMinor;
      if (fits) forecastAvailable = after;
      return { obligationId: item.obligationId, fits, availableAfterMinor: after };
    });
    forecast = { horizonDays: FORECAST_HORIZON_DAYS, receipts, totalMinor, outcomes };
  }

  const limitations = [
    "Expected receipts are never counted as spendable cash; they appear only in the separate forecast.",
    "Payer-side transfer fees are not known until a transfer is quoted, so they are counted as zero here and rechecked before any payment is sent.",
    "Currencies are planned separately; no FX conversion is assumed.",
  ];

  return {
    ruleVersion: PLANNER_RULE_VERSION,
    currency,
    exponent,
    today,
    status: available === null ? "no_balance" : items.length === 0 ? "nothing_to_plan" : "ok",
    balance: inputs.balance,
    reserveMinor,
    reserveEnabled,
    summary: {
      availableMinor: available,
      spendableNowMinor: spendableNow,
      recommendedCount: recommended.length,
      recommendedTotalMinor: sum(recommended),
      heldForDetailsMinor: sum(held),
      deferredCount: deferred.length,
      deferredTotalMinor: sum(deferred),
      availableAfterPlanMinor: available === null ? null : available - committed,
      headroomAfterPlanMinor: available === null ? null : available - committed - reserveMinor,
    },
    items,
    excluded,
    forecast,
    warnings,
    limitations,
    rules: RANKING_RULES,
  };
}

/**
 * Canonical, order-independent serialisation of everything a plan depends on. Equal strings
 * mean an equal plan, so a recalculation with unchanged inputs reuses the existing version.
 */
export function canonicalPlanInputs(inputs: PlanInputs): string {
  return JSON.stringify([
    PLANNER_RULE_VERSION,
    inputs.currency,
    inputs.today,
    inputs.balance ? [inputs.balance.snapshotId, inputs.balance.availableMinor?.toString() ?? null] : null,
    inputs.reserve ? [inputs.reserve.amountMinor.toString(), inputs.reserve.enabled] : null,
    [...inputs.obligations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => [o.id, o.version, o.amountMinor.toString(), o.dueDate, o.priority, o.status, o.hasPaymentDetails, o.allowPartialPayment, o.payeeName, o.isDemo]),
    [...inputs.receipts]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => [r.id, r.outstandingMinor.toString(), r.expectedDate, r.payerName, r.reference, r.isDemo]),
  ]);
}
