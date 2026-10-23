"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { currencyExponent, formatMoney, minorToDecimalString } from "@/lib/money";
import {
  fieldErrorsFrom,
  formValues,
  receiptFormSchema,
  simulateDepositSchema,
  type FormState,
} from "@/lib/validation/forms";
import { recordAuditEvent } from "@/server/audit/record";
import { requireWorkspace, type WorkspaceContext } from "@/server/auth/session";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";
import { listGlobalAccounts } from "@/server/airwallex/global-accounts";
import { simulateDeposit } from "@/server/airwallex/simulation";
import { extractReceiptEvidence } from "@/server/ai/tasks";
import type { ReceiptEvidenceSuggestion } from "@/server/ai/schemas";
import { refreshBalances } from "@/server/balances/sync";
import { recalculatePlans } from "@/server/planner/recalculate";
import { suggestMatchesWithAi } from "@/server/reconciliation/ai-suggestions";
import { generateSuggestions } from "@/server/reconciliation/suggestions";
import { syncTransactions } from "@/server/reconciliation/sync";

export type ActionResult = { ok: boolean; message: string; warnings?: string[] };

const idSchema = z.uuid();
const noteSchema = z.string().trim().max(500).optional().transform((value) => value || null);

// Evidence ---------------------------------------------------------------------------

/**
 * New deposits change actual cash, so evidence syncs also refresh balances from Airwallex and
 * recalculate the plan. Returns warnings instead of failing the sync itself.
 */
async function refreshCashAndPlan(context: WorkspaceContext): Promise<string[]> {
  const balances = await refreshBalances(context);
  const plan = await recalculatePlans(context, "transaction_sync");
  return [
    ...(balances.ok ? [] : [`Balances were not refreshed: ${balances.message}`]),
    ...(plan.ok ? [] : [plan.message]),
  ];
}

export async function syncTransactionsAction(): Promise<ActionResult> {
  const context = await requireWorkspace();
  const result = await syncTransactions(context);
  const cashWarnings = result.ok ? await refreshCashAndPlan(context) : [];
  refresh();
  if (!result.ok) return result;
  const suggestionText =
    result.suggestions > 0
      ? ` ${result.suggestions} new match suggestion${result.suggestions === 1 ? "" : "s"} to review.`
      : "";
  return {
    ok: true,
    message: `Synced ${result.total} deposit${result.total === 1 ? "" : "s"} from Airwallex (${result.imported} new).${suggestionText}`,
    warnings: [...result.warnings, ...cashWarnings],
  };
}

export async function runMatchingAction(): Promise<ActionResult> {
  const context = await requireWorkspace();
  const { created, needsReview } = await generateSuggestions(context);
  refresh();
  return {
    ok: true,
    message:
      created === 0
        ? "No new matches found. Previously decided pairs are never suggested again."
        : `Proposed ${created} match${created === 1 ? "" : "es"} (${needsReview} need closer review).`,
  };
}

