import { LandmarkIcon, Undo2Icon } from "lucide-react";

import { reverseMatchAction } from "@/app/(workspace)/reconciliation/actions";
import { ActionButton } from "@/components/common/action-button";
import { ProviderStatusBadge, SandboxBadge, TransactionStateBadge } from "@/components/common/badges";
import { LocalDateTime } from "@/components/common/freshness";
import { Money } from "@/components/common/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import type { MatchView, ReceiptView, TransactionView } from "@/server/reconciliation/queries";
import { ManualMatchDialog, type ReceiptChoice } from "./manual-match-dialog";

function receiptChoices(txn: TransactionView, receipts: ReceiptView[]): ReceiptChoice[] {
  return receipts
    .filter(
      (receipt) =>
        receipt.currency === txn.currency && !receipt.cancelled && !receipt.archived && receipt.outstandingMinor > 0n,
    )
    .map((receipt) => {
      const apply = txn.unappliedMinor < receipt.outstandingMinor ? txn.unappliedMinor : receipt.outstandingMinor;
      const remaining = receipt.outstandingMinor - apply;
      const money = (minor: bigint) => formatMoney(minor, receipt.currency, receipt.exponent);
      return {
        id: receipt.id,
        label: `${receipt.reference} · ${receipt.payerName} · ${money(receipt.outstandingMinor)} outstanding`,
        applyPreview: `Applies ${money(apply)}; ${remaining > 0n ? `${money(remaining)} stays outstanding.` : "the receipt becomes fully received."}`,
      };
    });
}

export function DepositsList({
  transactions,
  receipts,
  matches,
}: {
  transactions: TransactionView[];
  receipts: ReceiptView[];
  matches: MatchView[];
}) {
  if (transactions.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LandmarkIcon />
          </EmptyMedia>
          <EmptyTitle>No deposits synced yet</EmptyTitle>
          <EmptyDescription>
            Sync from Airwallex to import deposits from the last 90 days. In the sandbox you can also simulate a
            clearly labelled test deposit.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  return (
    <ul className="flex flex-col gap-3" aria-label="Deposits">
      {transactions.map((txn) => {
        const confirmed = matches.filter(
          (match) => match.transactionId === txn.id && (match.status === "confirmed" || match.status === "reversed"),
        );
        const choices = receiptChoices(txn, receipts);
        const canMatch = txn.providerStatus === "SETTLED" && txn.unappliedMinor > 0n;
        return (
          <li key={txn.id}>
            <Card size="sm" data-testid="deposit-card">
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{txn.counterpartyName ?? "Unknown payer"}</p>
                    <p className="text-sm break-words text-muted-foreground">
                      Ref {txn.reference ?? "—"} ·{" "}
                      {txn.occurredAt ? <LocalDateTime iso={txn.occurredAt} /> : "date unknown"}
                    </p>
                  </div>
                  <div className="flex flex-col sm:items-end">
                    <Money
                      minor={txn.amountMinor}
                      currency={txn.currency}
                      exponent={txn.exponent}
                      className="text-lg font-semibold"
                    />
                    {txn.appliedMinor > 0n ? (
                      <span className="text-xs text-muted-foreground">
                        Applied {formatMoney(txn.appliedMinor, txn.currency, txn.exponent)} · unapplied{" "}
                        {formatMoney(txn.unappliedMinor, txn.currency, txn.exponent)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <TransactionStateBadge state={txn.state} />
                  <ProviderStatusBadge status={txn.providerStatus} />
                  {txn.isSimulated ? <SandboxBadge /> : null}
                </div>
                {txn.providerChangedAfterMatch ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Airwallex now reports this deposit as {txn.providerStatus.toLowerCase()}, but it was already
                      applied to a receipt. Review and reverse the match if the funds did not arrive.
                    </AlertDescription>
                  </Alert>
                ) : null}
                {confirmed.length > 0 ? (
                  <ul className="flex flex-col gap-2 border-t pt-3 text-sm" aria-label="Decisions for this deposit">
                    {confirmed.map((match) => {
                      const receipt = receiptById.get(match.receiptId);
                      return (
                        <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span className={match.status === "reversed" ? "text-muted-foreground line-through" : ""}>
                            {match.status === "reversed" ? "Reversed: " : "Applied "}
                            {match.appliedMinor !== null
                              ? formatMoney(match.appliedMinor, txn.currency, txn.exponent)
                              : ""}{" "}
                            to {receipt ? `${receipt.reference} (${receipt.payerName})` : "a receipt"}
                          </span>
                          {match.status === "confirmed" ? (
                            <ActionButton
                              action={reverseMatchAction.bind(null, match.id)}
                              variant="ghost"
                              size="sm"
                              icon={<Undo2Icon data-icon="inline-start" />}
                              successTitle="Reversed"
                              confirm={{
                                title: "Reverse this match?",
                                description:
                                  "The applied amount becomes outstanding on the receipt again and unapplied on the deposit. The original decision stays in the audit trail.",
                                confirmLabel: "Reverse match",
                                destructive: true,
                                withNote: true,
                              }}
                            >
                              Reverse
                            </ActionButton>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {canMatch ? (
                  <div className="flex justify-end">
                    <ManualMatchDialog
                      transactionId={txn.id}
                      depositLabel={`${formatMoney(txn.unappliedMinor, txn.currency, txn.exponent)} unapplied from ${txn.counterpartyName ?? "this deposit"}. Only receipts in ${txn.currency} with an outstanding balance are listed.`}
                      choices={choices}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
