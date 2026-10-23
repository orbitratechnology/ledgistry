import "server-only";

import { cache } from "react";

import type { GlobalAccountOptions } from "@/components/reconciliation/simulate-deposit-sheet";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";
import { listGlobalAccounts } from "@/server/airwallex/global-accounts";

/** Global Accounts for the sandbox deposit simulator. Never rejects. */
export const getGlobalAccountOptions = cache(async (): Promise<GlobalAccountOptions> => {
  try {
    const accounts = await listGlobalAccounts(getAirwallexClient());
    return {
      ok: true,
      items: accounts.map((account) => ({
        id: account.id,
        label: account.label,
        currency: account.baseCurrency,
        status: account.status,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AirwallexError
          ? `Global Accounts could not be loaded: ${error.safeMessage}`
          : "Global Accounts could not be loaded right now.",
    };
  }
});