/** Sandbox-only: creates a clearly labelled simulated deposit, then syncs it in. */
export async function simulateDepositAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  const values = formValues(formData);
  const parsed = simulateDepositSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  const input = parsed.data;

  const client = getAirwallexClient();
  const accounts = await listGlobalAccounts(client).catch(() => null);
  const account = accounts?.find((candidate) => candidate.id === input.globalAccountId);
  if (!account) {
    return { fieldErrors: { globalAccountId: "Choose an available Global Account." }, values };
  }
  if (account.baseCurrency && account.baseCurrency !== input.currency) {
    return {
      fieldErrors: { currency: `Deposits to this account arrive in ${account.baseCurrency}.` },
      values,
    };
  }

  const exponent = currencyExponent(input.currency);
  let depositId: string;
  try {
    const deposit = await simulateDeposit(client, {
      globalAccountId: input.globalAccountId,
      amount: minorToDecimalString(input.amountMinor, exponent),
      payerName: input.payerName,
      reference: input.reference,
    });
    depositId = deposit.id;

    await supabase.from("sandbox_simulations").insert({
      workspace_id: workspace.id,
      kind: "deposit",
      provider_object_id: deposit.id,
      global_account_id: input.globalAccountId,
      amount_minor: Number(input.amountMinor),
      currency: deposit.currency,
      reference: input.reference,
      payer_name: input.payerName,
      provider_status: deposit.status ?? null,
    });
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "sandbox.deposit_simulated",
      entityType: "sandbox_simulation",
      entityId: deposit.id,
      outcome: "success",
      summary: `Simulated a sandbox deposit of ${formatMoney(input.amountMinor, deposit.currency, exponent)} from ${input.payerName} (ref ${input.reference}). Sandbox activity, not a real payment.`,
      metadata: { deposit_id: deposit.id, global_account_id: input.globalAccountId },
    });
  } catch (error) {
    const message =
      error instanceof AirwallexError
        ? error.kind === "timeout" || error.kind === "unavailable"
          ? "Airwallex did not confirm the simulation. It may still have been created — sync transactions to check before trying again."
          : error.safeMessage
        : "Could not simulate the deposit.";
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "sandbox.deposit_simulation_failed",
      outcome: "failure",
      summary: message,
      metadata: { error_kind: error instanceof AirwallexError ? error.kind : "internal_error" },
    });
    refresh();
    return { message, values };
  }

  const sync = await syncTransactions(context, { awaitDepositId: depositId });
  const warnings = sync.ok ? [...sync.warnings, ...(await refreshCashAndPlan(context))] : [];
  refresh();
  return {
    ok: true,
    message: !sync.ok
      ? `Sandbox deposit created, but the sync failed: ${sync.message}`
      : warnings.length > 0
        ? `Sandbox deposit created. ${warnings.join(" ")}`
        : "Sandbox deposit created and synced. Review any suggested match.",
  };
}

// Expected receipts --------------------------------------------------------------------

export async function saveReceiptAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  const values = formValues(formData);
  const idInput = values.id || null;
  if (idInput && !idSchema.safeParse(idInput).success) {
    return { message: "This receipt could not be found.", values };
  }
  const parsed = receiptFormSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  const input = parsed.data;

  const record = {
    payer_name: input.payerName,
    reference: input.reference,
    expected_amount_minor: Number(input.amountMinor),
    currency: input.currency,
    expected_date: input.expectedDate,
    notes: input.notes,
  };
  const amountLabel = formatMoney(input.amountMinor, input.currency, currencyExponent(input.currency));

  const { data, error } = idInput
    ? await supabase.from("expected_receipts").update(record).eq("id", idInput).select("id").single()
    : await supabase
        .from("expected_receipts")
        .insert({ ...record, workspace_id: workspace.id })
        .select("id")
        .single();
  if (error || !data) return { message: error?.message ?? "Could not save the expected receipt.", values };

  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: idInput ? "receipt.updated" : "receipt.created",
    entityType: "expected_receipt",
    entityId: data.id,
    outcome: "success",
    summary: `${idInput ? "Updated" : "Created"} expected receipt ${input.reference} from ${input.payerName}: ${amountLabel} expected ${input.expectedDate}. Forecast only — not counted as cash.`,
    metadata: { amount_minor: record.expected_amount_minor, currency: input.currency },
  });

  const suggestions = await generateSuggestions(context);
  await recalculatePlans(context, "receipt_change");
  refresh();
  return {
    ok: true,
    message:
      `${idInput ? "Receipt updated" : "Expected receipt added"}.` +
      (suggestions.created > 0 ? ` ${suggestions.created} matching deposit suggestion(s) to review.` : ""),
  };
}

async function updateReceiptFlag(
  id: string,
  patch: { cancelled_at?: string | null; archived_at?: string | null },
  eventType: string,
  verb: string,
): Promise<ActionResult> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Receipt not found." };
  const { data, error } = await supabase
    .from("expected_receipts")
    .update(patch)
    .eq("id", id)
    .select("reference, payer_name")
    .single();
  if (error || !data) return { ok: false, message: error?.message ?? "Receipt not found." };

  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType,
    entityType: "expected_receipt",
    entityId: id,
    outcome: "info",
    summary: `${verb} expected receipt ${data.reference} from ${data.payer_name}.`,
  });
  await recalculatePlans(context, "receipt_change");
  refresh();
  return { ok: true, message: `Receipt ${verb.toLowerCase()}.` };
}

export async function cancelReceiptAction(id: string) {
  return updateReceiptFlag(id, { cancelled_at: new Date().toISOString() }, "receipt.cancelled", "Cancelled");
}

