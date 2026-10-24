/**
 * Internal payment states (PRD §8.7). "Completed" is only ever reached from a provider status
 * read back from Airwallex, never from the fact that a create call returned successfully.
 */

export const PAYMENT_STATUSES = [
  "prepared",
  "submitted",
  "verification_required",
  "pending",
  "completed",
  "failed",
  "cancelled",
  "unknown",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  prepared: "Prepared",
  submitted: "Submitted",
  verification_required: "Outcome unknown — verification required",
  pending: "Pending at Airwallex",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unrecognised provider status",
};

export const ACTIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "prepared",
  "submitted",
  "verification_required",
  "pending",
  "unknown",
];

export const isTerminalPaymentStatus = (status: PaymentStatus) =>
  status === "completed" || status === "failed" || status === "cancelled";

/**
 * Mirrors the database guard (payment_operations_guard); the database remains authoritative.
 * Airwallex can still fail a PAID transfer (the receiving bank returns it), and a FAILED transfer
 * becomes CANCELLED, so those moves stay possible.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  prepared: ["submitted", "pending", "completed", "failed", "cancelled", "verification_required", "unknown"],
  submitted: ["pending", "completed", "failed", "cancelled", "verification_required", "unknown"],
  verification_required: ["submitted", "pending", "completed", "failed", "cancelled", "unknown"],
  pending: ["completed", "failed", "cancelled", "verification_required", "unknown"],
  unknown: ["pending", "completed", "failed", "cancelled", "verification_required"],
  completed: ["failed", "cancelled"],
  failed: ["cancelled"],
  cancelled: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Airwallex transfer statuses (API 2026-08-21) mapped to what Ledgistry shows. */
export function mapProviderStatus(status: string | null | undefined): PaymentStatus {
  switch ((status ?? "").toUpperCase()) {
    case "PAID":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
    case "APPROVAL_RECALLED":
    case "APPROVAL_REJECTED":
    case "APPROVAL_BLOCKED":
      return "cancelled";
    case "IN_APPROVAL":
    case "SCHEDULED":
    case "PROCESSING":
    case "SENT":
    case "OVERDUE":
      return "pending";
    default:
      return "unknown";
  }
}

/** What each provider status means for the operator. */
export const PROVIDER_STATUS_NOTE: Record<string, string> = {
  SCHEDULED: "Accepted by Airwallex and waiting to be processed.",
  PROCESSING: "Airwallex is processing the transfer.",
  SENT: "The money has left Airwallex; waiting for the banking partner to confirm.",
  PAID: "Airwallex reports the transfer as paid. The receiving bank can still return it.",
  FAILED: "Airwallex reports the transfer as failed; funds (less fees) return to the wallet.",
  CANCELLED: "The transfer was cancelled and will not be paid.",
  OVERDUE: "The transfer was not funded by its date.",
  IN_APPROVAL: "Waiting for approval inside Airwallex.",
};
