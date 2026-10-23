import "server-only";

import type { Json } from "@/lib/db/database.types";
import { currencyExponent, parseMinor } from "@/lib/money";
import {
  findSuspectedDuplicates,
  pairKey,
  proposeMatches,
  type MatchableReceipt,
  type MatchableTransaction,
} from "@/lib/reconciliation/matching";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";

/** Loads the evidence and open receipts that the rules engine works on. */
export async function loadMatchingInputs({ supabase, workspace }: WorkspaceContext) {
  const [transactions, receipts, matches] = await Promise.all([
    supabase
      .from("transaction_application")
      .select(
        "id, currency, provider_status, provider_reference, statement_reference, counterparty_name, occurred_at, amount:amount_minor::text, unapplied:unapplied_amount_minor::text",
      )
      .eq("workspace_id", workspace.id)
      .eq("direction", "credit"),
    supabase
      .from("expected_receipt_progress")
      .select("id, currency, reference, payer_name, expected_date, outstanding:outstanding_amount_minor::text")
      .eq("workspace_id", workspace.id)
      .is("cancelled_at", null)
      .is("archived_at", null),
    supabase
      .from("reconciliation_matches")
      .select("transaction_id, expected_receipt_id, match_status")
      .eq("workspace_id", workspace.id),
  ]);
  if (transactions.error || receipts.error || matches.error) {
    throw new Error("Could not load reconciliation data.");
  }

  const matchable: MatchableTransaction[] = transactions.data.map((row) => ({
    id: row.id!,
    currency: row.currency!,
    exponent: currencyExponent(row.currency!),
    amountMinor: parseMinor(row.amount) ?? 0n,
    unappliedMinor: parseMinor(row.unapplied) ?? 0n,
    providerStatus: row.provider_status ?? "UNKNOWN",
    reference: row.provider_reference,
    statementReference: row.statement_reference,
    counterpartyName: row.counterparty_name,
    occurredAt: row.occurred_at,
  }));

  const openReceipts: MatchableReceipt[] = receipts.data.map((row) => ({
    id: row.id!,
    currency: row.currency!,
    exponent: currencyExponent(row.currency!),
    outstandingMinor: parseMinor(row.outstanding) ?? 0n,
    reference: row.reference!,
    payerName: row.payer_name!,
    expectedDate: row.expected_date!,
  }));

  // Confirmed, rejected and reversed pairs are final and never re-suggested. Open suggestions
  // still take part in ranking. Superseded ones (retired by a receipt edit) may be proposed again.
  const pairsWith = (statuses: string[]) =>
    new Set(
      matches.data
        .filter((match) => statuses.includes(match.match_status))
        .map((match) => pairKey(match.transaction_id, match.expected_receipt_id)),
    );
  const decidedPairs = pairsWith(["confirmed", "rejected", "reversed"]);
  const openPairs = pairsWith(["suggested", "needs_review"]);

  return { matchable, openReceipts, decidedPairs, openPairs };
}

/**
 * Runs the deterministic rules and stores new suggestions. Idempotent: decided or open pairs
 * are skipped, and the database refuses a second live match for the same pair.
 */
export async function generateSuggestions(context: WorkspaceContext): Promise<{
  created: number;
  needsReview: number;
}> {
  const { supabase, workspace, user } = context;
  const { matchable, openReceipts, decidedPairs, openPairs } = await loadMatchingInputs(context);
  const proposals = proposeMatches({
    transactions: matchable,
    receipts: openReceipts,
    decidedPairs,
    openPairs,
    duplicateIds: findSuspectedDuplicates(matchable),
  });
  if (proposals.length === 0) return { created: 0, needsReview: 0 };

  let created = 0;
  let needsReview = 0;
  for (const proposal of proposals) {
    const evidence: Json = {
      signals: proposal.signals,
      explanation: proposal.explanation,
      review_reasons: proposal.reviewReasons,
      discrepancy:
        proposal.discrepancy.kind === "none"
          ? { kind: "none" }
          : { kind: proposal.discrepancy.kind, amount_minor: proposal.discrepancy.amountMinor.toString() },
    };
    const { error } = await supabase.from("reconciliation_matches").insert({
      workspace_id: workspace.id,
      transaction_id: proposal.transactionId,
      expected_receipt_id: proposal.expectedReceiptId,
      match_type: proposal.matchType,
      match_status: proposal.status,
      confidence: proposal.confidence,
      evidence,
      suggested_by: "rules",
    });
    if (error) {
      // 23505: another run created the same live pair first — the desired end state.
      if (error.code === "23505") continue;
      throw new Error(`Could not store a match suggestion (${error.code})`);
    }
    created += 1;
    if (proposal.status === "needs_review") needsReview += 1;
  }

  if (created > 0) {
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "reconciliation.suggestions_generated",
      outcome: "info",
      summary: `Proposed ${created} match${created === 1 ? "" : "es"} for review (${needsReview} flagged for closer review). Nothing was confirmed automatically.`,
      metadata: { created, needs_review: needsReview },
    });
  }
  return { created, needsReview };
}
