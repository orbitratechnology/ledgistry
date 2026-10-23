import {
  CalculatorIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  HourglassIcon,
  ListOrderedIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UserRoundXIcon,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { recalculatePlanAction } from "@/app/(workspace)/overview/actions";
import { ActionButton } from "@/components/common/action-button";
import { PriorityBadge, SandboxBadge, OverdueBadge } from "@/components/common/badges";
import { LocalDateTime } from "@/components/common/freshness";
import { Money } from "@/components/common/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIsoDate } from "@/lib/format";
import type { PlanDecision, PlanItem, PlanResult } from "@/lib/planner/plan";
import { requireWorkspace } from "@/server/auth/session";
import { getPlanOverview, type CurrencyPlanView } from "@/server/planner/queries";
import { PlanExplanation, PlanExplanationSkeleton } from "./plan-explanation";
import { PlanTabs } from "./plan-tabs";

const REASON_LABEL: Record<string, string> = {
  manual: "recalculated by you",
  balance_refresh: "after a balance refresh",
  transaction_sync: "after a deposit sync",
  match_decision: "after a match decision",
  obligation_change: "after an obligation change",
  receipt_change: "after an expected-receipt change",
  reserve_change: "after a reserve change",
};

const SECTIONS: { decision: PlanDecision; title: string; description: string; icon: typeof CircleCheckIcon }[] = [
  {
    decision: "recommended",
    title: "Recommended to pay",
    description: "Fits above the reserve in rank order. Paying still needs your explicit approval.",
    icon: CircleCheckIcon,
  },
  {
    decision: "needs_details",
    title: "Needs payment details",
    description: "Cash is held for these, but they cannot be paid until a beneficiary is linked.",
    icon: UserRoundXIcon,
  },
  {
    decision: "deferred",
    title: "Deferred / at risk",
    description: "Paying these now would take available cash below the reserve.",
    icon: HourglassIcon,
  },
  {
    decision: "blocked",
    title: "Blocked",
    description: "Cannot be planned without an actual Airwallex balance.",
    icon: CircleSlashIcon,
  },
];

function dueText(item: PlanItem) {
  if (item.overdue) return `Overdue by ${-item.daysUntilDue} day${item.daysUntilDue === -1 ? "" : "s"}`;
  if (item.daysUntilDue === 0) return "Due today";
  return `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"} · ${formatIsoDate(item.dueDate)}`;
}

export function RecalculatePlanButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  return (
    <ActionButton action={recalculatePlanAction} variant={variant} icon={<RefreshCwIcon data-icon="inline-start" />} successTitle="Plan">
      Recalculate plan
    </ActionButton>
  );
}

