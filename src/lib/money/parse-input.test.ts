import { describe, expect, it } from "vitest";

import { parseAmountInput } from "./parse-input";

describe("parseAmountInput", () => {
  it.each([
    ["6500", 2, 650_000n],
    ["6,500", 2, 650_000n],
    ["6,500.00", 2, 650_000n],
    [" 4 500.5 ", 2, 450_050n],
    ["1,234,567.89", 2, 123_456_789n],
    ["1500", 0, 1500n],
    ["1.234", 3, 1234n],
  ])("parses %s (exponent %i)", (input, exponent, minor) => {
    expect(parseAmountInput(input, exponent)).toEqual({ ok: true, minor });
  });

  it.each([
    ["", "Enter an amount."],
    ["-5", "Amounts must be positive."],
    ["0", "Amounts must be greater than zero."],
    ["0.00", "Amounts must be greater than zero."],
    ["12,34", "Use commas only as thousands separators, e.g. 6,500.00."],
    ["1e5", "Enter a number like 6500 or 6,500.00."],
    ["$100", "Enter a number like 6500 or 6,500.00."],
    ["10.001", "Use at most 2 decimal places for this currency."],
    ["99999999999999999", "That amount is too large."],
  ])("rejects %j", (input, error) => {
    expect(parseAmountInput(input, 2)).toEqual({ ok: false, error });
  });

  it("explains zero-decimal currencies", () => {
    expect(parseAmountInput("10.5", 0)).toEqual({
      ok: false,
      error: "This currency has no decimal places.",
    });
  });
});
