import { describe, expect, it } from "vitest";

import {
  currencyExponent,
  decimalToMinor,
  formatMoney,
  isCurrencyCode,
  minorToDecimalString,
  MoneyPrecisionError,
  parseMinor,
} from "./index";

const normaliseSpaces = (text: string) => text.replace(/\s/g, " ");

describe("currencyExponent", () => {
  it.each([
    ["USD", 2],
    ["EUR", 2],
    ["JPY", 0],
    ["KRW", 0],
    ["KWD", 3],
    ["BHD", 3],
  ])("%s has %i minor digits", (currency, digits) => {
    expect(currencyExponent(currency)).toBe(digits);
  });

  it("rejects malformed codes", () => {
    expect(() => currencyExponent("usd")).toThrow(RangeError);
    expect(() => currencyExponent("US")).toThrow(RangeError);
  });

  it("recognises ISO currency codes only", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(false);
    expect(isCurrencyCode("ZZZ")).toBe(false);
  });
});

describe("decimalToMinor", () => {
  it("converts provider decimals exactly (no float drift)", () => {
    expect(decimalToMinor(10000008.82, 2)).toBe(1_000_000_882n);
    expect(decimalToMinor(9999935, 2)).toBe(999_993_500n);
    expect(decimalToMinor(0.07, 2)).toBe(7n); // 0.07 * 100 === 7.000000000000001 in floats
    expect(decimalToMinor(1.005, 3)).toBe(1005n);
  });

  it("handles strings, trailing zeros and negative amounts", () => {
    expect(decimalToMinor("10.500", 2)).toBe(1050n);
    expect(decimalToMinor("-5", 2)).toBe(-500n);
    expect(decimalToMinor("-0.00", 2)).toBe(0n);
    expect(decimalToMinor(" 42 ", 0)).toBe(42n);
  });

  it("handles exponent-notation numbers", () => {
    expect(decimalToMinor(1e21, 2)).toBe(100_000_000_000_000_000_000_000n);
  });

  it("refuses to round amounts finer than the currency allows", () => {
    expect(() => decimalToMinor(1500.5, 0)).toThrow(MoneyPrecisionError);
    expect(() => decimalToMinor("10.001", 2)).toThrow(MoneyPrecisionError);
    expect(() => decimalToMinor(1e-7, 2)).toThrow(MoneyPrecisionError);
  });

  it("rejects non-decimal input", () => {
    expect(() => decimalToMinor(Number.NaN, 2)).toThrow(MoneyPrecisionError);
    expect(() => decimalToMinor(Number.POSITIVE_INFINITY, 2)).toThrow(MoneyPrecisionError);
    expect(() => decimalToMinor("1,000.00", 2)).toThrow(MoneyPrecisionError);
    expect(() => decimalToMinor("", 2)).toThrow(MoneyPrecisionError);
  });
});

describe("minorToDecimalString", () => {
  it("pads and signs correctly", () => {
    expect(minorToDecimalString(5n, 2)).toBe("0.05");
    expect(minorToDecimalString(-5n, 2)).toBe("-0.05");
    expect(minorToDecimalString(1_000_000_882n, 2)).toBe("10000008.82");
    expect(minorToDecimalString(1500n, 0)).toBe("1500");
    expect(minorToDecimalString(1234n, 3)).toBe("1.234");
  });

  it("round-trips with decimalToMinor", () => {
    for (const value of ["0.01", "123456789012345.67", "-42.10", "0.00"]) {
      expect(minorToDecimalString(decimalToMinor(value, 2), 2)).toBe(
        value === "-0.00" ? "0.00" : value,
      );
    }
  });
});

describe("parseMinor", () => {
  it("parses PostgREST text and safe numbers", () => {
    expect(parseMinor("999993500")).toBe(999_993_500n);
    expect(parseMinor("-12")).toBe(-12n);
    expect(parseMinor(42)).toBe(42n);
    expect(parseMinor(null)).toBeNull();
    expect(parseMinor(undefined)).toBeNull();
  });

  it("rejects values that would lose precision or are not integers", () => {
    expect(() => parseMinor(2 ** 60)).toThrow(MoneyPrecisionError);
    expect(() => parseMinor("1.5")).toThrow(MoneyPrecisionError);
  });
});

describe("formatMoney", () => {
  it("renders currency codes to avoid $ ambiguity", () => {
    expect(normaliseSpaces(formatMoney(999_993_500n, "USD", 2))).toBe("USD 9,999,935.00");
  });

  it("respects zero- and three-decimal currencies", () => {
    expect(normaliseSpaces(formatMoney(1500n, "JPY", 0))).toBe("JPY 1,500");
    expect(normaliseSpaces(formatMoney(1234n, "KWD", 3))).toBe("KWD 1.234");
  });

  it("formats beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    expect(formatMoney(1_234_567_890_123_456_789n, "USD", 2, { display: "none" })).toBe(
      "12,345,678,901,234,567.89",
    );
  });
});
