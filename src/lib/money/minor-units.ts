/**
 * Exact conversions between decimal amounts and integer minor units.
 * Money is held as bigint minor units; floating point is only ever parsed, never computed on.
 */

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

export class MoneyPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyPrecisionError";
  }
}

/** Shortest exact decimal text for a JS number (avoids exponent notation). */
function numberToDecimalText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MoneyPrecisionError(`Amount is not a finite number: ${value}`);
  }
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * Converts a provider decimal amount (e.g. Airwallex `10000008.82`) to minor units.
 * Throws if the value carries more fractional digits than the currency allows,
 * rather than silently rounding.
 */
export function decimalToMinor(value: number | string, exponent: number): bigint {
  const text = typeof value === "number" ? numberToDecimalText(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new MoneyPrecisionError(`Not a decimal amount: "${text}"`);
  }
  const [, sign, whole, rawFraction = ""] = match;
  const fraction = rawFraction.replace(/0+$/, "");
  if (fraction.length > exponent) {
    throw new MoneyPrecisionError(
      `Amount ${text} has more than ${exponent} fractional digit(s) for this currency`,
    );
  }
  const minor = BigInt(whole + fraction.padEnd(exponent, "0"));
  return sign && minor !== 0n ? -minor : minor;
}

/** Minor units → plain decimal string with exactly `exponent` fractional digits. */
export function minorToDecimalString(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, "0");
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(-exponent)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Parses a bigint column that PostgREST returned as text (or number) without precision loss. */
export function parseMinor(value: string | number | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new MoneyPrecisionError(`Minor-unit value ${value} exceeds safe integer range`);
    }
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) {
    throw new MoneyPrecisionError(`Minor-unit value is not an integer: "${value}"`);
  }
  return BigInt(value);
}
