"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { recordAuditEvent } from "@/server/audit/record";
import { requireWorkspace } from "@/server/auth/session";
import {
  approveAndSend,
  openPaymentReview,
  resendSameRequest,
  simulateTransferOutcome,
  verifyPayment,
  type PaymentOutcome,
  type ReviewResult,
} from "@/server/payments/service";

const idSchema = z.uuid();
const notFound = { ok: false as const, message: "Not found." };

/** Re-reads everything live and opens a fingerprinted review. Moves no money. */
export async function openPaymentReviewAction(obligationId: string): Promise<ReviewResult> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(obligationId).success) return { ...notFound, blockers: [], review: null };
  const result = await openPaymentReview(context, obligationId);
  refresh();
  return result;
}

/**
 * The explicit "Approve and send" button. Authorises itself, re-checks every precondition on the
 * server and consumes the review once; nothing from the browser decides the amount or payee.
 */
export async function approveAndSendAction(approvalId: string): Promise<PaymentOutcome> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(approvalId).success) return notFound;
  const result = await approveAndSend(context, approvalId);
  refresh();
  return result;
}

export async function cancelPaymentReviewAction(approvalId: string): Promise<{ ok: boolean; message: string }> {
  const { supabase, workspace, user } = await requireWorkspace();
  if (!idSchema.safeParse(approvalId).success) return notFound;
  const { data } = await supabase
    .from("payment_approvals")
    .update({ status: "rejected", status_reason: "Closed by the operator without approving." })
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (data) {
    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "payment.review_closed",
      entityType: "payment_approval",
      entityId: approvalId,
      outcome: "info",
      summary: "Closed a payment review without approving it. Nothing was sent.",
    });
  }
  refresh();
  return { ok: true, message: "Review closed. Nothing was sent." };
}

export async function verifyPaymentAction(operationId: string): Promise<PaymentOutcome> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(operationId).success) return notFound;
  const result = await verifyPayment(context, operationId);
  refresh();
  return result;
}

export async function resendPaymentAction(operationId: string): Promise<PaymentOutcome> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(operationId).success) return notFound;
  const result = await resendSameRequest(context, operationId);
  refresh();
  return result;
}

/** Sandbox only: Airwallex moves the transfer; Ledgistry reads the result back. */
export async function simulateTransferAction(operationId: string, target: "PAID" | "FAILED"): Promise<PaymentOutcome> {
  const context = await requireWorkspace();
  if (!idSchema.safeParse(operationId).success || (target !== "PAID" && target !== "FAILED")) return notFound;
  const result = await simulateTransferOutcome(context, operationId, target);
  refresh();
  return result;
}
