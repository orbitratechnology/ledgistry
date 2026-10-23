import "server-only";

import { z } from "zod";

import { currencyExponent, decimalToMinor, MoneyPrecisionError } from "@/lib/money";
import type { AirwallexClient } from "./client";

/** GET /api/v1/deposits item (fields we rely on; extra fields tolerated). */
const depositSchema = z
  .object({
    id: z.string().min(1),
    amount: z.number(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.string().min(1),
    type: z.string().nullish(),
    reference: z.string().nullish(),
    provider_transaction_id: z.string().nullish(),
    global_account_id: z.string().nullish(),
    created_at: z.string().nullish(),
    settled_at: z.string().nullish(),
    payer: z.object({ name: z.string().nullish() }).loose().nullish(),
  })
  .loose();

const depositPageSchema = z.object({
  items: z.array(depositSchema),
  has_more: z.boolean().nullish(),
});

export type ProviderDeposit = z.infer<typeof depositSchema>;

/** Row shape accepted by the `upsert_provider_transactions` RPC (amounts as integers). */
export type ProviderTransactionRow = {
  provider_transaction_id: string;
  source_kind: "deposit";
  global_account_id: string | null;
  provider_reference: string | null;
  statement_reference: string | null;
  direction: "credit";
  amount_minor: number;
  currency: string;
  provider_status: string;
  provider_type: string | null;
  counterparty_name: string | null;
  occurred_at: string | null;
  is_sandbox_simulation: boolean;
  raw_sanitized: Record<string, string | number | null>;
};

export type DepositNormalizationIssue = { depositId: string; message: string };

/**
 * Maps deposits to evidence rows. Only non-sensitive fields are kept: payer bank account
 * details are deliberately dropped (PRD §15 least data retention).
 */
export function normalizeDeposits(
  deposits: ProviderDeposit[],
  simulatedIds: Set<string>,
): { rows: ProviderTransactionRow[]; issues: DepositNormalizationIssue[] } {
  const rows: ProviderTransactionRow[] = [];
  const issues: DepositNormalizationIssue[] = [];

  for (const deposit of deposits) {
    try {
      const minor = decimalToMinor(deposit.amount, currencyExponent(deposit.currency));
      if (minor < 0n || !Number.isSafeInteger(Number(minor))) {
        throw new MoneyPrecisionError("Deposit amount is outside the supported range");
      }
      const payerName = deposit.payer?.name?.trim() || null;
      rows.push({
        provider_transaction_id: deposit.id,
        source_kind: "deposit",
        global_account_id: deposit.global_account_id ?? null,
        provider_reference: deposit.reference?.trim() || null,
        statement_reference: deposit.provider_transaction_id ?? null,
        direction: "credit",
        amount_minor: Number(minor),
        currency: deposit.currency,
        provider_status: deposit.status.toUpperCase(),
        provider_type: deposit.type ?? null,
        counterparty_name: payerName,
        occurred_at: deposit.settled_at ?? deposit.created_at ?? null,
        is_sandbox_simulation: simulatedIds.has(deposit.id),
        raw_sanitized: {
          id: deposit.id,
          type: deposit.type ?? null,
          status: deposit.status,
          amount: deposit.amount,
          currency: deposit.currency,
          reference: deposit.reference ?? null,
          payer_name: payerName,
          created_at: deposit.created_at ?? null,
          settled_at: deposit.settled_at ?? null,
        },
      });
    } catch (error) {
      if (!(error instanceof MoneyPrecisionError || error instanceof RangeError)) throw error;
      issues.push({ depositId: deposit.id, message: error.message });
    }
  }
  return { rows, issues };
}

const PAGE_SIZE = 100;
const MAX_PAGES_PER_WINDOW = 10;
/** The Deposits API rejects ranges over 31 days and ignores `from` without `to`. */
export const MAX_WINDOW_DAYS = 30;

/** Splits [since, until] into consecutive windows of at most `maxDays`, newest first. */
export function dateWindows(since: Date, until: Date, maxDays = MAX_WINDOW_DAYS): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  const span = maxDays * 86_400_000;
  for (let to = until.getTime(); to > since.getTime(); to -= span) {
    windows.push({ from: new Date(Math.max(since.getTime(), to - span)), to: new Date(to) });
  }
  return windows;
}

/** Reads deposits created in [since, until], window by window, de-duplicated by id. */
export async function fetchDeposits(client: AirwallexClient, since: Date, until = new Date()) {
  const byId = new Map<string, ProviderDeposit>();
  let correlationId: string | null = null;
  let truncated = false;

  for (const window of dateWindows(since, until)) {
    for (let page = 0; page < MAX_PAGES_PER_WINDOW; page += 1) {
      const result = await client.request("/api/v1/deposits", {
        query: {
          page_num: page,
          page_size: PAGE_SIZE,
          from_created_at: window.from.toISOString(),
          to_created_at: window.to.toISOString(),
        },
        schema: depositPageSchema,
      });
      correlationId ??= result.correlationId;
      for (const deposit of result.data.items) byId.set(deposit.id, deposit);
      if (!result.data.has_more) break;
      if (page === MAX_PAGES_PER_WINDOW - 1) truncated = true;
    }
  }
  return { deposits: [...byId.values()], correlationId, truncated };
}
