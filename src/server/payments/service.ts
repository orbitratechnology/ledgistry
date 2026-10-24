import "server-only";

import type { Json } from "@/lib/db/database.types";
import { minorToDecimalString } from "@/lib/money";
import { APPROVAL_TTL_MINUTES, type GateBlocker } from "@/lib/payments/approval";
import { isTerminalPaymentStatus, mapProviderStatus, type PaymentStatus } from "@/lib/payments/status";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";
import {
  createTransfer,
  findTransferByRequestId,
  getTransfer,
  simulateTransferTransition,
  simulationSteps,
  validateTransfer,
  type ProviderTransfer,
  type TransferRequest,
} from "@/server/airwallex/transfers";
import { refreshBalances } from "@/server/balances/sync";
import { recalculatePlans } from "@/server/planner/recalculate";
import { classifyCreateFailure } from "./create-outcome";
import { gatherPaymentFacts, loadPayableObligation, sandboxTransfersAllowed, type PaymentReview } from "./facts";
import { getPaymentOperation, type PaymentOperationView } from "./queries";

export type ReviewResult =
  | { ok: true; approvalId: string; expiresAt: string; review: PaymentReview }
  | { ok: false; message: string; blockers: GateBlocker[]; review: PaymentReview | null };

export type PaymentOutcome = { ok: boolean; message: string; status?: PaymentStatus };

const actor = (context: WorkspaceContext) => ({ type: "user" as const, userId: context.user.id });

