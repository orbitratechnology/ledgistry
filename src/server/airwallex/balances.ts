import "server-only";

import { z } from "zod";

import { currencyExponent, decimalToMinor, MoneyPrecisionError } from "@/lib/money";
import type { AirwallexClient } from "./client";

const amount = z.number().nullish();

/** GET /api/v1/balances/current — every field is optional in the published schema. */
export const currentBalancesSchema = z.array(
  z
    .object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      account_type: z.string().nullish(),
      available_amount: amount,
      pending_amount: amount,
      reserved_amount: amount,
      total_amount: amount,
      prepayment_amount: amount,
    })
    .loose(),
);

export type ProviderBalance = z.infer<typeof currentBalancesSchema>[number];

export type NormalizedBalance = {
  currency: string;
  exponent: number;
  accountType: string;
  /** null = the provider did not return this component (shown as "Unavailable", never 0). */
  availableMinor: bigint | null;
  pendingMinor: bigint | null;
  reservedMinor: bigint | null;
  totalMinor: bigint | null;
  prepaymentMinor: bigint | null;
};

export type BalanceNormalizationIssue = { currency: string; message: string };

const toMinor = (value: number | null | undefined, exponent: number) =>
  value === null || value === undefined ? null : decimalToMinor(value, exponent);

/**
 * Converts provider decimals to exact minor units. A currency whose amounts cannot be
 * represented exactly is reported as an issue instead of being rounded or dropped silently.
 */
export function normalizeBalances(rows: ProviderBalance[]): {
  balances: NormalizedBalance[];
  issues: BalanceNormalizationIssue[];
} {
  const balances: NormalizedBalance[] = [];
  const issues: BalanceNormalizationIssue[] = [];

  for (const row of rows) {
    try {
      const exponent = currencyExponent(row.currency);
      balances.push({
        currency: row.currency,
        exponent,
        accountType: (row.account_type ?? "cash").toLowerCase(),
        availableMinor: toMinor(row.available_amount, exponent),
        pendingMinor: toMinor(row.pending_amount, exponent),
        reservedMinor: toMinor(row.reserved_amount, exponent),
        totalMinor: toMinor(row.total_amount, exponent),
        prepaymentMinor: toMinor(row.prepayment_amount, exponent),
      });
    } catch (error) {
      if (!(error instanceof MoneyPrecisionError || error instanceof RangeError)) throw error;
      issues.push({ currency: row.currency, message: error.message });
    }
  }

  balances.sort((a, b) => a.currency.localeCompare(b.currency));
  return { balances, issues };
}

export async function fetchCurrentBalances(client: AirwallexClient) {
  const { data, correlationId } = await client.request("/api/v1/balances/current", {
    schema: currentBalancesSchema,
  });
  return { ...normalizeBalances(data), correlationId, fetchedAt: new Date() };
}
