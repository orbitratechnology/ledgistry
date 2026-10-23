import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ClockIcon,
  SearchCheckIcon,
  UserRoundXIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listObligations } from "@/server/obligations/queries";
import { getReconciliationData } from "@/server/reconciliation/queries";

type Item = {
  icon: LucideIcon;
  tone: "warning" | "destructive" | "info";
  title: string;
  detail: string;
  href: "/reconciliation" | "/obligations";
};

function sumByCurrency(rows: { currency: string; exponent: number; minor: bigint }[]) {
  const totals = new Map<string, { exponent: number; minor: bigint }>();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { exponent: row.exponent, minor: 0n };
    totals.set(row.currency, { exponent: row.exponent, minor: current.minor + row.minor });
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({ currency, label: formatMoney(total.minor, currency, total.exponent) }));
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : /(s|sh|ch|x)$/.test(word) ? "es" : "s"}`;

/** What needs the operator now, plus forecast figures kept apart from actual cash. */
export async function AttentionAndForecast() {
  const context = await requireWorkspace();
  const [recon, obligations] = await Promise.all([
    getReconciliationData(context),
    listObligations(context, { view: "open" }),
  ]);

  const openMatches = recon.matches.filter((m) => m.status === "suggested" || m.status === "needs_review");
  const partial = recon.receipts.filter((r) => r.state === "partially_received");
  const unmatched = recon.transactions.filter(
    (t) => t.state === "unmatched" && t.providerStatus === "SETTLED" && t.unappliedMinor > 0n,
  );
  const flagged = recon.transactions.filter((t) => t.state === "duplicate_suspected" || t.providerChangedAfterMatch);
  const overdueReceipts = recon.receipts.filter((r) => r.overdue);
  const overdueObligations = obligations.filter((o) => o.overdue);
  const missingBeneficiary = obligations.filter(
    (o) => !o.beneficiaryId && (o.status === "planned" || o.status === "draft"),
  );

  const items: Item[] = [];
  if (openMatches.length > 0) {
    items.push({
      icon: SearchCheckIcon,
      tone: "info",
      title: `${plural(openMatches.length, "suggested match")} waiting for review`,
      detail: "Nothing is applied until you confirm.",
      href: "/reconciliation",
    });
  }
  if (partial.length > 0) {
    items.push({
      icon: CircleDotIcon,
      tone: "warning",
      title: `${plural(partial.length, "receipt")} only partially received`,
      detail: `Still outstanding: ${sumByCurrency(partial.map((r) => ({ currency: r.currency, exponent: r.exponent, minor: r.outstandingMinor }))).map((t) => t.label).join(" · ")}`,
      href: "/reconciliation",
    });
  }
  if (flagged.length > 0) {
    items.push({
      icon: SearchCheckIcon,
      tone: "destructive",
      title: `${plural(flagged.length, "deposit")} flagged as a possible duplicate or changed by Airwallex`,
      detail: "Check before relying on these funds.",
      href: "/reconciliation",
    });
  }
  if (unmatched.length > 0) {
    items.push({
      icon: ArrowDownLeftIcon,
      tone: "info",
      title: `${plural(unmatched.length, "settled deposit")} not linked to a receipt`,
      detail: "Match manually or add the expected receipt.",
      href: "/reconciliation",
    });
  }
  if (overdueReceipts.length > 0) {
    items.push({
      icon: CalendarClockIcon,
      tone: "warning",
      title: `${plural(overdueReceipts.length, "expected receipt")} overdue`,
      detail: "Expected date has passed with money still outstanding.",
      href: "/reconciliation",
    });
  }
  if (overdueObligations.length > 0) {
    items.push({
      icon: ClockIcon,
      tone: "destructive",
      title: `${plural(overdueObligations.length, "obligation")} past due`,
      detail: overdueObligations.slice(0, 3).map((o) => o.payeeName).join(", "),
      href: "/obligations",
    });
  }
  if (missingBeneficiary.length > 0) {
    items.push({
      icon: UserRoundXIcon,
      tone: "warning",
      title: `${plural(missingBeneficiary.length, "obligation")} without an Airwallex beneficiary`,
      detail: "A beneficiary is required before a payment can be approved.",
      href: "/obligations",
    });
  }

  const expectedIn = sumByCurrency(
    recon.receipts
      .filter((r) => !r.cancelled && r.outstandingMinor > 0n)
      .map((r) => ({ currency: r.currency, exponent: r.exponent, minor: r.outstandingMinor })),
  );
  const plannedOut = sumByCurrency(
    obligations
      .filter((o) => o.status !== "deferred")
      .map((o) => ({ currency: o.currency, exponent: o.exponent, minor: o.amountMinor })),
  );
  const currencies = [...new Set([...expectedIn, ...plannedOut].map((row) => row.currency))].sort();

  return (
    <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>Partial receipts, unmatched money and overdue items.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="flex flex-col divide-y" aria-label="Attention items">
              {items.map((item) => (
                <li key={item.title}>
                  <Link
                    href={item.href}
                    className="flex min-h-11 items-center gap-3 rounded-md py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Badge variant={item.tone} className="size-7 shrink-0 rounded-full p-0">
                      <item.icon />
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{item.title}</span>
                      <span className="block text-xs break-words text-muted-foreground">{item.detail}</span>
                    </span>
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Not yet cash</CardTitle>
          <CardDescription>
            Forecast inputs per currency. Never added to the actual balances above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No expected receipts or open obligations yet.
            </p>
          ) : (
            <dl className="flex flex-col divide-y text-sm">
              {currencies.map((currency) => (
                <div key={currency} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-3 py-2">
                  <dt className="font-mono font-semibold">{currency}</dt>
                  <dd className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowDownLeftIcon className="size-3" aria-hidden="true" /> Expected in
                    </span>
                    <span className="truncate font-medium tabular-nums">
                      {expectedIn.find((row) => row.currency === currency)?.label ?? "—"}
                    </span>
                  </dd>
                  <dd className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowUpRightIcon className="size-3" aria-hidden="true" /> Open obligations
                    </span>
                    <span className="truncate font-medium tabular-nums">
                      {plannedOut.find((row) => row.currency === currency)?.label ?? "—"}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function AttentionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2" aria-busy="true">
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}
