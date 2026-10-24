import "server-only";

import { z } from "zod";

import { currencyExponent, decimalToMinor, isCurrencyCode, MoneyPrecisionError } from "@/lib/money";
import type { AirwallexClient } from "./client";
import { AirwallexError } from "./errors";

/*
 * Airwallex Transfers (API 2026-08-21). Creation is a POST and is never retried automatically:
 * a lost response is resolved by looking the transfer up by its request_id, or by re-sending the
 * exact same request_id (Airwallex answers `duplicate_request_id` with the original transfer id).
 */

/** Payment reason sent with every transfer (Airwallex enumerated value). */
export const TRANSFER_REASON = "business_expenses";

const amount = z.union([z.number(), z.string()]).nullish();

const transferSchema = z
  .object({
    id: z.string().min(1),
    request_id: z.string().nullish(),
    status: z.string().min(1),
    transfer_amount: amount,
    transfer_currency: z.string().nullish(),
    source_amount: amount,
    source_currency: z.string().nullish(),
    amount_payer_pays: amount,
    fee_amount: amount,
    fee_currency: z.string().nullish(),
    failure: z.object({ code: z.string().nullish() }).loose().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .loose();

const transferListSchema = z.object({ items: z.array(transferSchema) }).loose();

export type ProviderTransfer = {
  id: string;
  requestId: string | null;
  status: string;
  feeMinor: bigint | null;
  feeCurrency: string | null;
  failureCode: string | null;
};

export type TransferRequest = {
  requestId: string;
  beneficiaryId: string;
  currency: string;
  /** Decimal string in the transfer currency, e.g. "6500.00". */
  amount: string;
  transferMethod: string;
  reference: string;
};

function normalise(transfer: z.infer<typeof transferSchema>): ProviderTransfer {
  let feeMinor: bigint | null = null;
  const feeCurrency = transfer.fee_currency && isCurrencyCode(transfer.fee_currency) ? transfer.fee_currency : null;
  if (feeCurrency && transfer.fee_amount !== null && transfer.fee_amount !== undefined) {
    try {
      feeMinor = decimalToMinor(transfer.fee_amount, currencyExponent(feeCurrency));
    } catch (error) {
      if (!(error instanceof MoneyPrecisionError || error instanceof RangeError)) throw error;
    }
  }
  return {
    id: transfer.id,
    requestId: transfer.request_id ?? null,
    status: transfer.status.toUpperCase(),
    feeMinor,
    feeCurrency,
    failureCode: transfer.failure?.code ?? null,
  };
}

function assertSandbox(client: AirwallexClient) {
  if (client.config.environment !== "sandbox") {
    throw new AirwallexError("host_not_allowed", {
      detail: "Transfers are only sent to Airwallex Sandbox in this MVP.",
    });
  }
}

function body(request: TransferRequest) {
  return {
    request_id: request.requestId,
    beneficiary_id: request.beneficiaryId,
    transfer_currency: request.currency,
    transfer_amount: request.amount,
    // Same currency on both sides: no implicit FX conversion is ever booked.
    source_currency: request.currency,
    transfer_method: request.transferMethod,
    reference: request.reference,
    reason: TRANSFER_REASON,
  };
}

export type TransferValidation = { ok: true } | { ok: false; fields: string[]; code: string | null };

/** POST /api/v1/transfers/validate — the same body as create; moves no money. */
export async function validateTransfer(client: AirwallexClient, request: TransferRequest): Promise<TransferValidation> {
  assertSandbox(client);
  try {
    await client.request("/api/v1/transfers/validate", {
      method: "POST",
      body: body(request),
      schema: z.unknown(),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AirwallexError && error.kind === "bad_request") {
      const fields = (error.providerDetails?.fieldErrors ?? [])
        .map((field) => [field.source, field.code].filter(Boolean).join(": "))
        .filter(Boolean);
      return { ok: false, fields, code: error.providerCode };
    }
    throw error;
  }
}

/** POST /api/v1/transfers/create — sent once; callers persist the request_id beforehand. */
export async function createTransfer(client: AirwallexClient, request: TransferRequest): Promise<ProviderTransfer> {
  assertSandbox(client);
  const { data } = await client.request("/api/v1/transfers/create", {
    method: "POST",
    body: body(request),
    schema: transferSchema,
    timeoutMs: 20_000,
  });
  return normalise(data);
}

/** GET /api/v1/transfers/{id} — the provider's current view of a transfer. */
export async function getTransfer(client: AirwallexClient, transferId: string): Promise<ProviderTransfer> {
  const { data } = await client.request(`/api/v1/transfers/${encodeURIComponent(transferId)}`, {
    schema: transferSchema,
  });
  return normalise(data);
}

/** GET /api/v1/transfers?request_id=… — resolves a create whose response was lost (last 30 days). */
export async function findTransferByRequestId(
  client: AirwallexClient,
  requestId: string,
): Promise<ProviderTransfer | null> {
  const { data } = await client.request("/api/v1/transfers", {
    query: { request_id: requestId, page_size: 20 },
    schema: transferListSchema,
  });
  const match = data.items.find((item) => item.request_id === requestId);
  return match ? normalise(match) : null;
}

export const SIMULATABLE_STATUSES = ["PROCESSING", "SENT", "PAID", "FAILED", "CANCELLED"] as const;
export type SimulatableStatus = (typeof SIMULATABLE_STATUSES)[number];

/**
 * Sandbox only: POST /api/v1/simulation/transfers/{id}/transition. Airwallex itself moves the
 * transfer one valid step; Ledgistry then reads the result back like any other status.
 */
export async function simulateTransferTransition(
  client: AirwallexClient,
  transferId: string,
  nextStatus: SimulatableStatus,
): Promise<void> {
  assertSandbox(client);
  await client.request(`/api/v1/simulation/transfers/${encodeURIComponent(transferId)}/transition`, {
    method: "POST",
    body: nextStatus === "FAILED" ? { next_status: nextStatus, failure_type: "INVALID_ACCOUNT_NAME_OR_NUMBER" } : { next_status: nextStatus },
    schema: z.unknown(),
  });
}

/** The steps Airwallex accepts to reach `target` from `current` (one valid transition at a time). */
export function simulationSteps(current: string, target: "PAID" | "FAILED"): SimulatableStatus[] {
  const path = ["SCHEDULED", "PROCESSING", "SENT", "PAID"];
  const index = path.indexOf(current.toUpperCase());
  if (index < 0) return [];
  if (target === "PAID") return path.slice(index + 1) as SimulatableStatus[];
  // FAILED is reachable from PROCESSING, SENT or PAID.
  return current.toUpperCase() === "SCHEDULED" ? ["PROCESSING", "FAILED"] : ["FAILED"];
}
