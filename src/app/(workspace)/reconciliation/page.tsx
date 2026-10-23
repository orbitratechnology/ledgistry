import { GitCompareArrowsIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Reconciliation" };

export default function ReconciliationPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Reconciliation"
        description="Match Airwallex transaction evidence against expected receipts, including partial receipts and discrepancies."
      />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GitCompareArrowsIcon />
          </EmptyMedia>
          <EmptyTitle>Reconciliation isn’t available yet</EmptyTitle>
          <EmptyDescription>
            Transaction sync and expected receipts are being set up. Suggested matches will appear
            here for your review — nothing is marked as reconciled without your confirmation.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageContainer>
  );
}
