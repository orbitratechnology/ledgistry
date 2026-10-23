import { describe, expect, it } from "vitest";

import { appearsIn, checkGrounding, numericTokens } from "./grounding";

const facts = JSON.stringify({
  available: "USD 12,000.00",
  reserve: "USD 4,000.00",
  recommended: [{ payee: "Oceanic Freight", amount: "USD 6,500.00", due: "2026-10-30" }],
  deferred: [{ payee: "Northwind", amount: "USD 3,000.00", availableAfter: "USD 2,500.00" }],
  counts: { recommended: 1, deferred: 1 },
  version: 3,
});

describe("numericTokens", () => {
  it("normalises separators and trailing zeros", () => {
    expect(numericTokens("USD 6,500.00 and 4,000.50, then 2026-10-30")).toEqual(["6500", "4000.5", "2026", "10", "30"]);
  });
});

describe("checkGrounding", () => {
  it("accepts text that only restates given figures, in either precision", () => {
    expect(
      checkGrounding(
        ["Pay Oceanic Freight USD 6,500 now; it leaves you above the USD 4,000.00 reserve.", "Due 30 October 2026 (plan v3)."],
        facts,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a number the planner never produced", () => {
    const result = checkGrounding(["You will still have USD 5,400.00 after paying."], facts);
    expect(result).toEqual({ ok: false, unknownNumbers: ["5400"], unknownCurrencies: [] });
  });

  it("rejects arithmetic the model did itself", () => {
    // 12,000 − 6,500 − 3,000 = 2,500 is in the facts; 9,500 (6,500 + 3,000) is not.
    expect(checkGrounding(["Both payments total USD 9,500.00."], facts).ok).toBe(false);
  });

  it("rejects a currency that is not part of the facts", () => {
    const result = checkGrounding(["Convert to EUR 4,000.00 instead."], facts);
    expect(result).toEqual({ ok: false, unknownNumbers: [], unknownCurrencies: ["EUR"] });
  });
});

describe("appearsIn", () => {
  it("matches values regardless of case, spacing and thousands separators", () => {
    expect(appearsIn("INV-2041", "Payment ref inv-2041 for October")).toBe(true);
    expect(appearsIn("4500.00", "Amount: 4,500.00 USD")).toBe(true);
    expect(appearsIn("Harbor Retail", "from HARBOR  RETAIL LTD")).toBe(true);
    expect(appearsIn("9000", "Amount: 4,500.00 USD")).toBe(false);
    expect(appearsIn("", "anything")).toBe(false);
  });
});
