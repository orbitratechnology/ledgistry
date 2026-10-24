import { describe, expect, it } from "vitest";

import type { AirwallexConfig } from "@/lib/env";

import { AirwallexClient } from "./client";
import { AirwallexError } from "./errors";
import {
  createTransfer,
  findTransferByRequestId,
  getTransfer,
  simulationSteps,
  validateTransfer,
  type TransferRequest,
} from "./transfers";
import { json, loginOk, scriptedFetch, testConfig } from "./test-helpers";

const request: TransferRequest = {
  requestId: "ledgistry-abc123",
  beneficiaryId: "ben-1",
  currency: "EUR",
  amount: "60.00",
  transferMethod: "LOCAL",
  reference: "INV-1",
};

const transfer = (overrides: Record<string, unknown> = {}) => ({
  id: "tr-1",
  request_id: request.requestId,
  status: "PROCESSING",
  transfer_amount: 60,
  transfer_currency: "EUR",
  source_currency: "EUR",
  fee_amount: 1.5,
  fee_currency: "EUR",
  ...overrides,
});

const client = (
  fetchImpl: ReturnType<typeof scriptedFetch>["fetchImpl"],
  config: Extract<AirwallexConfig, { ok: true }> = testConfig,
) =>
  new AirwallexClient({ config, fetchImpl, sleep: async () => {} });

describe("createTransfer", () => {
  it("sends one request in the transfer currency with no FX, and reads fees exactly", async () => {
    const { fetchImpl, calls } = scriptedFetch(() => loginOk(), () => json(201, transfer()));
    const result = await createTransfer(client(fetchImpl), request);
    expect(result).toEqual({
      id: "tr-1",
      requestId: request.requestId,
      status: "PROCESSING",
      feeMinor: 150n,
      feeCurrency: "EUR",
      failureCode: null,
    });
    const sent = JSON.parse(String(calls[1].init?.body));
    expect(sent).toMatchObject({
      request_id: request.requestId,
      beneficiary_id: "ben-1",
      transfer_currency: "EUR",
      source_currency: "EUR",
      transfer_amount: "60.00",
      transfer_method: "LOCAL",
      reference: "INV-1",
      reason: "business_expenses",
    });
    expect(sent).not.toHaveProperty("transfer_date");
  });

  it("never retries a create that timed out", async () => {
    const { fetchImpl, calls } = scriptedFetch(
      () => loginOk(),
      () => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      },
    );
    await expect(createTransfer(client(fetchImpl), request)).rejects.toMatchObject({ kind: "timeout" });
    expect(calls.filter((call) => call.url.endsWith("/transfers/create"))).toHaveLength(1);
  });

  it("surfaces a duplicate request_id with the original transfer id", async () => {
    const { fetchImpl } = scriptedFetch(
      () => loginOk(),
      () => json(400, { code: "duplicate_request_id", source: "request_id", message: "dup", details: { id: "tr-original" } }),
    );
    const error = await createTransfer(client(fetchImpl), request).catch((caught) => caught);
    expect(error).toBeInstanceOf(AirwallexError);
    expect(error.providerCode).toBe("duplicate_request_id");
    expect(error.providerDetails.existingId).toBe("tr-original");
  });

  it("refuses to send anywhere but the sandbox", async () => {
    const { fetchImpl, calls } = scriptedFetch(() => loginOk());
    const production = { ...testConfig, environment: "production" as const, baseUrl: "https://api.airwallex.com" };
    await expect(createTransfer(client(fetchImpl, production), request)).rejects.toMatchObject({
      kind: "host_not_allowed",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("validateTransfer", () => {
  it("returns field codes without free-text provider messages", async () => {
    const { fetchImpl } = scriptedFetch(
      () => loginOk(),
      () =>
        json(400, {
          code: "validation_failed",
          message: "Account 12345678 is invalid",
          details: { errors: [{ source: "beneficiary_id", code: "045", message: "Account 12345678 invalid" }] },
        }),
    );
    const result = await validateTransfer(client(fetchImpl), request);
    expect(result).toEqual({ ok: false, fields: ["beneficiary_id: 045"], code: "validation_failed" });
    expect(JSON.stringify(result)).not.toContain("12345678");
  });
});

describe("transfer lookup", () => {
  it("reads a transfer by id and finds one by its exact request_id", async () => {
    const { fetchImpl, calls } = scriptedFetch(
      () => loginOk(),
      () => json(200, transfer({ status: "PAID" })),
      () => json(200, { items: [transfer({ id: "tr-other", request_id: "ledgistry-other" }), transfer({ status: "SENT" })] }),
    );
    const awx = client(fetchImpl);
    expect((await getTransfer(awx, "tr-1")).status).toBe("PAID");
    const found = await findTransferByRequestId(awx, request.requestId);
    expect(found?.id).toBe("tr-1");
    expect(new URL(calls[2].url).searchParams.get("request_id")).toBe(request.requestId);
  });

  it("returns null when no transfer carries the request_id", async () => {
    const { fetchImpl } = scriptedFetch(() => loginOk(), () => json(200, { items: [] }));
    expect(await findTransferByRequestId(client(fetchImpl), request.requestId)).toBeNull();
  });
});

describe("simulationSteps", () => {
  it("walks the documented status path one step at a time", () => {
    expect(simulationSteps("SCHEDULED", "PAID")).toEqual(["PROCESSING", "SENT", "PAID"]);
    expect(simulationSteps("SENT", "PAID")).toEqual(["PAID"]);
    expect(simulationSteps("PAID", "PAID")).toEqual([]);
    expect(simulationSteps("SCHEDULED", "FAILED")).toEqual(["PROCESSING", "FAILED"]);
    expect(simulationSteps("SENT", "FAILED")).toEqual(["FAILED"]);
    expect(simulationSteps("CANCELLED", "PAID")).toEqual([]);
  });
});
