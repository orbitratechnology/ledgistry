import "server-only";

import {
  deriveReceiptState,
  deriveTransactionState,
  todayIso,
  type ReceiptState,
  type TransactionMatchState,
} from "@/lib/finance/states";
import { currencyExponent, parseMinor } from "@/lib/money";
import { findSuspectedDuplicates, type MatchSignal } from "@/lib/reconciliation/matching";
import type { WorkspaceContext } from "@/server/auth/session";

export type TransactionView = {
  id: string;
  providerId: string;
  currency: string;
  exponent: number;
  amountMinor: bigint;
  appliedMinor: bigint;
  unappliedMinor: bigint;
  providerStatus: string;
  providerType: string | null;
  reference: string | null;
  counterpartyName: string | null;
  occurredAt: string | null;
  isSimulated: boolean;
  state: TransactionMatchState;
  duplicateSuspected: boolean;
  providerChangedAfterMatch: boolean;
};

export type ReceiptView = {
  id: string;
  payerName: string;
  reference: string;
  currency: string;
  exponent: number;
  expectedMinor: bigint;
  receivedMinor: bigint;
  outstandingMinor: bigint;
  expectedDate: string;
  notes: string | null;
  cancelled: boolean;
  archived: boolean;
  isDemo: boolean;
  state: ReceiptState;
  overdue: boolean;
};

