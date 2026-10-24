import { describe, expect, it } from "vitest";

import { AirwallexError } from "@/server/airwallex/errors";
import { classifyCreateFailure } from "./create-outcome";

const providerError = (kind: ConstructorParameters<typeof AirwallexError>[0], options: ConstructorParameters<typeof AirwallexError>[1] = {}) =>
  new AirwallexError(kind, options);

describe("classifyCreateFailure", () => {
  it("treats a lost response as an unknown outcome, never as a failure", () => {
    expect(classifyCreateFailure(providerError("timeout"))).toEqual({ kind: "unknown", code: "timeout" });
    expect(classifyCreateFailure(providerError("unavailable", { status: 503 }))).toEqual({ kind: "unknown", code: "unavailable" });
    expect(classifyCreateFailure(new Error("socket hang up"))).toEqual({ kind: "unknown", code: "internal_error" });
    expect(classifyCreateFailure(providerError("bad_request", { status: 409, providerCode: "request_pending" }))).toEqual({
      kind: "unknown",
      code: "request_pending",
    });
  });

  it("resolves a duplicate request_id to the transfer Airwallex already created", () => {
    const duplicate = providerError("bad_request", {
      status: 400,
      providerCode: "duplicate_request_id",
      providerDetails: { existingId: "tr-original", source: "request_id", fieldErrors: [] },
    });
    expect(classifyCreateFailure(duplicate)).toEqual({ kind: "duplicate", existingId: "tr-original" });
    const legacyWithoutId = providerError("bad_request", { status: 400, providerCode: "request_id_duplicate" });
    expect(classifyCreateFailure(legacyWithoutId)).toEqual({ kind: "unknown", code: "request_id_duplicate" });
  });

  it("marks definitive rejections as failed with an operator-safe message", () => {
    expect(classifyCreateFailure(providerError("bad_request", { status: 400, providerCode: "balance_insufficient" }))).toEqual({
      kind: "rejected",
      code: "balance_insufficient",
      message: "Airwallex reports an insufficient balance. Nothing was sent.",
    });
    const invalid = classifyCreateFailure(
      providerError("bad_request", {
        status: 400,
        providerCode: "validation_failed",
        providerDetails: { existingId: null, source: null, fieldErrors: [{ source: "transfer_amount", code: "037" }] },
      }),
    );
    expect(invalid).toMatchObject({ kind: "rejected", message: "Airwallex rejected the transfer details (transfer_amount: 037). Nothing was sent." });
    expect(classifyCreateFailure(providerError("bad_request", { providerCode: "amount_above_transfer_method_limit" }))).toMatchObject({
      kind: "rejected",
      code: "amount_above_transfer_method_limit",
    });
  });
});