export async function archiveReceiptAction(id: string) {
  return updateReceiptFlag(id, { archived_at: new Date().toISOString() }, "receipt.archived", "Archived");
}

// Match decisions (one-time, enforced in the database) -------------------------------------

function decisionError(error: { message?: string } | null): string {
  return error?.message || "The decision could not be recorded.";
}

export async function confirmMatchAction(matchId: string): Promise<ActionResult> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(matchId).success) return { ok: false, message: "Match not found." };
  const { error } = await context.supabase.rpc("confirm_reconciliation_match", { p_match_id: matchId });
  if (!error) await recalculatePlans(context, "match_decision");
  refresh();
  return error ? { ok: false, message: decisionError(error) } : { ok: true, message: "Match confirmed." };
}

export async function rejectMatchAction(matchId: string, note?: string): Promise<ActionResult> {
  const { supabase } = await requireWorkspace();
  if (!idSchema.safeParse(matchId).success) return { ok: false, message: "Match not found." };
  const parsedNote = noteSchema.safeParse(note);
  const { error } = await supabase.rpc("reject_reconciliation_match", {
    p_match_id: matchId,
    p_note: parsedNote.success ? (parsedNote.data ?? undefined) : undefined,
  });
  refresh();
  return error
    ? { ok: false, message: decisionError(error) }
    : { ok: true, message: "Suggestion rejected. It won't be suggested again." };
}

export async function reverseMatchAction(matchId: string, note?: string): Promise<ActionResult> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(matchId).success) return { ok: false, message: "Match not found." };
  const parsedNote = noteSchema.safeParse(note);
  const { error } = await context.supabase.rpc("reverse_reconciliation_match", {
    p_match_id: matchId,
    p_note: parsedNote.success ? (parsedNote.data ?? undefined) : undefined,
  });
  if (!error) await recalculatePlans(context, "match_decision");
  refresh();
  return error
    ? { ok: false, message: decisionError(error) }
    : { ok: true, message: "Match reversed. The amount is outstanding again." };
}

export async function manualMatchAction(transactionId: string, receiptId: string): Promise<ActionResult> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(transactionId).success || !idSchema.safeParse(receiptId).success) {
    return { ok: false, message: "Choose a deposit and a receipt." };
  }
  const { error } = await context.supabase.rpc("create_manual_match", {
    p_transaction_id: transactionId,
    p_expected_receipt_id: receiptId,
  });
  if (!error) await recalculatePlans(context, "match_decision");
  refresh();
  return error
    ? { ok: false, message: decisionError(error) }
    : { ok: true, message: "Deposit applied to the receipt." };
}

// AI assistance (suggestions only; never confirms, applies or pays) ------------------------

export async function aiSuggestMatchAction(transactionId: string): Promise<ActionResult> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(transactionId).success) return { ok: false, message: "Deposit not found." };
  const result = await suggestMatchesWithAi(context, transactionId);
  refresh();
  return result;
}

const pastedTextSchema = z.string().trim().min(10, "Paste a few lines of text first.").max(4000, "Paste at most 4,000 characters.");

export type ExtractReceiptResult =
  | { ok: true; suggestion: ReceiptEvidenceSuggestion }
  | { ok: false; message: string };

/** Reads pasted remittance text into suggested form values. Nothing is saved until the operator submits. */
export async function extractReceiptEvidenceAction(text: string): Promise<ExtractReceiptResult> {
  const { supabase, workspace, user } = await requireWorkspace();
  const parsed = pastedTextSchema.safeParse(text);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Paste some text first." };

  const result = await extractReceiptEvidence(parsed.data);
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: result.ok ? "ai.receipt_extracted" : "ai.receipt_extraction_failed",
    entityType: "expected_receipt",
    outcome: result.ok ? "info" : "failure",
    summary: result.ok
      ? "Claude pre-filled an expected receipt from pasted text for review. Nothing was saved."
      : `Could not read the pasted text: ${result.message}`,
    metadata: result.ok ? { model_id: result.modelId } : { failure_kind: result.kind },
  });
  if (!result.ok) return { ok: false, message: `${result.message} Fill in the form manually.` };
  return { ok: true, suggestion: result.value };
}
