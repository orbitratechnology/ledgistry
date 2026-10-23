import { ReceiptTextIcon } from "lucide-react";
import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/layout/page";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Obligations" };

export default function ObligationsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Obligations"
        description="Supplier payments with priority, due dates and payment readiness."
      />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptTextIcon />
          </EmptyMedia>
          <EmptyTitle>Obligations aren’t available yet</EmptyTitle>
          <EmptyDescription>
            Payment obligations are being set up. Each payment will need your explicit approval of
            the exact amount and payee before anything is sent.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </PageContainer>
  );
}
