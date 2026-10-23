/**
 * Finance vocabulary and deterministic state derivation. States are derived from facts
 * (amounts, decisions, dates) rather than stored, so they cannot drift out of sync.
 */

export const OBLIGATION_PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type ObligationPriority = (typeof OBLIGATION_PRIORITIES)[number];

export const PRIORITY_LABEL: Record<ObligationPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const OBLIGATION_STATUSES = [
  "draft",
  "planned",
  "approval_required",
  "in_progress",
  "paid",
  "deferred",
  "cancelled",
  "failed",
] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

/** Statuses an operator may set by editing; the rest come from payment processing. */
export const OPERATOR_OBLIGATION_STATUSES = ["draft", "planned", "deferred", "cancelled"] as const;
export type OperatorObligationStatus = (typeof OPERATOR_OBLIGATION_STATUSES)[number];

export const OBLIGATION_STATUS_LABEL: Record<ObligationStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  approval_required: "Approval required",
  in_progress: "In progress",
  paid: "Paid",
  deferred: "Deferred",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function isOperatorEditableStatus(status: string): status is OperatorObligationStatus | "failed" {
  return (OPERATOR_OBLIGATION_STATUSES as readonly string[]).includes(status) || status === "failed";
}

// Expected receipts ----------------------------------------------------------------

export type ReceiptState =
  | "expected"
  | "partially_received"
  | "matched"
  | "overdue"
  | "needs_review"
  | "cancelled";

export const RECEIPT_STATE_LABEL: Record<ReceiptState, string> = {
  expected: "Expected",
  partially_received: "Partially received",
  matched: "Matched",
  overdue: "Overdue",
  needs_review: "Needs review",
  cancelled: "Cancelled",
};

export type ReceiptFacts = {
  cancelled: boolean;
  expectedMinor: bigint;
  receivedMinor: bigint;
  openReviewCount: number;
  openSuggestionCount: number;
  /** ISO date (YYYY-MM-DD). */
  expectedDate: string;
  /** ISO date (YYYY-MM-DD) for "today" in the workspace. */
  today: string;
};

export function deriveReceiptState(facts: ReceiptFacts): {
  state: ReceiptState;
  overdue: boolean;
  outstandingMinor: bigint;
  hasSuggestion: boolean;
} {
  const outstandingMinor = facts.expectedMinor - facts.receivedMinor;
  const overdue = !facts.cancelled && outstandingMinor > 0n && facts.expectedDate < facts.today;
  const hasSuggestion = facts.openSuggestionCount > 0;

  let state: ReceiptState;
  if (facts.cancelled) state = "cancelled";
  else if (outstandingMinor <= 0n) state = "matched";
  else if (facts.openReviewCount > 0) state = "needs_review";
  else if (facts.receivedMinor > 0n) state = "partially_received";
  else if (overdue) state = "overdue";
  else state = "expected";

  return { state, overdue, outstandingMinor, hasSuggestion };
}

// Provider transactions ---------------------------------------------------------------

export type TransactionMatchState =
  | "unmatched"
  | "suggested_match"
  | "partially_matched"
  | "matched"
  | "duplicate_suspected"
  | "needs_review";

export const TRANSACTION_STATE_LABEL: Record<TransactionMatchState, string> = {
  unmatched: "Unmatched",
  suggested_match: "Suggested match",
  partially_matched: "Partially matched",
  matched: "Matched",
  duplicate_suspected: "Duplicate suspected",
  needs_review: "Needs review",
};

export type TransactionFacts = {
  providerStatus: string;
  amountMinor: bigint;
  appliedMinor: bigint;
  openSuggestionCount: number;
  openReviewCount: number;
  duplicateSuspected: boolean;
};

export function deriveTransactionState(facts: TransactionFacts): {
  state: TransactionMatchState;
  unappliedMinor: bigint;
  /** A confirmed match exists but the provider no longer reports the deposit as settled. */
  providerChangedAfterMatch: boolean;
} {
  const unappliedMinor = facts.amountMinor - facts.appliedMinor;
  const providerChangedAfterMatch = facts.appliedMinor > 0n && facts.providerStatus !== "SETTLED";

  let state: TransactionMatchState;
  if (providerChangedAfterMatch) state = "needs_review";
  else if (facts.appliedMinor > 0n && unappliedMinor <= 0n) state = "matched";
  else if (facts.duplicateSuspected) state = "duplicate_suspected";
  else if (facts.openReviewCount > 0) state = "needs_review";
  else if (facts.appliedMinor > 0n) state = "partially_matched";
  else if (facts.openSuggestionCount > 0) state = "suggested_match";
  else state = "unmatched";

  return { state, unappliedMinor, providerChangedAfterMatch };
}

/** Today's date as YYYY-MM-DD in UTC (the workspace date for MVP purposes). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
