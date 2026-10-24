import { ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/layout/page";
import { ObligationFilters } from "@/components/obligations/obligation-filters";
import { ObligationList } from "@/components/obligations/obligation-list";
import { PaymentsCard } from "@/components/payments/payments-card";
import { ObligationSheet } from "@/components/obligations/obligation-sheet";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { isCurrencyCode } from "@/lib/money";
import { FORM_CURRENCIES } from "@/lib/validation/forms";
import { requireWorkspace } from "@/server/auth/session";
import { getBeneficiaryOptions } from "@/server/obligations/beneficiary-options";
import { listObligations, type ObligationFilters as Filters } from "@/server/obligations/queries";

export const metadata: Metadata = { title: "Obligations" };

export default function ObligationsPage({ searchParams }: PageProps<"/obligations">) {
  return (
    <PageContainer>
      <PageHeader
        title="Obligations"
        description="Money you owe, ordered the way the planner will consider it: explicit priority first, then due date. Recording an obligation never sends a payment; paying one takes a reviewed, explicit approval."
      />
      <Suspense fallback={<ObligationsSkeleton />}>
        <ObligationsSection searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PaymentsCard limit={10} />
      </Suspense>
    </PageContainer>
  );
}

function readFilters(params: Record<string, string | string[] | undefined>): Filters {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const view = first(params.view);
  const currency = first(params.currency)?.toUpperCase();
  return {
    view: view === "all" || view === "archived" ? view : "open",
    currency: currency && isCurrencyCode(currency) ? currency : undefined,
    query: first(params.q)?.slice(0, 100),
  };
}

async function ObligationsSection({
  searchParams,
}: {
  searchParams: PageProps<"/obligations">["searchParams"];
}) {
  const context = await requireWorkspace();
  const filters = readFilters(await searchParams);
  const items = await listObligations(context, filters);
  const beneficiaries = getBeneficiaryOptions();
  const filtered = filters.view !== "open" || filters.currency || filters.query;

  return (
    <section aria-label="Obligations" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ObligationFilters currencies={[...FORM_CURRENCIES]} />
        <ObligationSheet beneficiaries={beneficiaries} />
      </div>
      {items.length > 0 ? (
        <ObligationList items={items} beneficiaries={beneficiaries} />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptTextIcon />
            </EmptyMedia>
            <EmptyTitle>{filtered ? "No obligations match these filters" : "No obligations yet"}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? "Try another view, currency or search."
                : "Add the supplier payments you need to make. Each one stays a plan until you approve a specific transfer."}
            </EmptyDescription>
          </EmptyHeader>
          {filtered ? null : (
            <EmptyContent>
              <ObligationSheet beneficiaries={beneficiaries} />
            </EmptyContent>
          )}
        </Empty>
      )}
    </section>
  );
}

function ObligationsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading obligations">
      <Skeleton className="h-9 w-full max-w-xl" />
      <Card>
        <CardContent className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
