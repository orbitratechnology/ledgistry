import { describe, expect, it } from "vitest";

import { currentBalancesSchema, normalizeBalances } from "./balances";

describe("currentBalancesSchema", () => {
  it("accepts the documented shape and tolerates extra fields", () => {
    const parsed = currentBalancesSchema.parse([
      {
        account_type: "cash",
        available_amount: 100000,
        currency: "AUD",
        pending_amount: 50000,
        prepayment_amount: 0,
        reserved_amount: 0,
        total_amount: 150000,
        some_future_field: "ignored",
      },
    ]);
    expect(parsed).toHaveLength(1);
  });

  it("rejects rows without a valid currency", () => {
    expect(() => currentBalancesSchema.parse([{ available_amount: 1 }])).toThrow();
    expect(() => currentBalancesSchema.parse([{ currency: "usd" }])).toThrow();
  });
});

describe("normalizeBalances", () => {
  it("converts to exact minor units per currency and sorts by code", () => {
    const { balances, issues } = normalizeBalances([
      { currency: "USD", available_amount: 9999935, total_amount: 9999935, pending_amount: 0 },
      { currency: "EUR", available_amount: 10000008.82, total_amount: 10000008.82 },
      { currency: "JPY", available_amount: 1500, total_amount: 1500 },
    ]);
    expect(issues).toEqual([]);
    expect(balances.map((balance) => balance.currency)).toEqual(["EUR", "JPY", "USD"]);
    expect(balances[0]).toMatchObject({ exponent: 2, availableMinor: 1_000_000_882n });
    expect(balances[1]).toMatchObject({ exponent: 0, availableMinor: 1500n });
    expect(balances[2]).toMatchObject({ availableMinor: 999_993_500n, pendingMinor: 0n });
  });

  it("keeps omitted components as null (unavailable), never zero", () => {
    const { balances } = normalizeBalances([{ currency: "USD", available_amount: 10 }]);
    expect(balances[0]).toMatchObject({
      availableMinor: 1000n,
      pendingMinor: null,
      reservedMinor: null,
      totalMinor: null,
      accountType: "cash",
    });
  });

  it("reports a currency it cannot represent exactly without dropping the others", () => {
    const { balances, issues } = normalizeBalances([
      { currency: "JPY", available_amount: 1500.5 },
      { currency: "USD", available_amount: 12 },
    ]);
    expect(balances.map((balance) => balance.currency)).toEqual(["USD"]);
    expect(issues).toEqual([{ currency: "JPY", message: expect.stringContaining("fractional") }]);
  });
});
