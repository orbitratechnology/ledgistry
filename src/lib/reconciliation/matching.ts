/**
 * Deterministic reconciliation rules (PRD §8.5). Produces *suggestions* only: nothing here
 * confirms a match, moves money or changes balances. Ambiguity is surfaced as needs-review.
 */

import { formatMoney } from "@/lib/money";
import { containsReference, nameSimilarity, normalizeReference } from "./text";

export type MatchableTransaction = {
  id: string;
  currency: string;
  exponent: number;
  amountMinor: bigint;
  unappliedMinor: bigint;
  providerStatus: string;
  reference: string | null;
  statementReference: string | null;
  counterpartyName: string | null;
  /** ISO timestamp. */
  occurredAt: string | null;
};

export type MatchableReceipt = {
  id: string;
  currency: string;
  exponent: number;
  outstandingMinor: bigint;
  reference: string;
  payerName: string;
  /** ISO date (YYYY-MM-DD). */
  expectedDate: string;
};

export type MatchSignal =
  | "reference_match"
  | "currency_match"
  | "amount_match"
  | "partial_amount"
  | "over_amount"
  | "payer_similarity"
  | "date_proximity";

export type MatchType = "exact_reference" | "exact_amount" | "partial_amount" | "suggested";

export type Discrepancy =
  | { kind: "none" }
  | { kind: "shortfall"; amountMinor: bigint }
  | { kind: "excess"; amountMinor: bigint };

export type MatchProposal = {
  transactionId: string;
  expectedReceiptId: string;
  matchType: MatchType;
  status: "suggested" | "needs_review";
  confidence: number;
  signals: MatchSignal[];
  discrepancy: Discrepancy;
  reviewReasons: string[];
  explanation: string;
};

export const DATE_WINDOW_DAYS = 7;
const AMBIGUITY_MARGIN = 0.1;
const MIN_SCORE = 0.35;

const WEIGHTS = {
  reference_match: 0.5,
  amount_match: 0.25,
  partial_amount: 0.1,
  over_amount: 0.05,
  payer_similarity: 0.15,
  date_proximity: 0.1,
} as const;

export const pairKey = (transactionId: string, receiptId: string) => `${transactionId}:${receiptId}`;

