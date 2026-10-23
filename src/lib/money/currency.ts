const CURRENCY_CODE = /^[A-Z]{3}$/;

const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));

export function isCurrencyCode(value: string): boolean {
  return CURRENCY_CODE.test(value) && supportedCurrencies.has(value);
}

/**
 * Number of minor-unit digits for an ISO 4217 currency (USD → 2, JPY → 0, KWD → 3),
 * taken from the runtime's CLDR data.
 */
export function currencyExponent(currency: string): number {
  if (!CURRENCY_CODE.test(currency)) {
    throw new RangeError(`Invalid currency code: ${currency}`);
  }
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits as number;
}
