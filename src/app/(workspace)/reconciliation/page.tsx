import { CircleAlertIcon, RefreshCwIcon, WandSparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ActionButton } from "@/components/common/action-button";
import { LocalDateTime } from "@/components/common/freshness";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { DepositsList } from "@/components/reconciliation/deposits-list";
import { ReceiptSheet } from "@/components/reconciliation/receipt-sheet";
import { ReceiptsList } from "@/components/reconciliation/receipts-list";
import { ReconTabs } from "@/components/reconciliation/recon-tabs";
import { ReviewList } from "@/components/reconciliation/review-list";
import { SimulateDepositSheet } from "@/components/reconciliation/simulate-deposit-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { getGlobalAccountOptions } from "@/server/reconciliation/global-account-options";
import { getReconciliationData, type ReceiptView } from "@/server/reconciliation/queries";
import { runMatchingAction, syncTransactionsAction } from "./actions";

export const metadata: Metadata = { title: "Reconciliation" };

export default function ReconciliationPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Reconciliation"
        description="Match Airwallex deposit evidence to the receipts you expect. Suggestions are never applied without your confirmation, and partial receipts keep their shortfall visible."
      />
      <Suspense fallback={<ReconciliationSkeleton />}>
        <ReconciliationSection />
      </Suspense>
    </PageContainer>
  );
}

function outstandingByCurrency(receipts: ReceiptView[]) {
  const totals = new Map<string, { minor: bigint; exponent: number }>();
  for (const receipt of receipts) {
    if (receipt.cancelled || receipt.outstandingMinor <= 0n) continue;
    const current = totals.get(receipt.currency) ?? { minor: 0n, exponent: receipt.exponent };
    totals.set(receipt.currency, { ...current, minor: current.minor + receipt.outstandingMinor });
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => formatMoney(total.minor, currency, total.exponent));
}

function Stat({ title, value, detail }: { title: string; value: React.ReactNode; detail: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs break-words text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

async function ReconciliationSection() {
  const context = await requireWorkspace();
  const data = await getReconciliationData(context);
  const globalAccounts = getGlobalAccountOptions();

  const openMatches = data.matches.filter(
    (match) => match.status === "suggested" || match.status === "needs_review",
  );
  const unmatched = data.transactions.filter(
    (txn) => txn.state === "unmatched" && txn.providerStatus === "SETTLED" && txn.unappliedMinor > 0n,
  );
  const partial = data.receipts.filter((receipt) => receipt.state === "partially_received");
  const outstanding = outstandingByCurrency(data.receipts);
  const activeReceipts = data.receipts.filter((receipt) => !receipt.cancelled);

  return (
    <section aria-label="Reconciliation workspace" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-muted-foreground" role="status">
          {data.lastSync ? (
            <>
              Last Airwallex sync <LocalDateTime iso={data.lastSync.at} />
              {data.lastSync.status === "failed" ? " — failed" : ""}
            </>
          ) : (
            "Not synced with Airwallex yet."
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            action={syncTransactionsAction}
            variant="default"
            size="lg"
            className="h-10 md:h-9"
            icon={<RefreshCwIcon data-icon="inline-start" />}
            successTitle="Synced"
          >
            Sync from Airwallex
          </ActionButton>
          <ActionButton
            action={runMatchingAction}
            variant="outline"
            size="lg"
            className="h-10 md:h-9"
            icon={<WandSparklesIcon data-icon="inline-start" />}
            successTitle="Matching complete"
          >
            Find matches
          </ActionButton>
          <SimulateDepositSheet accounts={globalAccounts} />
          <ReceiptSheet />
        </div>
      </div>

      {data.lastSync?.status === "failed" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The last sync failed</AlertTitle>
          <AlertDescription>
            {data.lastSync.message ?? "Airwallex could not be reached."} Deposits below may be out of date.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">
        <Stat title="Awaiting your review" value={openMatches.length} detail="Suggested matches to confirm or reject" />
        <Stat title="Unmatched deposits" value={unmatched.length} detail="Settled money not linked to a receipt" />
        <Stat title="Partially received" value={partial.length} detail="Receipts with a remaining shortfall" />
        <Stat
          title="Still expected (forecast)"
          value={outstanding.length === 0 ? "—" : outstanding.length}
          detail={outstanding.length === 0 ? "No outstanding receipts" : outstanding.join(" · ")}
        />
      </div>

      <ReconTabs
        defaultTab={openMatches.length > 0 ? "review" : data.transactions.length > 0 ? "deposits" : "receipts"}
        counts={{ review: openMatches.length, deposits: data.transactions.length, receipts: activeReceipts.length }}
        review={<ReviewList matches={data.matches} transactions={data.transactions} receipts={data.receipts} />}
        deposits={<DepositsList transactions={data.transactions} receipts={data.receipts} matches={data.matches} />}
        receipts={<ReceiptsList receipts={data.receipts} />}
      />
    </section>
  );
}

function ReconciliationSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading reconciliation">
      <Skeleton className="h-9 w-full max-w-lg" />
      <div className="grid grid-cols-2 gap-3 @4xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
