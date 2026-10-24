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

/** Mirrors the database guard (payment_operations_guard); the database remains authoritative. */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  prepared: ["submitted", "verification_required", "failed"],
  submitted: ["pending", "completed", "failed", "cancelled", "verification_required", "unknown"],
  verification_required: ["submitted", "pending", "completed", "failed", "cancelled", "unknown"],
  pending: ["completed", "failed", "cancelled", "verification_required", "unknown"],
  unknown: ["pending", "completed", "failed", "cancelled", "verification_required"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
