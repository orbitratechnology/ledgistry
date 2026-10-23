import { CircleAlertIcon, InfoIcon, WalletIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataFreshness, LocalDateTime } from "@/components/common/freshness";
import { BalanceCards } from "@/components/dashboard/balance-cards";
import { RefreshBalancesButton } from "@/components/dashboard/refresh-balances-button";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getAirwallexConfig } from "@/lib/env";
import { requireWorkspace } from "@/server/auth/session";
import { getBalanceOverview } from "@/server/balances/queries";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Cash position"
        description="Actual balances read from Airwallex Sandbox, per currency. Expected receipts and planned payments are never counted as available cash."
        actions={<RefreshBalancesButton />}
      />
      <Suspense fallback={<BalancesSkeleton />}>
        <BalancesSection />
      </Suspense>
    </PageContainer>
  );
}

async function BalancesSection() {
  const context = await requireWorkspace();
  const airwallex = getAirwallexConfig();
  const { latest, lastFailure } = await getBalanceOverview(context);

  return (
    <section aria-labelledby="balances-heading" className="flex flex-col gap-4">
      <h3 id="balances-heading" className="sr-only">
        Airwallex balances
      </h3>

      {!airwallex.ok ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Airwallex is not configured</AlertTitle>
          <AlertDescription>
            {airwallex.message} See{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>{" "}
            for the connection status.
          </AlertDescription>
        </Alert>
      ) : null}

      {lastFailure ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The last refresh failed</AlertTitle>
          <AlertDescription>
            {lastFailure.message}
            {latest ? " The balances below are from the previous successful read." : null}
            {lastFailure.at ? (
              <>
                {" "}
                Attempted <LocalDateTime iso={lastFailure.at} />.
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {latest ? (
        <>
          <DataFreshness fetchedAt={latest.fetchedAt} />
          <BalanceCards balances={latest.balances} />
          <Alert>
            <InfoIcon />
            <AlertTitle>How to read these numbers</AlertTitle>
            <AlertDescription>
              <span className="font-medium">Available</span> can be spent now.{" "}
              <span className="font-medium">Pending</span> is settling and{" "}
              <span className="font-medium">reserved</span> is held for outbound payments; neither
              is spendable yet. “Unavailable” means Airwallex did not return that figure — it is
              not treated as zero. Currencies are never combined.
            </AlertDescription>
          </Alert>
        </>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WalletIcon />
            </EmptyMedia>
            <EmptyTitle>No balances read yet</EmptyTitle>
            <EmptyDescription>
              Fetch current balances from your Airwallex Sandbox account to see actual cash by
              currency. Nothing is shown until Airwallex returns real data.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {airwallex.ok ? (
              <RefreshBalancesButton label="Fetch balances from Airwallex" variant="default" />
            ) : (
              <Button variant="outline" render={<Link href="/settings" />}>
                Check connection settings
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
    </section>
  );
}

function BalancesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading balances">
      <Skeleton className="h-5 w-64" />
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <CardHeader className="gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-44" />
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