export type MatchView = {
  id: string;
  transactionId: string;
  receiptId: string;
  matchType: string;
  status: "suggested" | "needs_review" | "confirmed" | "rejected" | "reversed" | "superseded";
  confidence: number | null;
  signals: MatchSignal[];
  explanation: string | null;
  reviewReasons: string[];
  discrepancy: { kind: "none" | "shortfall" | "excess"; amountMinor: bigint };
  appliedMinor: bigint | null;
  suggestedBy: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type ReconciliationData = {
  transactions: TransactionView[];
  receipts: ReceiptView[];
  matches: MatchView[];
  lastSync: { at: string; status: string; message: string | null } | null;
};

function parseEvidence(evidence: unknown) {
  const value = (evidence && typeof evidence === "object" ? evidence : {}) as Record<string, unknown>;
  const discrepancy = (value.discrepancy ?? {}) as Record<string, unknown>;
  const kind =
    discrepancy.kind === "shortfall" || discrepancy.kind === "excess" ? discrepancy.kind : "none";
  return {
    signals: Array.isArray(value.signals) ? (value.signals as MatchSignal[]) : [],
    explanation: typeof value.explanation === "string" ? value.explanation : null,
    reviewReasons: Array.isArray(value.review_reasons) ? (value.review_reasons as string[]) : [],
    discrepancy: {
      kind,
      amountMinor:
        kind === "none" ? 0n : (parseMinor(discrepancy.amount_minor as string | undefined) ?? 0n),
    } as MatchView["discrepancy"],
  };
}

export async function getReconciliationData(
  { supabase, workspace }: WorkspaceContext,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<ReconciliationData> {
  const receiptsQuery = supabase
    .from("expected_receipt_progress")
    .select(
      "id, payer_name, reference, currency, expected_date, notes, cancelled_at, archived_at, is_demo, open_review_count, open_suggestion_count, expected:expected_amount_minor::text, received:received_amount_minor::text",
    )
    .eq("workspace_id", workspace.id)
    .order("expected_date", { ascending: true });

  const [transactions, receipts, matches, lastSync] = await Promise.all([
    supabase
      .from("transaction_application")
      .select(
        "id, provider_transaction_id, currency, provider_status, provider_type, provider_reference, statement_reference, counterparty_name, occurred_at, is_sandbox_simulation, open_review_count, open_suggestion_count, amount:amount_minor::text, applied:applied_amount_minor::text",
      )
      .eq("workspace_id", workspace.id)
      .order("occurred_at", { ascending: false, nullsFirst: false }),
    includeArchived ? receiptsQuery : receiptsQuery.is("archived_at", null),
    supabase
      .from("reconciliation_matches")
      .select(
        "id, transaction_id, expected_receipt_id, match_type, match_status, confidence, evidence, suggested_by, decided_at, decision_note, created_at, applied:applied_amount_minor::text",
      )
      .eq("workspace_id", workspace.id)
      .neq("match_status", "superseded")
      .order("created_at", { ascending: false }),
    supabase
      .from("sync_runs")
      .select("status, finished_at, started_at, safe_error_summary")
      .eq("workspace_id", workspace.id)
      .eq("kind", "transactions")
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (transactions.error || receipts.error || matches.error || lastSync.error) {
    throw new Error("Could not load reconciliation data.");
  }

  const base = transactions.data.map((row) => ({
    id: row.id!,
    providerId: row.provider_transaction_id!,
    currency: row.currency!,
    exponent: currencyExponent(row.currency!),
    amountMinor: parseMinor(row.amount) ?? 0n,
    appliedMinor: parseMinor(row.applied) ?? 0n,
    providerStatus: row.provider_status ?? "UNKNOWN",
    providerType: row.provider_type,
    reference: row.provider_reference,
    statementReference: row.statement_reference,
    counterpartyName: row.counterparty_name,
    occurredAt: row.occurred_at,
    isSimulated: row.is_sandbox_simulation ?? false,
    openReviewCount: row.open_review_count ?? 0,
    openSuggestionCount: row.open_suggestion_count ?? 0,
  }));

  const duplicates = findSuspectedDuplicates(
    base.map((row) => ({ ...row, unappliedMinor: row.amountMinor - row.appliedMinor })),
  );

  const transactionViews: TransactionView[] = base.map((row) => {
    const derived = deriveTransactionState({
      providerStatus: row.providerStatus,
      amountMinor: row.amountMinor,
      appliedMinor: row.appliedMinor,
      openSuggestionCount: row.openSuggestionCount,
      openReviewCount: row.openReviewCount,
      duplicateSuspected: duplicates.has(row.id),
    });
    return {
      id: row.id,
      providerId: row.providerId,
      currency: row.currency,
      exponent: row.exponent,
      amountMinor: row.amountMinor,
      appliedMinor: row.appliedMinor,
      unappliedMinor: derived.unappliedMinor,
      providerStatus: row.providerStatus,
      providerType: row.providerType,
      reference: row.reference ?? row.statementReference,
      counterpartyName: row.counterpartyName,
      occurredAt: row.occurredAt,
      isSimulated: row.isSimulated,
      state: derived.state,
      duplicateSuspected: duplicates.has(row.id),
      providerChangedAfterMatch: derived.providerChangedAfterMatch,
    };
  });

  const today = todayIso();
  const receiptViews: ReceiptView[] = receipts.data.map((row) => {
    const expectedMinor = parseMinor(row.expected) ?? 0n;
    const receivedMinor = parseMinor(row.received) ?? 0n;
    const derived = deriveReceiptState({
      cancelled: row.cancelled_at !== null,
      expectedMinor,
      receivedMinor,
      openReviewCount: row.open_review_count ?? 0,
      openSuggestionCount: row.open_suggestion_count ?? 0,
      expectedDate: row.expected_date!,
      today,
    });
    return {
      id: row.id!,
      payerName: row.payer_name!,
      reference: row.reference!,
      currency: row.currency!,
      exponent: currencyExponent(row.currency!),
      expectedMinor,
      receivedMinor,
      outstandingMinor: derived.outstandingMinor,
      expectedDate: row.expected_date!,
      notes: row.notes,
      cancelled: row.cancelled_at !== null,
      archived: row.archived_at !== null,
      isDemo: row.is_demo ?? false,
      state: derived.state,
      overdue: derived.overdue,
    };
  });

  const matchViews: MatchView[] = matches.data.map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    receiptId: row.expected_receipt_id,
    matchType: row.match_type,
    status: row.match_status as MatchView["status"],
    confidence: row.confidence,
    ...parseEvidence(row.evidence),
    appliedMinor: parseMinor(row.applied),
    suggestedBy: row.suggested_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  }));

  return {
    transactions: transactionViews,
    receipts: receiptViews,
    matches: matchViews,
    lastSync: lastSync.data
      ? {
          at: lastSync.data.finished_at ?? lastSync.data.started_at,
          status: lastSync.data.status,
          message: lastSync.data.safe_error_summary,
        }
      : null,
  };
}
