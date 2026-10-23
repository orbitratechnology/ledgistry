/**
 * Plans are stored as JSON (bigint amounts as integer strings) and parsed back through a Zod
 * schema, so a stored snapshot is always read with exact amounts and a known shape.
 */

import { z } from "zod";

import { OBLIGATION_PRIORITIES, OBLIGATION_STATUSES } from "@/lib/finance/states";
import type { PlanResult } from "./plan";

const minor = z
  .string()
  .regex(/^-?\d{1,19}$/)
  .transform((value) => BigInt(value));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const itemSchema = z.object({
  rank: z.number().int().positive(),
  obligationId: z.string(),
  obligationVersion: z.number().int(),
  payeeName: z.string(),
  description: z.string().nullable(),
  invoiceReference: z.string().nullable(),
  amountMinor: minor,
  dueDate: isoDate,
  daysUntilDue: z.number().int(),
  overdue: z.boolean(),
  priority: z.enum(OBLIGATION_PRIORITIES),
  hasPaymentDetails: z.boolean(),
  beneficiaryLabel: z.string().nullable(),
  isDemo: z.boolean(),
  decision: z.enum(["recommended", "needs_details", "deferred", "blocked"]),
  reasonCode: z.enum(["fits_above_reserve", "missing_payment_details", "exceeds_headroom", "below_reserve_already", "no_balance"]),
  reason: z.string(),
  availableBeforeMinor: minor.nullable(),
  availableAfterMinor: minor.nullable(),
  headroomAfterMinor: minor.nullable(),
});

const planResultSchema = z.object({
  ruleVersion: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exponent: z.number().int().min(0).max(4),
  today: isoDate,
  status: z.enum(["ok", "no_balance", "nothing_to_plan"]),
  balance: z
    .object({ snapshotId: z.string(), availableMinor: minor.nullable(), fetchedAt: z.string() })
    .nullable(),
  reserveMinor: minor,
  reserveEnabled: z.boolean(),
  summary: z.object({
    availableMinor: minor.nullable(),
    spendableNowMinor: minor,
    recommendedCount: z.number().int(),
    recommendedTotalMinor: minor,
    heldForDetailsMinor: minor,
    deferredCount: z.number().int(),
    deferredTotalMinor: minor,
    availableAfterPlanMinor: minor.nullable(),
    headroomAfterPlanMinor: minor.nullable(),
  }),
  items: z.array(itemSchema),
  excluded: z.array(
    z.object({
      obligationId: z.string(),
      payeeName: z.string(),
      amountMinor: minor,
      dueDate: isoDate,
      status: z.enum(OBLIGATION_STATUSES),
      reason: z.string(),
      isDemo: z.boolean(),
    }),
  ),
  forecast: z
    .object({
      horizonDays: z.number().int(),
      receipts: z.array(
        z.object({
          id: z.string(),
          payerName: z.string(),
          reference: z.string(),
          outstandingMinor: minor,
          expectedDate: isoDate,
          isDemo: z.boolean(),
          overdue: z.boolean(),
        }),
      ),
      totalMinor: minor,
      outcomes: z.array(z.object({ obligationId: z.string(), fits: z.boolean(), availableAfterMinor: minor })),
    })
    .nullable(),
  warnings: z.array(
    z.object({
      code: z.enum(["no_reserve", "reserve_disabled", "below_reserve", "no_balance", "partial_not_planned"]),
      message: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
  rules: z.array(z.string()),
});

/** JSON-safe copy of a plan: every bigint becomes its exact decimal string. */
export function serializePlan(plan: PlanResult): unknown {
  return JSON.parse(JSON.stringify(plan, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

/** Parses a stored plan; returns null for anything that does not match the current shape. */
export function parseStoredPlan(value: unknown): PlanResult | null {
  const parsed = planResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
