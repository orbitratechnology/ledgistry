/** Deposits are imported from this many days back unless the workspace starts reconciling later. */
export const LOOKBACK_DAYS = 90;

/**
 * Start of the deposit import window: the default lookback, or the workspace's reconciliation
 * start date when that is later (never in the future).
 */
export function importWindowStart(reconciliationStartAt: string | null, now = Date.now()): Date {
  const lookback = now - LOOKBACK_DAYS * 86_400_000;
  const start = reconciliationStartAt ? Date.parse(reconciliationStartAt) : Number.NaN;
  return new Date(Number.isFinite(start) ? Math.min(Math.max(lookback, start), now) : lookback);
}
