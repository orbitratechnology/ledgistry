import "server-only";

import { z } from "zod";

import type { AirwallexClient } from "./client";
import { AirwallexError } from "./errors";

const simulatedDepositSchema = z
  .object({
    id: z.string().min(1),
    amount: z.number(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.string().nullish(),
    reference: z.string().nullish(),
    payer_name: z.string().nullish(),
  })
  .loose();

export type SimulatedDeposit = z.infer<typeof simulatedDepositSchema>;

/**
 * POST /api/v1/simulation/deposit/create — sandbox only. The deposit lands in the Global
 * Account's base currency. Refused outright unless the client targets the sandbox host.
 */
export async function simulateDeposit(
  client: AirwallexClient,
  input: {
    globalAccountId: string;
    /** Decimal string already validated for the account currency, e.g. "4500.00". */
    amount: string;
    payerName: string;
    reference: string;
  },
): Promise<SimulatedDeposit> {
  if (client.config.environment !== "sandbox") {
    throw new AirwallexError("host_not_allowed", {
      detail: "Deposit simulation is only available against Airwallex Sandbox.",
    });
  }

  const { data } = await client.request("/api/v1/simulation/deposit/create", {
    method: "POST",
    body: {
      global_account_id: input.globalAccountId,
      amount: Number(input.amount),
      payer_name: input.payerName,
      payer_country: "US",
      payer_bankname: "Ledgistry Sandbox Simulation",
      reference: input.reference,
      status: "SETTLED",
    },
    schema: simulatedDepositSchema,
  });
  return data;
}
