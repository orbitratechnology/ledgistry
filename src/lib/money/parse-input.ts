import { decimalToMinor, MoneyPrecisionError } from "./minor-units";

/** Largest amount we accept from forms: stays exact through JSON/PostgREST (2^53). */
const MAX_MINOR = 9_000_000_000_000_000n;

export type AmountParseResult = { ok: true; minor: bigint } | { ok: false; error: string };

/**
 * Parses an operator-typed amount ("6,500", "4500.00") into minor units for a currency.
 * Commas are accepted only as thousands separators; anything ambiguous is rejected.
 */
export function parseAmountInput(input: string, exponent: number): AmountParseResult {
  const raw = input.trim().replace(/\s+/g, "");
  if (!raw) return { ok: false, error: "Enter an amount." };
  if (raw.startsWith("-")) return { ok: false, error: "Amounts must be positive." };

  if (raw.includes(",") && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) {
    return { ok: false, error: "Use commas only as thousands separators, e.g. 6,500.00." };
  }
  const cleaned = raw.replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, error: "Enter a number like 6500 or 6,500.00." };
  }

  let minor: bigint;
  try {
    minor = decimalToMinor(cleaned, exponent);
  } catch (error) {
    if (error instanceof MoneyPrecisionError) {
      return {
        ok: false,
        error:
          exponent === 0
            ? "This currency has no decimal places."
            : `Use at most ${exponent} decimal place${exponent === 1 ? "" : "s"} for this currency.`,
      };
    }
    throw error;
  }

  if (minor <= 0n) return { ok: false, error: "Amounts must be greater than zero." };
  if (minor > MAX_MINOR) return { ok: false, error: "That amount is too large." };
  return { ok: true, minor };
}
