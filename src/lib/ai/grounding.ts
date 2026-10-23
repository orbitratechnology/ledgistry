/**
 * Grounding checks for model-written text. The model may explain facts it was given; it may
 * not introduce numbers or currencies of its own. Any text that does is rejected and the
 * deterministic explanation is shown instead.
 */

import { isCurrencyCode } from "@/lib/money";

/** "6,500.00" → "6500", "4,000.50" → "4000.5", "007" → "7": equal values compare equal. */
function normaliseNumber(token: string): string {
  const [whole, fraction = ""] = token.replace(/,/g, "").split(".");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;
}

/** Every number written in `text`, normalised (thousands separators and trailing zeros ignored). */
export function numericTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((match) => normaliseNumber(match[0].replace(/,$/, "")));
}

/** ISO currency codes written in `text`. */
export function currencyTokens(text: string): string[] {
  return [...text.matchAll(/\b[A-Z]{3}\b/g)].map((match) => match[0]).filter(isCurrencyCode);
}

export type GroundingResult = { ok: true } | { ok: false; unknownNumbers: string[]; unknownCurrencies: string[] };

/** Checks that every number and currency code in `outputs` also appears in `facts`. */
export function checkGrounding(outputs: string[], facts: string): GroundingResult {
  const allowedNumbers = new Set(numericTokens(facts));
  const allowedCurrencies = new Set(currencyTokens(facts));
  const text = outputs.join("\n");
  const unknownNumbers = [...new Set(numericTokens(text).filter((token) => !allowedNumbers.has(token)))];
  const unknownCurrencies = [...new Set(currencyTokens(text).filter((code) => !allowedCurrencies.has(code)))];
  return unknownNumbers.length === 0 && unknownCurrencies.length === 0
    ? { ok: true }
    : { ok: false, unknownNumbers, unknownCurrencies };
}

/** Case- and spacing-insensitive "does the source text contain this value" check. */
export function appearsIn(value: string, source: string): boolean {
  const squash = (text: string) => text.toLowerCase().replace(/[\s,]+/g, "");
  return squash(value).length > 0 && squash(source).includes(squash(value));
}
