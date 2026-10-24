import "server-only";

import { AirwallexError } from "@/server/airwallex/errors";

export type CreateFailure =
  /** Airwallex already has this request_id: read that transfer instead of creating one. */
  | { kind: "duplicate"; existingId: string }
  /** The request may or may not have created a transfer: resolve by request_id, never resend blindly. */
  | { kind: "unknown"; code: string }
  /** Airwallex definitively refused: nothing was created. */
  | { kind: "rejected"; code: string; message: string };

const UNKNOWN_KINDS = new Set(["timeout", "unavailable", "rate_limited", "unexpected_response"]);

/** Classifies a failed transfer create. Anything ambiguous is treated as "outcome unknown". */
export function classifyCreateFailure(error: unknown): CreateFailure {
  if (!(error instanceof AirwallexError)) return { kind: "unknown", code: "internal_error" };
  const code = error.providerCode ?? "";
  if (code === "duplicate_request_id" || code === "request_id_duplicate") {
    return error.providerDetails?.existingId
      ? { kind: "duplicate", existingId: error.providerDetails.existingId }
      : { kind: "unknown", code };
  }
  if (code === "request_pending" || UNKNOWN_KINDS.has(error.kind)) return { kind: "unknown", code: code || error.kind };
  return { kind: "rejected", code: code || error.kind, message: rejectionMessage(error) };
}

/** Operator-safe explanation of a definitive rejection (provider free text is never shown). */
function rejectionMessage(error: AirwallexError): string {
  const code = error.providerCode ?? "";
  if (code === "balance_insufficient") return "Airwallex reports an insufficient balance. Nothing was sent.";
  if (code === "validation_failed") {
    const fields = (error.providerDetails?.fieldErrors ?? []).map((field) => [field.source, field.code].filter(Boolean).join(": "));
    return `Airwallex rejected the transfer details${fields.length ? ` (${fields.join(", ")})` : ""}. Nothing was sent.`;
  }
  if (code.includes("limit")) return "The amount is outside Airwallex's limits for this transfer method. Nothing was sent.";
  if (code.includes("unsupported") || code === "currency_pair_invalid") {
    return "Airwallex does not support this currency or route. Nothing was sent.";
  }
  return `${error.safeMessage} Nothing was sent.`;
}
