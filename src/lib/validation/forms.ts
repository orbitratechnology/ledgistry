import { z } from "zod";

import {
  OBLIGATION_PRIORITIES,
  OPERATOR_OBLIGATION_STATUSES,
} from "@/lib/finance/states";
import { currencyExponent, isCurrencyCode, parseAmountInput } from "@/lib/money";

/** Currencies offered in forms (Airwallex-supported majors); any ISO code is still validated. */
export const FORM_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "HKD",
  "CNY",
  "AUD",
  "SGD",
  "JPY",
  "CAD",
  "CHF",
  "NZD",
] as const;

export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so the form keeps them after a failed submit. */
  values?: Record<string, string>;
  /**
   * Incremented on every response. Forms key their fields on it: React resets uncontrolled
   * fields after an action, and remounting restores *all* of them (selects included) from `values`.
   */
  attempt?: number;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((value) => value || null);

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, "Choose a supported ISO currency.");

/** Adds an `amountMinor` bigint parsed exactly for the chosen currency. */
function withAmount<T extends { amount: string; currency: string }>(
  value: T,
  ctx: z.RefinementCtx,
): (T & { amountMinor: bigint }) | typeof z.NEVER {
  if (!isCurrencyCode(value.currency)) return z.NEVER;
  const parsed = parseAmountInput(value.amount, currencyExponent(value.currency));
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: parsed.error });
    return z.NEVER;
  }
  return { ...value, amountMinor: parsed.minor };
}

export const obligationFormSchema = z
  .object({
    payeeName: z.string().trim().min(1, "Enter who is being paid.").max(140),
    description: z.string().trim().min(1, "Describe what this pays for.").max(500),
    invoiceReference: optionalText(140),
    amount: z.string(),
    currency,
    dueDate: z.iso.date("Enter a valid due date."),
    priority: z.enum(OBLIGATION_PRIORITIES, "Choose a priority."),
    status: z.enum(OPERATOR_OBLIGATION_STATUSES, "Choose a status."),
    beneficiaryId: optionalText(100),
    notes: optionalText(2000),
  })
  .transform(withAmount);

export type ObligationFormValues = z.output<typeof obligationFormSchema>;

export const receiptFormSchema = z
  .object({
    payerName: z.string().trim().min(1, "Enter who is paying.").max(140),
    reference: z.string().trim().min(3, "Use a reference of at least 3 characters.").max(140),
    amount: z.string(),
    currency,
    expectedDate: z.iso.date("Enter a valid expected date."),
    notes: optionalText(2000),
  })
  .transform(withAmount);

export type ReceiptFormValues = z.output<typeof receiptFormSchema>;

/** A protected reserve per currency. Switching protection off is a separate, confirmed action. */
export const reserveFormSchema = z
  .object({
    currency,
    amount: z.string(),
  })
  .transform(withAmount);

export const simulateDepositSchema = z
  .object({
    globalAccountId: z.uuid("Choose a Global Account."),
    currency,
    amount: z.string(),
    payerName: z.string().trim().min(1, "Enter a payer name.").max(140),
    reference: z.string().trim().min(1, "Enter a reference.").max(140),
  })
  .transform(withAmount);

/** Flattens Zod issues to one message per top-level field. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}