function daysBetween(isoDateA: string, isoDateB: string): number {
  const a = Date.parse(`${isoDateA.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${isoDateB.slice(0, 10)}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

type Scored = {
  receipt: MatchableReceipt;
  score: number;
  signals: MatchSignal[];
  payerScore: number;
  dayOffset: number | null;
};

/**
 * Evidence for one deposit/receipt pair, with whether the rules would propose it. Also used to
 * verify AI suggestions: the signals shown are always these computed ones, never the model's.
 */
export function evaluatePair(
  txn: MatchableTransaction,
  receipt: MatchableReceipt,
): (Scored & { eligible: boolean }) | null {
  if (txn.currency !== receipt.currency) return null;
  if (txn.unappliedMinor <= 0n || receipt.outstandingMinor <= 0n) return null;

  const signals: MatchSignal[] = ["currency_match"];
  let total = 0;

  const referenceMatch =
    containsReference(txn.reference, receipt.reference) ||
    containsReference(txn.statementReference, receipt.reference);
  if (referenceMatch) {
    signals.push("reference_match");
    total += WEIGHTS.reference_match;
  }

  if (txn.unappliedMinor === receipt.outstandingMinor) {
    signals.push("amount_match");
    total += WEIGHTS.amount_match;
  } else if (txn.unappliedMinor < receipt.outstandingMinor) {
    signals.push("partial_amount");
    total += WEIGHTS.partial_amount;
  } else {
    signals.push("over_amount");
    total += WEIGHTS.over_amount;
  }

  const payerScore = nameSimilarity(txn.counterpartyName, receipt.payerName);
  if (payerScore >= 0.5) {
    signals.push("payer_similarity");
    total += WEIGHTS.payer_similarity * payerScore;
  }

  const dayOffset = txn.occurredAt ? daysBetween(txn.occurredAt, receipt.expectedDate) : null;
  if (dayOffset !== null && Math.abs(dayOffset) <= DATE_WINDOW_DAYS) {
    signals.push("date_proximity");
    total += WEIGHTS.date_proximity;
  }

  const has = (signal: MatchSignal) => signals.includes(signal);
  const eligible =
    has("reference_match") ||
    (has("amount_match") && (has("payer_similarity") || has("date_proximity"))) ||
    (has("payer_similarity") && (has("amount_match") || has("partial_amount")));
  return {
    receipt,
    score: Math.min(1, Number(total.toFixed(3))),
    signals,
    payerScore,
    dayOffset,
    eligible: eligible && total >= MIN_SCORE,
  };
}

function score(txn: MatchableTransaction, receipt: MatchableReceipt): Scored | null {
  const evaluated = evaluatePair(txn, receipt);
  return evaluated?.eligible ? evaluated : null;
}

function explain(txn: MatchableTransaction, candidate: Scored, discrepancy: Discrepancy): string {
  const { receipt, signals, dayOffset } = candidate;
  const money = (minor: bigint) => formatMoney(minor, txn.currency, txn.exponent);
  const parts: string[] = [];

  if (signals.includes("reference_match")) {
    parts.push(`Reference ${receipt.reference} appears on the deposit.`);
  } else {
    parts.push(`The deposit does not carry reference ${receipt.reference}.`);
  }

  if (discrepancy.kind === "none") {
    parts.push(`The ${money(txn.unappliedMinor)} deposit equals the outstanding amount.`);
  } else if (discrepancy.kind === "shortfall") {
    parts.push(
      `The ${money(txn.unappliedMinor)} deposit covers part of the ${money(receipt.outstandingMinor)} outstanding; ${money(discrepancy.amountMinor)} would remain outstanding.`,
    );
  } else {
    parts.push(
      `The ${money(txn.unappliedMinor)} deposit exceeds the ${money(receipt.outstandingMinor)} outstanding by ${money(discrepancy.amountMinor)}; only the outstanding amount would be applied.`,
    );
  }

  if (signals.includes("payer_similarity")) {
    parts.push(`Payer “${txn.counterpartyName}” resembles “${receipt.payerName}”.`);
  } else if (txn.counterpartyName) {
    parts.push(`Payer “${txn.counterpartyName}” does not clearly match “${receipt.payerName}”.`);
  }

  if (dayOffset !== null) {
    const days = Math.abs(dayOffset);
    parts.push(
      dayOffset === 0
        ? "Received on the expected date."
        : `Received ${days} day${days === 1 ? "" : "s"} ${dayOffset > 0 ? "after" : "before"} the expected date.`,
    );
  }
  return parts.join(" ");
}

function matchTypeFor(signals: MatchSignal[]): MatchType {
  if (signals.includes("reference_match")) return "exact_reference";
  if (signals.includes("amount_match")) return "exact_amount";
  if (signals.includes("partial_amount")) return "partial_amount";
  return "suggested";
}

/**
 * Flags deposits that look like the same money arriving twice: same currency and amount,
 * same reference (or same payer when there is no reference), within three days.
 */
export function findSuspectedDuplicates(transactions: MatchableTransaction[]): Set<string> {
  const flagged = new Set<string>();
  const credits = transactions.filter((txn) => txn.amountMinor > 0n);
  for (let i = 0; i < credits.length; i += 1) {
    for (let j = i + 1; j < credits.length; j += 1) {
      const a = credits[i];
      const b = credits[j];
      if (a.currency !== b.currency || a.amountMinor !== b.amountMinor) continue;
      if (a.occurredAt && b.occurredAt && Math.abs(daysBetween(a.occurredAt, b.occurredAt)) > 3) continue;

      const refA = normalizeReference(a.reference ?? "");
      const refB = normalizeReference(b.reference ?? "");
      const sameReference = refA.length >= 3 && refA === refB;
      const samePayerNoReference =
        !refA && !refB && nameSimilarity(a.counterpartyName, b.counterpartyName) >= 0.99;
      if (sameReference || samePayerNoReference) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
  }
  return flagged;
}

/**
 * Proposes matches for every transaction with unapplied funds, so re-running is idempotent:
 * - `decidedPairs` (confirmed, rejected or reversed) are never proposed again;
 * - `openPairs` (already awaiting review) still compete in the ranking but are not re-emitted,
 *   so a runner-up is never promoted just because the best fit is already on screen.
 */
export function proposeMatches({
  transactions,
  receipts,
  decidedPairs,
  openPairs = new Set(),
  duplicateIds = findSuspectedDuplicates(transactions),
}: {
  transactions: MatchableTransaction[];
  receipts: MatchableReceipt[];
  decidedPairs: Set<string>;
  openPairs?: Set<string>;
  duplicateIds?: Set<string>;
}): MatchProposal[] {
  const proposals: MatchProposal[] = [];

  for (const txn of transactions) {
    if (txn.unappliedMinor <= 0n) continue;
    if (txn.providerStatus === "REJECTED" || txn.providerStatus === "REVERSED") continue;

    const candidates = receipts
      .filter((receipt) => !decidedPairs.has(pairKey(txn.id, receipt.id)))
      .map((receipt) => score(txn, receipt))
      .filter((candidate): candidate is Scored => candidate !== null)
      .sort((a, b) => b.score - a.score || a.receipt.id.localeCompare(b.receipt.id));
    if (candidates.length === 0) continue;

    const top = candidates[0];
    const contenders = candidates.filter(
      (candidate) =>
        candidate.score >= top.score - AMBIGUITY_MARGIN ||
        (candidate.signals.includes("reference_match") && top.signals.includes("reference_match")),
    );
    const ambiguous = contenders.length > 1;

    for (const candidate of ambiguous ? contenders : [top]) {
      const { receipt, signals } = candidate;
      if (openPairs.has(pairKey(txn.id, receipt.id))) continue;
      const discrepancy: Discrepancy =
        txn.unappliedMinor === receipt.outstandingMinor
          ? { kind: "none" }
          : txn.unappliedMinor < receipt.outstandingMinor
            ? { kind: "shortfall", amountMinor: receipt.outstandingMinor - txn.unappliedMinor }
            : { kind: "excess", amountMinor: txn.unappliedMinor - receipt.outstandingMinor };

      const reviewReasons: string[] = [];
      if (ambiguous) reviewReasons.push("Several expected receipts fit this deposit.");
      if (!signals.includes("reference_match")) {
        reviewReasons.push("No reference match: payer, amount or date evidence only.");
      }
      if (discrepancy.kind === "excess") {
        reviewReasons.push("The deposit is larger than the amount outstanding.");
      }
      if (duplicateIds.has(txn.id)) {
        reviewReasons.push("This deposit looks like a possible duplicate.");
      }
      if (txn.providerStatus !== "SETTLED") {
        reviewReasons.push(`Airwallex reports this deposit as ${txn.providerStatus}; it can be applied once settled.`);
      }

      proposals.push({
        transactionId: txn.id,
        expectedReceiptId: receipt.id,
        matchType: matchTypeFor(signals),
        status: reviewReasons.length > 0 ? "needs_review" : "suggested",
        confidence: candidate.score,
        signals,
        discrepancy,
        reviewReasons,
        explanation: explain(txn, candidate, discrepancy),
      });
    }
  }

  return proposals;
}
