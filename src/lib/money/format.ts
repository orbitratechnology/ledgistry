import { minorToDecimalString } from "./minor-units";

type FormatOptions = {
  locale?: string;
  /** "code" renders "USD 1,250.00" — unambiguous across $-currencies. */
  display?: "code" | "symbol" | "none";
  signDisplay?: "auto" | "always" | "exceptZero";
};

/** Formats minor units exactly (Intl accepts decimal strings, so no float rounding occurs). */
export function formatMoney(
  minor: bigint,
  currency: string,
  exponent: number,
  { locale = "en-US", display = "code", signDisplay = "auto" }: FormatOptions = {},
): string {
  const decimal = minorToDecimalString(minor, exponent);
  const formatter = new Intl.NumberFormat(locale, {
    style: display === "none" ? "decimal" : "currency",
    currency,
    currencyDisplay: display === "none" ? undefined : display,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
    signDisplay,
  });
  // Intl.NumberFormat#format accepts decimal strings (ES2023) and keeps full precision.
  return formatter.format(decimal as Intl.StringNumericLiteral);
}