function PlanItemRow({ item, plan }: { item: PlanItem; plan: PlanResult }) {
  const forecast = plan.forecast?.outcomes.find((outcome) => outcome.obligationId === item.obligationId);
  return (
    <li data-testid="plan-item" data-decision={item.decision} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium break-words">
            <span className="text-muted-foreground tabular-nums">#{item.rank}</span> {item.payeeName}
          </p>
          <p className="text-xs text-muted-foreground break-words">
            {[item.description, item.invoiceReference ? `Invoice ${item.invoiceReference}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Money minor={item.amountMinor} currency={plan.currency} exponent={plan.exponent} className="font-semibold" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={item.priority} />
        {item.overdue ? <OverdueBadge /> : null}
        <span className="text-xs text-muted-foreground">{dueText(item)}</span>
        {item.isDemo ? <SandboxBadge label="Demo record" /> : null}
      </div>
      <p className="text-sm" data-testid="plan-reason">
        {item.reason}
      </p>
      {forecast ? (
        <p className="text-xs text-muted-foreground" data-testid="plan-forecast-outcome">
          <span className="font-medium">Forecast:</span>{" "}
          {forecast.fits
            ? "would fit if the expected receipts below arrive in full — not cash yet."
            : "still short even if the expected receipts below arrive."}
        </p>
      ) : null}
    </li>
  );
}

function Stat({
  label,
  children,
  hint,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold" data-testid={testId}>
        {children}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function CurrencyPlan({ view }: { view: CurrencyPlanView }) {
  const latest = view.latest;
  if (!latest) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalculatorIcon />
          </EmptyMedia>
          <EmptyTitle>No {view.currency} plan yet</EmptyTitle>
          <EmptyDescription>Calculate a plan from the latest balance, your reserve and open obligations.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <RecalculatePlanButton variant="default" />
        </EmptyContent>
      </Empty>
    );
  }

  const { plan } = latest;
  const money = (minor: bigint | null) =>
    minor === null ? "Unavailable" : <Money minor={minor} currency={plan.currency} exponent={plan.exponent} />;

  return (
    <div className="flex flex-col gap-4" data-testid={`plan-${plan.currency}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Badge variant="outline" data-testid="plan-version">
          Plan v{latest.version}
        </Badge>
        <span>
          Calculated <LocalDateTime iso={latest.createdAt} />
          {REASON_LABEL[latest.reason] ? ` · ${REASON_LABEL[latest.reason]}` : ""}
        </span>
        {plan.balance ? (
          <span>
            · Uses the Airwallex balance read <LocalDateTime iso={plan.balance.fetchedAt} />
          </span>
        ) : null}
      </div>

      {view.stale ? (
        <Alert variant="warning" role="status">
          <TriangleAlertIcon />
          <AlertTitle>Records changed since this plan</AlertTitle>
          <AlertDescription>
            A balance, reserve, obligation or receipt is different now (or the date changed). Recalculate before acting on it.
          </AlertDescription>
        </Alert>
      ) : null}

      {plan.warnings.map((warning) => (
        <Alert key={warning.code} variant={warning.code === "no_balance" || warning.code === "below_reserve" ? "destructive" : "warning"}>
          <CircleAlertIcon />
          <AlertDescription>
            {warning.message}
            {warning.code === "no_reserve" || warning.code === "reserve_disabled" ? (
              <>
                {" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Open Settings
                </Link>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}

      <div className="grid grid-cols-1 gap-3 @sm/main:grid-cols-2 @3xl/main:grid-cols-4" data-testid="plan-stats">
        <Stat label="Available now (actual)" testId="plan-available">
          {money(plan.summary.availableMinor)}
        </Stat>
        <Stat label="Protected reserve" hint={plan.reserveEnabled ? undefined : "Not protected"} testId="plan-reserve">
          {money(plan.reserveMinor)}
        </Stat>
        <Stat label="Spendable now" hint="Available above the reserve" testId="plan-spendable">
          {money(plan.summary.spendableNowMinor)}
        </Stat>
        <Stat label="After recommended" hint="Projected available cash" testId="plan-after">
          {money(plan.summary.availableAfterPlanMinor)}
        </Stat>
      </div>

      <div className="grid grid-cols-1 gap-4 @5xl/main:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {plan.items.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>No obligations to plan in {plan.currency}</EmptyTitle>
                <EmptyDescription>Planned obligations appear here, ranked by the rules on the right.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" render={<Link href="/obligations" />}>
                  Open obligations
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {SECTIONS.map((section) => {
            const items = plan.items.filter((item) => item.decision === section.decision);
            if (items.length === 0) return null;
            return (
              <Card key={section.decision} size="sm" data-testid={`plan-section-${section.decision}`}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <section.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col divide-y">
                    {items.map((item) => (
                      <PlanItemRow key={item.obligationId} item={item} plan={plan} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
          {plan.excluded.length > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Not in this plan</CardTitle>
                <CardDescription>Listed for completeness; no cash is allocated to them.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {plan.excluded.map((item) => (
                    <li key={item.obligationId} className="flex flex-wrap justify-between gap-x-4">
                      <span className="min-w-0 break-words">
                        {item.payeeName} — <span className="text-muted-foreground">{item.reason}</span>
                      </span>
                      <Money minor={item.amountMinor} currency={plan.currency} exponent={plan.exponent} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<PlanExplanationSkeleton />}>
            <PlanExplanation planId={latest.id} version={latest.version} plan={plan} changes={view.changes} />
          </Suspense>

          {plan.forecast ? (
            <Card size="sm" className="border-dashed" data-testid="plan-forecast">
              <CardHeader>
                <CardTitle>Forecast — not cash</CardTitle>
                <CardDescription>
                  Expected receipts still outstanding within {plan.forecast.horizonDays} days. Never added to spendable cash.
                </CardDescription>
                <CardAction>
                  <Money minor={plan.forecast.totalMinor} currency={plan.currency} exponent={plan.exponent} className="font-semibold" />
                </CardAction>
              </CardHeader>
              <CardContent>
                {plan.forecast.receipts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No expected receipts in this window.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {plan.forecast.receipts.map((receipt) => (
                      <li key={receipt.id} className="flex flex-wrap justify-between gap-x-4">
                        <span className="min-w-0 break-words">
                          {receipt.payerName} · {receipt.reference}{" "}
                          <span className="text-muted-foreground">
                            {receipt.overdue ? "(overdue, " : "("}expected {formatIsoDate(receipt.expectedDate)})
                          </span>
                        </span>
                        <Money minor={receipt.outstandingMinor} currency={plan.currency} exponent={plan.exponent} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {view.changes.length > 0 ? (
            <Card size="sm" data-testid="plan-changes">
              <CardHeader>
                <CardTitle>What changed since v{view.previousVersion}</CardTitle>
                <CardDescription>Derived from the two plan versions, not from AI.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {view.changes.map((change) => (
                    <li key={change.text}>{change.text}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListOrderedIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                How obligations are ranked
              </CardTitle>
              <CardDescription>Applied in this order by deterministic code ({plan.ruleVersion}).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                {plan.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {plan.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Overview section: the latest immutable plan per currency. */
export async function CashPlanSection() {
  const context = await requireWorkspace();
  const views = await getPlanOverview(context);
  const needsAttention = (view: CurrencyPlanView) =>
    view.stale || (view.latest?.plan.items.some((item) => item.decision !== "recommended") ?? false);
  const preferred =
    views.find((view) => (view.latest?.plan.items.length ?? 0) > 0 && needsAttention(view)) ??
    views.find((view) => (view.latest?.plan.items.length ?? 0) > 0) ??
    views[0];

  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-4" data-testid="cash-plan">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 id="plan-heading" className="text-lg font-semibold">
            Cash plan
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What can be paid now without breaching your reserve, calculated from actual Airwallex balances. A
            recommendation is not a payment: nothing is sent without your approval.
          </p>
        </div>
        {views.length > 0 ? <RecalculatePlanButton /> : null}
      </div>

      {views.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalculatorIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to plan yet</EmptyTitle>
            <EmptyDescription>
              Add an obligation or set a protected reserve; the plan is calculated per currency from there.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button variant="default" render={<Link href="/obligations" />}>
              Add an obligation
            </Button>
            <Button variant="outline" render={<Link href="/settings" />}>
              Set a reserve
            </Button>
          </EmptyContent>
        </Empty>
      ) : views.length === 1 ? (
        <CurrencyPlan view={views[0]} />
      ) : (
        <PlanTabs
          defaultCurrency={preferred.currency}
          panels={views.map((view) => ({
            currency: view.currency,
            attention: needsAttention(view),
            content: <CurrencyPlan view={view} />,
          }))}
        />
      )}
    </section>
  );
}

export function CashPlanSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading cash plan">
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-1 gap-3 @sm/main:grid-cols-2 @3xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
