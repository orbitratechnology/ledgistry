import { ArchiveIcon, BanIcon, CalendarClockIcon } from "lucide-react";

import { archiveReceiptAction, cancelReceiptAction } from "@/app/(workspace)/reconciliation/actions";
import { ActionButton } from "@/components/common/action-button";
import { OverdueBadge, ReceiptStateBadge, SandboxBadge } from "@/components/common/badges";
import { Money } from "@/components/common/money";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { formatIsoDate } from "@/lib/format";
import { minorToDecimalString } from "@/lib/money";
import type { ReceiptView } from "@/server/reconciliation/queries";
import { ReceiptSheet } from "./receipt-sheet";

function receivedPercent(receipt: ReceiptView): number {
  if (receipt.expectedMinor <= 0n) return 0;
  return Number((receipt.receivedMinor * 100n) / receipt.expectedMinor);
}

export function ReceiptsList({ receipts }: { receipts: ReceiptView[] }) {
  if (receipts.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClockIcon />
          </EmptyMedia>
          <EmptyTitle>No expected receipts</EmptyTitle>
          <EmptyDescription>
            Record money you expect to receive, with the reference the payer will use. Expected receipts are a
            forecast — they never count as available cash.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <ReceiptSheet />
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 @4xl/main:grid-cols-2" aria-label="Expected receipts">
      {receipts.map((receipt) => {
        const percent = receivedPercent(receipt);
        const locked = receipt.receivedMinor > 0n;
        return (
          <li key={receipt.id}>
            <Card size="sm" className="h-full" data-testid={`receipt-card-${receipt.reference}`}>
              <CardContent className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{receipt.payerName}</p>
                    <p className="text-sm break-words text-muted-foreground">
                      Ref {receipt.reference} · expected {formatIsoDate(receipt.expectedDate)}
                    </p>
                  </div>
                  <ReceiptStateBadge state={receipt.state} />
                </div>

                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Expected</dt>
                    <dd className="truncate font-medium">
                      <Money minor={receipt.expectedMinor} currency={receipt.currency} exponent={receipt.exponent} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Received</dt>
                    <dd className="truncate font-medium" data-testid="receipt-received">
                      <Money minor={receipt.receivedMinor} currency={receipt.currency} exponent={receipt.exponent} hideCode />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Outstanding</dt>
                    <dd className="truncate font-medium" data-testid="receipt-outstanding">
                      <Money minor={receipt.outstandingMinor} currency={receipt.currency} exponent={receipt.exponent} hideCode />
                    </dd>
                  </div>
                </dl>
                <Progress value={percent} aria-label={`${percent}% received`} />

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {receipt.overdue && receipt.state !== "overdue" ? <OverdueBadge /> : null}
                    {receipt.isDemo ? <SandboxBadge label="Demo record" /> : null}
                  </div>
                  {!receipt.cancelled ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      <ReceiptSheet
                        initial={{
                          id: receipt.id,
                          payerName: receipt.payerName,
                          reference: receipt.reference,
                          amount: minorToDecimalString(receipt.expectedMinor, receipt.exponent),
                          currency: receipt.currency,
                          expectedDate: receipt.expectedDate,
                          notes: receipt.notes ?? "",
                        }}
                      />
                      {!locked ? (
                        <ActionButton
                          action={cancelReceiptAction.bind(null, receipt.id)}
                          variant="ghost"
                          size="sm"
                          icon={<BanIcon data-icon="inline-start" />}
                          successTitle="Cancelled"
                          confirm={{
                            title: `Cancel receipt ${receipt.reference}?`,
                            description:
                              "You no longer expect this money. It leaves the forecast and stops receiving match suggestions.",
                            confirmLabel: "Cancel receipt",
                            destructive: true,
                          }}
                        >
                          Cancel
                        </ActionButton>
                      ) : null}
                    </div>
                  ) : (
                    <ActionButton
                      action={archiveReceiptAction.bind(null, receipt.id)}
                      variant="ghost"
                      size="sm"
                      icon={<ArchiveIcon data-icon="inline-start" />}
                      successTitle="Archived"
                    >
                      Archive
                    </ActionButton>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
