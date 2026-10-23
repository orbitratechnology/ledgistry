import "server-only";

import { cache } from "react";

import type { BeneficiaryOptions } from "@/components/obligations/obligation-sheet";
import { listBeneficiaries } from "@/server/airwallex/beneficiaries";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";

/** Payee options for obligation forms. Never rejects: failures become a readable message. */
export const getBeneficiaryOptions = cache(async (): Promise<BeneficiaryOptions> => {
  try {
    const items = await listBeneficiaries(getAirwallexClient());
    return {
      ok: true,
      items: items.map((item) => ({ id: item.id, label: item.label, currency: item.currency })),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AirwallexError
          ? `Beneficiaries could not be loaded: ${error.safeMessage}`
          : "Beneficiaries could not be loaded right now.",
    };
  }
});
