import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Exact money display with tabular numerals. Server-side use (takes bigint minor units). */
export function Money({
  minor,
  currency,
  exponent,
  hideCode = false,
  className,
}: {
  minor: bigint;
  currency: string;
  exponent: number;
  hideCode?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", className)}>
      {formatMoney(minor, currency, exponent, { display: hideCode ? "none" : "code" })}
    </span>
  );
}
