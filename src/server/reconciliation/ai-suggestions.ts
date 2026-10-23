import "server-only";

import type { Json } from "@/lib/db/database.types";
import { evaluatePair, pairKey } from "@/lib/reconciliation/matching";
import { suggestReceiptMatches } from "@/server/ai/tasks";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { loadMatchingInputs } from "./suggestions";

const MAX_CANDIDATES = 12;

export type AiSuggestOutcome = { ok: boolean; message: string };

/**
 * Asks Claude which open receipt an unplaced deposit pays. Anything it proposes is stored only as
 * a needs-review suggestion with rule-computed signals; confirming still takes a person.
 */
export async function suggestMatchesWithAi(context: WorkspaceContext, transactionId: string): Promise<AiSuggestOutcome> {
  const { supabase, workspace, user } = context;
  const { matchable, openReceipts, decidedPairs, openPairs, expectedById } = await loadMatchingInputs(context);
  const deposit = matchable.find((txn) => txn.id === transactionId);
  if (!deposit) return { ok: false, message: "Deposit not found." };
  if (deposit.unappliedMinor <= 0n) return { ok: false, message: "This deposit is already fully applied." };
  if ([...openPairs].some((key) => key.startsWith(`${deposit.id}:`))) {
    return { ok: false, message: "This deposit already has suggestions waiting for review." };
  }

  const candidates = openReceipts
    .filter(
      (receipt) =>
        receipt.currency === deposit.currency &&
        receipt.outstandingMinor > 0n &&
        !decidedPairs.has(pairKey(deposit.id, receipt.id)),
    )
    .map((receipt) => ({ receipt, score: evaluatePair(deposit, receipt)?.score ?? 0 }))
    .sort((a, b) => b.score - a.score || a.receipt.expectedDate.localeCompare(b.receipt.expectedDate))
    .slice(0, MAX_CANDIDATES)
    .map(({ receipt }) => ({ ...receipt, expectedMinor: expectedById.get(receipt.id) ?? receipt.outstandingMinor }));
  if (candidates.length === 0) {
    return { ok: false, message: `No open ${deposit.currency} receipts to compare this deposit with.` };
  }

  const result = await suggestReceiptMatches(deposit, candidates);
  if (!result.ok) {
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "ai.match_suggestion_failed",
      entityType: "financial_transaction",
      entityId: deposit.id,
      outcome: "failure",
      summary: `No AI match suggestion: ${result.message}`,
      metadata: { failure_kind: result.kind },
    });
    return { ok: false, message: `${result.message} You can still match it manually.` };
  }

  let created = 0;
  for (const suggestion of result.value.suggestions) {
    const receipt = candidates.find((candidate) => candidate.id === suggestion.expectedReceiptId)!;
    const shortfall = receipt.outstandingMinor - deposit.unappliedMinor;
    const evidence: Json = {
      source: "ai",
      model_id: result.modelId,
      signals: suggestion.signals,
      explanation: suggestion.explanation,
      review_reasons: [
        "Suggested by AI (Claude) after the rules found no confident match. Check the evidence before confirming.",
        ...(suggestion.signals.includes("reference_match") ? [] : ["No reference match: payer, amount or date evidence only."]),
      ],
      discrepancy:
        shortfall === 0n
          ? { kind: "none" }
          : shortfall > 0n
            ? { kind: "shortfall", amount_minor: shortfall.toString() }
            : { kind: "excess", amount_minor: (-shortfall).toString() },
    };
    const { error } = await supabase.from("reconciliation_matches").insert({
      workspace_id: workspace.id,
      transaction_id: deposit.id,
      expected_receipt_id: receipt.id,
      match_type: "suggested",
      match_status: "needs_review",
      confidence: suggestion.confidence,
      evidence,
      suggested_by: "ai",
    });
    if (error && error.code !== "23505") throw new Error(`Could not store the AI suggestion (${error.code})`);
    if (!error) created += 1;
  }

  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: "ai.match_suggested",
    entityType: "financial_transaction",
    entityId: deposit.id,
    outcome: "info",
    summary:
      created > 0
        ? `Claude suggested ${created} possible receipt${created === 1 ? "" : "s"} for a deposit from ${deposit.counterpartyName ?? "an unknown payer"}. Awaiting review; nothing applied.`
        : `Claude found no convincing receipt for a deposit from ${deposit.counterpartyName ?? "an unknown payer"}.`,
    metadata: { created, model_id: result.modelId, candidates: candidates.length },
  });

  return created > 0
    ? { ok: true, message: `Claude suggested ${created} possible match${created === 1 ? "" : "es"}. Review the evidence before confirming.` }
    : {
        ok: true,
        message: `Claude found no convincing match${result.value.noMatchReason ? `: ${result.value.noMatchReason}` : "."}`,
      };
}