/** Opens a review: live balance, fresh plan, beneficiary and Airwallex validation, then a fingerprinted approval. */
export async function openPaymentReview(context: WorkspaceContext, obligationId: string): Promise<ReviewResult> {
  const obligation = await loadPayableObligation(context, obligationId);
  if (!obligation) return { ok: false, message: "Obligation not found.", blockers: [], review: null };

  const facts = await gatherPaymentFacts(context, obligation);
  const blockers = [...facts.blockers];

  if (blockers.length === 0 && facts.intent) {
    try {
      const validation = await validateTransfer(getAirwallexClient(), {
        requestId: `ledgistry-check-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
        beneficiaryId: facts.intent.beneficiaryId,
        currency: facts.intent.currency,
        amount: minorToDecimalString(facts.intent.amountMinor, obligation.exponent),
        transferMethod: facts.intent.transferMethod,
        reference: facts.intent.reference,
      });
      if (!validation.ok) {
        blockers.push({
          code: "provider_validation",
          message: `Airwallex would reject these transfer details${validation.fields.length ? ` (${validation.fields.join(", ")})` : ""}.`,
        });
      }
    } catch (error) {
      blockers.push({
        code: "provider_validation",
        message: `Could not validate the transfer with Airwallex: ${error instanceof AirwallexError ? error.safeMessage : "unexpected error"}`,
      });
    }
  }

  if (blockers.length > 0 || !facts.intent || !facts.fingerprint) {
    await recordAuditEvent(context.supabase, {
      workspaceId: context.workspace.id,
      actor: actor(context),
      eventType: "payment.review_blocked",
      entityType: "obligation",
      entityId: obligation.id,
      outcome: "info",
      summary: `Payment of ${facts.review.amount} to ${obligation.payeeName} cannot be approved: ${blockers[0]?.message ?? "missing payment details."}`,
      metadata: { blockers: blockers.map((blocker) => blocker.code) },
    });
    return { ok: false, message: blockers[0]?.message ?? "This payment cannot be approved yet.", blockers, review: facts.review };
  }

  const { data, error } = await context.supabase.rpc("open_payment_review", {
    p_obligation_id: obligation.id,
    p_fingerprint: facts.fingerprint,
    p_transfer_method: facts.intent.transferMethod,
    p_reference: facts.intent.reference,
    p_plan_id: facts.planId,
    p_balance_snapshot_id: facts.balanceSnapshotId,
    p_policy_snapshot: {
      reserve_minor: facts.intent.reserveMinor.toString(),
      reserve_enabled: facts.intent.reserveEnabled,
    },
    p_review_snapshot: facts.review as unknown as Json,
    p_ttl_minutes: APPROVAL_TTL_MINUTES,
  });
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Could not open the review.", blockers: [], review: facts.review };
  }
  await recordAuditEvent(context.supabase, {
    workspaceId: context.workspace.id,
    actor: actor(context),
    eventType: "payment.review_opened",
    entityType: "payment_approval",
    entityId: data.id,
    outcome: "info",
    summary: `Opened a review of ${facts.review.amount} to ${obligation.payeeName}; it expires in ${APPROVAL_TTL_MINUTES} minutes unless approved.`,
    metadata: { obligation_id: obligation.id, fingerprint: facts.fingerprint },
  });
  return { ok: true, approvalId: data.id, expiresAt: data.expires_at, review: facts.review };
}

async function recordProgress(
  context: WorkspaceContext,
  operationId: string,
  update: {
    status: PaymentStatus;
    source: "create" | "verify" | "lookup" | "simulation";
    transfer?: ProviderTransfer | null;
    failureCode?: string | null;
    summary?: string | null;
  },
): Promise<PaymentStatus | null> {
  const { transfer } = update;
  const { data, error } = await context.supabase.rpc("record_payment_progress", {
    p_operation_id: operationId,
    p_status: update.status,
    p_provider_transfer_id: transfer?.id ?? null,
    p_provider_status: transfer?.status ?? null,
    p_fee_minor: transfer?.feeMinor === null || transfer?.feeMinor === undefined ? null : Number(transfer.feeMinor),
    p_fee_currency: transfer?.feeCurrency ?? null,
    p_failure_code: update.failureCode ?? transfer?.failureCode ?? null,
    p_safe_summary: update.summary ?? null,
    p_source: update.source,
  });
  if (error || !data) {
    console.error("[payments] could not record progress", error?.code);
    return null;
  }
  return data.status as PaymentStatus;
}

const OUTCOME_UNKNOWN =
  "Outcome unknown — verification required. Ledgistry will look the transfer up by its request id; it will not send a new one.";

/**
 * Sends a prepared operation's request once and records the result. A lost response is never
 * retried with a new request id: it is resolved by request id lookup.
 */
async function sendRequest(context: WorkspaceContext, operationId: string, request: TransferRequest): Promise<PaymentStatus | null> {
  const client = getAirwallexClient();
  try {
    const transfer = await createTransfer(client, request);
    return recordProgress(context, operationId, { status: mapProviderStatus(transfer.status), source: "create", transfer });
  } catch (error) {
    const failure = classifyCreateFailure(error);
    if (failure.kind === "duplicate") {
      const existing = await getTransfer(client, failure.existingId).catch(() => null);
      if (existing) return recordProgress(context, operationId, { status: mapProviderStatus(existing.status), source: "lookup", transfer: existing });
    }
    if (failure.kind === "rejected") {
      return recordProgress(context, operationId, {
        status: "failed",
        source: "create",
        failureCode: failure.code,
        summary: failure.message,
      });
    }
    await recordProgress(context, operationId, {
      status: "verification_required",
      source: "create",
      failureCode: failure.kind === "unknown" ? failure.code : "duplicate_request_id",
      summary: OUTCOME_UNKNOWN,
    });
    const found = await findTransferByRequestId(client, request.requestId).catch(() => null);
    if (found) return recordProgress(context, operationId, { status: mapProviderStatus(found.status), source: "lookup", transfer: found });
    return "verification_required";
  }
}

async function afterProviderChange(context: WorkspaceContext) {
  await refreshBalances(context);
  await recalculatePlans(context, "payment_update");
}

function outcomeMessage(status: PaymentStatus | null, operation: PaymentOperationView | null): PaymentOutcome {
  if (!status) return { ok: false, message: "The provider answered, but Ledgistry could not record it. Check the status." };
  const messages: Record<PaymentStatus, string> = {
    prepared: "Prepared; not yet sent.",
    submitted: "Sent to Airwallex Sandbox.",
    pending: `Sent to Airwallex Sandbox; Airwallex reports ${operation?.lastProviderStatus ?? "it as in progress"}. Not paid yet.`,
    completed: "Airwallex reports the transfer as PAID.",
    failed: operation?.safeErrorSummary ?? "Airwallex reports the transfer as failed.",
    cancelled: "Airwallex reports the transfer as cancelled.",
    verification_required: OUTCOME_UNKNOWN,
    unknown: `Airwallex returned a status Ledgistry does not recognise (${operation?.lastProviderStatus ?? "none"}).`,
  };
  return { ok: status !== "failed" && status !== "cancelled", message: messages[status], status };
}

/**
 * The only path that moves money: re-checks everything with a live balance, consumes the review
 * exactly once (fingerprint must still match), persists the request id, then sends once.
 */
export async function approveAndSend(context: WorkspaceContext, approvalId: string): Promise<PaymentOutcome> {
  const { supabase } = context;
  const { data: approval } = await supabase
    .from("payment_approvals")
    .select("id, obligation_id, status")
    .eq("id", approvalId)
    .maybeSingle();
  if (!approval) return { ok: false, message: "This review no longer exists." };
  if (approval.status !== "pending") return { ok: false, message: `This review is already ${approval.status}. Open a new one.` };

  const obligation = await loadPayableObligation(context, approval.obligation_id);
  if (!obligation) return { ok: false, message: "Obligation not found." };
  const facts = await gatherPaymentFacts(context, obligation);

  const refuse = async (message: string, code: string) => {
    await recordAuditEvent(supabase, {
      workspaceId: context.workspace.id,
      actor: actor(context),
      eventType: "payment.approval_refused",
      entityType: "payment_approval",
      entityId: approvalId,
      outcome: "failure",
      summary: `Approval of ${facts.review.amount} to ${obligation.payeeName} refused before sending: ${message}`,
      metadata: { code },
    });
    return { ok: false, message };
  };

  if (facts.blockers.length > 0 || !facts.fingerprint || !facts.intent) {
    const message = facts.blockers[0]?.message ?? "Payment details are incomplete.";
    await supabase
      .from("payment_approvals")
      .update({ status: "invalidated", status_reason: message.slice(0, 300) })
      .eq("id", approvalId)
      .eq("status", "pending");
    return refuse(message, facts.blockers[0]?.code ?? "incomplete");
  }

  const { data: decision, error } = await supabase.rpc("approve_payment", {
    p_approval_id: approvalId,
    p_fingerprint: facts.fingerprint,
  });
  const result = decision?.[0];
  if (error || !result) return refuse("The approval could not be recorded.", "approve_error");
  if (result.outcome !== "prepared" || !result.operation_id || !result.request_id) {
    return refuse(result.message, result.outcome);
  }

  const status = await sendRequest(context, result.operation_id, {
    requestId: result.request_id,
    beneficiaryId: facts.intent.beneficiaryId,
    currency: facts.intent.currency,
    amount: minorToDecimalString(facts.intent.amountMinor, obligation.exponent),
    transferMethod: facts.intent.transferMethod,
    reference: facts.intent.reference,
  });

  // Verify against the transfer-detail endpoint straight away (PRD §8.7).
  let finalStatus = status;
  const operation = await getPaymentOperation(context, result.operation_id);
  if (operation?.providerTransferId && status && !isTerminalPaymentStatus(status)) {
    finalStatus = (await verifyPayment(context, result.operation_id, { refresh: false })).status ?? status;
  }
  await afterProviderChange(context);
  return outcomeMessage(finalStatus, await getPaymentOperation(context, result.operation_id));
}

/** Reads the provider's current state: by transfer id, or by request id when the outcome is unknown. */
export async function verifyPayment(
  context: WorkspaceContext,
  operationId: string,
  { refresh = true }: { refresh?: boolean } = {},
): Promise<PaymentOutcome> {
  const operation = await getPaymentOperation(context, operationId);
  if (!operation) return { ok: false, message: "Payment not found." };
  const client = getAirwallexClient();
  try {
    let status: PaymentStatus | null;
    if (operation.providerTransferId) {
      const transfer = await getTransfer(client, operation.providerTransferId);
      status = await recordProgress(context, operationId, { status: mapProviderStatus(transfer.status), source: "verify", transfer });
    } else {
      const found = await findTransferByRequestId(client, operation.providerRequestId);
      if (!found) {
        return {
          ok: true,
          status: operation.status,
          message: `Airwallex has no transfer with request id ${operation.providerRequestId} yet. Nothing was paid under it so far.`,
        };
      }
      status = await recordProgress(context, operationId, { status: mapProviderStatus(found.status), source: "lookup", transfer: found });
    }
    if (refresh) await afterProviderChange(context);
    return outcomeMessage(status, await getPaymentOperation(context, operationId));
  } catch (error) {
    const message = error instanceof AirwallexError ? error.safeMessage : "Could not check the transfer.";
    await recordAuditEvent(context.supabase, {
      workspaceId: context.workspace.id,
      actor: actor(context),
      eventType: "payment.verification_failed",
      entityType: "payment_operation",
      entityId: operationId,
      outcome: "failure",
      summary: `Could not check the payment with Airwallex: ${message} The recorded status is unchanged.`,
      metadata: { error_kind: error instanceof AirwallexError ? error.kind : "internal_error" },
    });
    return { ok: false, message: `${message} The recorded status is unchanged.` };
  }
}

/**
 * For an unknown outcome that Airwallex still has no record of: re-sends the *same* request id
 * (a duplicate is answered with the original transfer), after re-checking the reserve live.
 */
export async function resendSameRequest(context: WorkspaceContext, operationId: string): Promise<PaymentOutcome> {
  const operation = await getPaymentOperation(context, operationId);
  if (!operation) return { ok: false, message: "Payment not found." };
  if (operation.status !== "verification_required" || operation.providerTransferId) {
    return { ok: false, message: "Only a payment whose outcome is unknown can be resent." };
  }
  if (Date.now() - Date.parse(operation.requestStartedAt) < 60_000) {
    return { ok: false, message: "Wait a minute for Airwallex to list the transfer, then check again." };
  }
  if (!sandboxTransfersAllowed()) return { ok: false, message: "Transfers are only sent to Airwallex Sandbox in this MVP." };

  const lookup = await verifyPayment(context, operationId, { refresh: false });
  const current = await getPaymentOperation(context, operationId);
  if (current?.providerTransferId) return lookup;

  // The obligation is in progress under this very request, so only the cash checks apply here.
  const obligation = await loadPayableObligation(context, operation.obligationId);
  if (!obligation) return { ok: false, message: "Obligation not found." };
  const facts = await gatherPaymentFacts(context, { ...obligation, status: "planned" });
  const reserveBlocker = facts.blockers.find((blocker) => ["reserve", "no_balance", "stale_balance", "not_sandbox"].includes(blocker.code));
  if (reserveBlocker) return { ok: false, message: `Not resent: ${reserveBlocker.message}` };

  const status = await sendRequest(context, operationId, {
    requestId: operation.providerRequestId,
    beneficiaryId: operation.beneficiaryId,
    currency: operation.currency,
    amount: minorToDecimalString(operation.amountMinor, operation.exponent),
    transferMethod: operation.transferMethod,
    reference: operation.reference,
  });
  await afterProviderChange(context);
  return outcomeMessage(status, await getPaymentOperation(context, operationId));
}

/**
 * Sandbox only: asks Airwallex to move the transfer to PAID or FAILED one documented step at a
 * time, then reads the provider's status back. Ledgistry never writes a provider status itself.
 */
export async function simulateTransferOutcome(
  context: WorkspaceContext,
  operationId: string,
  target: "PAID" | "FAILED",
): Promise<PaymentOutcome> {
  if (!sandboxTransfersAllowed()) return { ok: false, message: "Simulation is only available against Airwallex Sandbox." };
  const operation = await getPaymentOperation(context, operationId);
  if (!operation?.providerTransferId) return { ok: false, message: "This payment has no Airwallex transfer yet." };
  const client = getAirwallexClient();
  try {
    const current = await getTransfer(client, operation.providerTransferId);
    const steps = simulationSteps(current.status, target);
    if (steps.length === 0) {
      return { ok: false, message: `Airwallex reports ${current.status}; it cannot be moved to ${target} from there.` };
    }
    for (const step of steps) await simulateTransferTransition(client, operation.providerTransferId, step);
    const transfer = await getTransfer(client, operation.providerTransferId);
    await recordAuditEvent(context.supabase, {
      workspaceId: context.workspace.id,
      actor: actor(context),
      eventType: "sandbox.transfer_simulated",
      entityType: "payment_operation",
      entityId: operationId,
      outcome: "info",
      summary: `Asked Airwallex Sandbox to move the transfer ${steps.join(" → ")} (simulation, not a real payment). Airwallex now reports ${transfer.status}.`,
      metadata: { transfer_id: transfer.id, steps, provider_status: transfer.status },
    });
    const status = await recordProgress(context, operationId, { status: mapProviderStatus(transfer.status), source: "simulation", transfer });
    await afterProviderChange(context);
    return outcomeMessage(status, await getPaymentOperation(context, operationId));
  } catch (error) {
    return { ok: false, message: error instanceof AirwallexError ? error.safeMessage : "The sandbox simulation failed." };
  }
}
