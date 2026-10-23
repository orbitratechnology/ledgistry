import "server-only";

import { z } from "zod";

import type { AirwallexClient } from "./client";

const globalAccountSchema = z
  .object({
    id: z.string().min(1),
    nick_name: z.string().nullish(),
    account_name: z.string().nullish(),
    country_code: z.string().nullish(),
    status: z.string().nullish(),
    required_features: z
      .array(z.object({ currency: z.string().nullish() }).loose())
      .nullish(),
  })
  .loose();

const globalAccountsPageSchema = z.object({ items: z.array(globalAccountSchema) });

export type GlobalAccountSummary = {
  id: string;
  label: string;
  countryCode: string | null;
  status: string | null;
  /** Deposits simulated into this account arrive in this currency. */
  baseCurrency: string | null;
};

/** Minimal, non-sensitive view of Global Accounts (no account numbers or routing codes). */
export async function listGlobalAccounts(client: AirwallexClient): Promise<GlobalAccountSummary[]> {
  const { data } = await client.request("/api/v1/global_accounts", {
    query: { page_num: 0, page_size: 50 },
    schema: globalAccountsPageSchema,
  });
  return data.items.map((account) => ({
    id: account.id,
    label: account.nick_name || account.account_name || account.id,
    countryCode: account.country_code ?? null,
    status: account.status ?? null,
    baseCurrency: account.required_features?.[0]?.currency ?? null,
  }));
}
