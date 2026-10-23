import { CheckIcon, InboxIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { confirmMatchAction, rejectMatchAction } from "@/app/(workspace)/reconciliation/actions";
import { ActionButton } from "@/components/common/action-button";
import { ProviderStatusBadge, SandboxBadge } from "@/components/common/badges";
import { LocalDateTime } from "@/components/common/freshness";
import { Money } from "@/components/common/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatIsoDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { MatchSignal } from "@/lib/reconciliation/matching";
import type { MatchView, ReceiptView, TransactionView } from "@/server/reconciliation/queries";

const SIGNAL_LABEL: Record<MatchSignal, string> = {
  reference_match: "Reference match",
  currency_match: "Same currency",
  amount_match: "Exact amount",
  partial_amount: "Partial amount",
  over_amount: "Larger than outstanding",
  payer_similarity: "Payer name match",
  date_proximity: "Near expected date",
};

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 justify-between gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

function ReviewCard({
  match,
  txn,
  receipt,
}: {
  match: MatchView;
  txn: TransactionView;
  receipt: ReceiptView;
}) {
  const money = (minor: bigint) => formatMoney(minor, txn.currency, txn.exponent);
  const applyMinor = txn.unappliedMinor < receipt.outstandingMinor ? txn.unappliedMinor : receipt.outstandingMinor;
  const remainingMinor = receipt.outstandingMinor - applyMinor;
  const canConfirm = txn.providerStatus === "SETTLED" && applyMinor > 0n;

  return (
    <Card data-testid="review-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {match.status === "needs_review" ? "Needs your review" : "Suggested match"}
          <span className="text-sm font-normal text-muted-foreground">· {receipt.reference}</span>
        </CardTitle>
        <CardDescription>
          {match.suggestedBy === "rules" ? "Proposed by deterministic matching rules" : "Proposed"} ·
          suggestion only — nothing is applied until you confirm.
        </CardDescription>
        <CardAction>
          <Badge variant={match.status === "needs_review" ? "warning" : "info"}>
            {match.confidence !== null ? `${Math.round(match.confidence * 100)}% evidence` : "Review"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @3xl/main:grid-cols-2">
          <section aria-label="Deposit evidence" className="rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Airwallex deposit
              </span>
              <ProviderStatusBadge status={txn.providerStatus} />
              {txn.isSimulated ? <SandboxBadge /> : null}
            </div>
            <dl>
              <Fact term="Amount">
                <Money minor={txn.amountMinor} currency={txn.currency} exponent={txn.exponent} />
              </Fact>
              {txn.appliedMinor > 0n ? <Fact term="Not yet applied">{money(txn.unappliedMinor)}</Fact> : null}
              <Fact term="Payer">{txn.counterpartyName ?? "—"}</Fact>
              <Fact term="Reference">{txn.reference ?? "—"}</Fact>
              <Fact term="Received">{txn.occurredAt ? <LocalDateTime iso={txn.occurredAt} /> : "—"}</Fact>
            </dl>
          </section>
          <section aria-label="Expected receipt" className="rounded-lg border p-3">
            <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Expected receipt (forecast)
            </div>
            <dl>
              <Fact term="Expected">
                <Money minor={receipt.expectedMinor} currency={receipt.currency} exponent={receipt.exponent} />
              </Fact>
              <Fact term="Received so far">{money(receipt.receivedMinor)}</Fact>
              <Fact term="Payer">{receipt.payerName}</Fact>
              <Fact term="Reference">{receipt.reference}</Fact>
              <Fact term="Expected date">{formatIsoDate(receipt.expectedDate)}</Fact>
            </dl>
          </section>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Evidence signals">
          {match.signals.map((signal) => (
            <li key={signal}>
              <Badge variant="outline">
                <CheckIcon data-icon="inline-start" />
                {SIGNAL_LABEL[signal] ?? signal}
              </Badge>
            </li>
          ))}
        </ul>

        {match.explanation ? <p className="text-sm">{match.explanation}</p> : null}

        {match.reviewReasons.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Why this needs a closer look</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {match.reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="rounded-lg bg-muted p-3 text-sm" data-testid="apply-preview">
          Confirming applies <span className="font-semibold">{money(applyMinor)}</span> to {receipt.reference}.{" "}
          {remainingMinor > 0n ? (
            <>
              <span className="font-semibold">{money(remainingMinor)}</span> will remain outstanding — the receipt
              stays partially received.
            </>
          ) : (
            "The receipt will be fully received."
          )}
        </p>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <ActionButton
          action={rejectMatchAction.bind(null, match.id)}
          variant="outline"
          icon={<XIcon data-icon="inline-start" />}
          successTitle="Rejected"
          confirm={{
            title: "Reject this suggestion?",
            description: "The deposit stays unmatched and this pairing will not be suggested again.",
            confirmLabel: "Reject suggestion",
            destructive: true,
            withNote: true,
          }}
        >
          Reject
        </ActionButton>
        {canConfirm ? (
          <ActionButton
            action={confirmMatchAction.bind(null, match.id)}
            variant="default"
            icon={<CheckIcon data-icon="inline-start" />}
            successTitle="Match confirmed"
            confirm={{
              title: `Apply ${money(applyMinor)} to ${receipt.reference}?`,
              description: (
                <>
                  <p>
                    From the {money(txn.amountMinor)} deposit by {txn.counterpartyName ?? "an unknown payer"}.{" "}
                    {remainingMinor > 0n
                      ? `${money(remainingMinor)} will remain outstanding on this receipt.`
                      : "The receipt will be fully received."}
                  </p>
                  <p className="mt-2">
                    This records a reconciliation decision in the audit trail. It does not move money, and you
                    can reverse it later.
                  </p>
                </>
              ),
              confirmLabel: "Confirm match",
            }}
          >
            Confirm match
          </ActionButton>
        ) : (
          <Button disabled>Awaiting settlement</Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function ReviewList({
  matches,
  transactions,
  receipts,
}: {
  matches: MatchView[];
  transactions: TransactionView[];
  receipts: ReceiptView[];
}) {
  const open = matches.filter((match) => match.status === "suggested" || match.status === "needs_review");
  const txnById = new Map(transactions.map((txn) => [txn.id, txn]));
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));

  if (open.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            Sync transactions from Airwallex to check for new deposits. Suggestions appear here for your
            decision — none are confirmed automatically.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {open.map((match) => {
        const txn = txnById.get(match.transactionId);
        const receipt = receiptById.get(match.receiptId);
        if (!txn || !receipt) return null;
        return <ReviewCard key={match.id} match={match} txn={txn} receipt={receipt} />;
      })}
    </div>
  );
}
