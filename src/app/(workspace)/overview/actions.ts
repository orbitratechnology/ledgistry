"use server";

import { refresh } from "next/cache";

import { requireWorkspace } from "@/server/auth/session";
import { refreshBalances } from "@/server/balances/sync";

export type RefreshBalancesActionResult =
  | { ok: true; message: string; warnings: string[] }
  | { ok: false; message: string };

/** Pulls current balances from Airwallex Sandbox into a new snapshot. Authorises itself. */
export async function refreshBalancesAction(): Promise<RefreshBalancesActionResult> {
  const context = await requireWorkspace();
  const result = await refreshBalances(context);
  refresh();

  if (!result.ok) return result;
  return {
    ok: true,
    message: `Balances refreshed from Airwallex: ${result.fundedCurrencyCount} funded of ${result.currencyCount} currencies.`,
    warnings: result.issues.map((issue) => `${issue.currency}: ${issue.message}`),
  };
}
