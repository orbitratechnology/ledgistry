"use client";

import { CircleAlertIcon, FlaskConicalIcon, SendIcon, ShieldCheckIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import {
  approveAndSendAction,
  cancelPaymentReviewAction,
  openPaymentReviewAction,
} from "@/app/(workspace)/obligations/payment-actions";
import { SandboxBadge } from "@/components/common/badges";
import { LocalDateTime } from "@/components/common/freshness";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import type { PaymentReview } from "@/server/payments/facts";
import type { ReviewResult } from "@/server/payments/service";

function Row({ term, children, testId }: { term: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 font-medium break-words" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

function ReviewDetails({ review }: { review: PaymentReview }) {
  return (
    <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-2.5 text-sm" data-testid="payment-review-details">
      <Row term="Pay">
        <span className="text-lg" data-testid="review-amount">
          {review.amount}
        </span>
      </Row>
      <Row term="Payee">
        {review.payee}
        {review.isDemo ? (
          <span className="mt-1 block">
            <SandboxBadge label="Demo record" />
          </span>
        ) : null}
      </Row>
      <Row term="Beneficiary" testId="review-beneficiary">
        {review.beneficiary
          ? [
              review.beneficiary.label,
              review.beneficiary.currency,
              review.beneficiary.country,
              review.beneficiary.transferMethod ? `${review.beneficiary.transferMethod} transfer` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : "None linked"}
      </Row>
      <Row term="For">
        {review.description}
        {review.invoiceReference ? ` · invoice ${review.invoiceReference}` : ""} · due {review.dueDate}
      </Row>
      <Row term="From">{review.source}</Row>
      <Row term="Reference" testId="review-reference">
        {review.reference}
      </Row>
      <Row term="Reason">{review.reason}</Row>
      <Row term="Fees">{review.fees}</Row>
      <Row term="Available now" testId="review-available">
        {review.availableNow ?? "Unavailable"}
        {review.balanceFetchedAt ? (
          <span className="block text-xs font-normal text-muted-foreground">
            Read from Airwallex <LocalDateTime iso={review.balanceFetchedAt} />
          </span>
        ) : null}
      </Row>
      <Row term="Protected reserve">
        {review.reserve}
        {review.reserveProtected ? "" : " (not protected)"}
      </Row>
      <Row term="Available after" testId="review-after">
        {review.availableAfter ?? "Unavailable"}
        {review.headroomAfter ? (
          <span className="block text-xs font-normal text-muted-foreground">{review.headroomAfter} above the reserve</span>
        ) : null}
      </Row>
      <Row term="Why now">
        {review.whyRecommended ?? "Not recommended by the current plan."}
        {review.planVersion ? (
          <span className="block text-xs font-normal text-muted-foreground">From plan v{review.planVersion}</span>
        ) : null}
      </Row>
    </dl>
  );
}

/**
 * Opens a server-side review (live balance, fresh plan, Airwallex validation) and offers one
 * explicit approval. Closing without approving discards the review; nothing is sent.
 */
export function PaymentReviewSheet({
  obligationId,
  payee,
  triggerLabel = "Review payment",
  variant = "default",
}: {
  obligationId: string;
  payee: string;
  triggerLabel?: string;
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();
  const sentRef = useRef(false);

  function load() {
    setResult(null);
    sentRef.current = false;
    startLoading(async () => setResult(await openPaymentReviewAction(obligationId)));
  }

  function close(next: boolean) {
    if (!next && result?.ok && !sentRef.current) void cancelPaymentReviewAction(result.approvalId);
    setOpen(next);
    if (next) load();
  }

  function approve() {
    if (!result?.ok || sentRef.current) return;
    sentRef.current = true;
    const { approvalId } = result;
    startSending(async () => {
      const outcome = await approveAndSendAction(approvalId);
      toast.add({
        type: outcome.ok ? "success" : "error",
        title: outcome.ok ? "Sandbox transfer sent" : "Not sent",
        description: outcome.message,
      });
      setOpen(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetTrigger
        render={
          <Button variant={variant} size="sm" aria-label={`Review payment to ${payee}`}>
            <SendIcon data-icon="inline-start" />
            {triggerLabel}
          </Button>
        }
      />
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>Review payment to {payee}</SheetTitle>
          <SheetDescription>
            Checked just now against a live Airwallex balance, your reserve and the current plan. Nothing is sent
            until you approve.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="payment-review">
          <Badge variant="outline" className="w-fit">
            <FlaskConicalIcon data-icon="inline-start" />
            Airwallex Sandbox — not real money
          </Badge>
          {loading || !result ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Checking the payment">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <>
              {!result.ok ? (
                <Alert variant="destructive" data-testid="payment-blocked">
                  <CircleAlertIcon />
                  <AlertTitle>This payment cannot be approved now</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {(result.blockers.length ? result.blockers : [{ code: "error", message: result.message }]).map((blocker) => (
                        <li key={blocker.code}>{blocker.message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="success">
                  <ShieldCheckIcon />
                  <AlertTitle>All checks passed</AlertTitle>
                  <AlertDescription>
                    Sandbox host, reserve, beneficiary, plan and Airwallex validation. This review expires{" "}
                    <LocalDateTime iso={result.expiresAt} />; any change to the payment before then cancels it.
                  </AlertDescription>
                </Alert>
              )}
              {result.review ? <ReviewDetails review={result.review} /> : null}
            </>
          )}
        </div>
        <SheetFooter className="border-t">
          <Button
            size="lg"
            className="h-10 w-full"
            onClick={approve}
            disabled={!result?.ok || sending || loading}
            data-testid="approve-and-send"
          >
            {sending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            Approve and send sandbox transfer
          </Button>
          <Button variant="outline" size="lg" className="h-10 w-full" onClick={() => close(false)} disabled={sending}>
            Close without paying
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
