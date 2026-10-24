import { FlaskConicalIcon, RefreshCwIcon, RotateCcwIcon, SendIcon } from "lucide-react";

import {
  resendPaymentAction,
  simulateTransferAction,
  verifyPaymentAction,
} from "@/app/(workspace)/obligations/payment-actions";
import { ActionButton } from "@/components/common/action-button";
import { PaymentStatusBadge, SandboxBadge } from "@/components/common/badges";
import { LocalDateTime } from "@/components/common/freshness";
import { Money } from "@/components/common/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { currencyExponent } from "@/lib/money";
import { PROVIDER_STATUS_NOTE } from "@/lib/payments/status";
import { requireWorkspace } from "@/server/auth/session";
import { sandboxTransfersAllowed } from "@/server/payments/facts";
import { listPaymentOperations, type PaymentOperationView } from "@/server/payments/queries";

function OperationItem({ operation, sandbox }: { operation: PaymentOperationView; sandbox: boolean }) {
  const canSimulate =
    sandbox &&
    operation.providerTransferId !== null &&
    ["pending", "submitted", "unknown", "completed"].includes(operation.status);
  const canResend = operation.status === "verification_required" && operation.providerTransferId === null;
  const note = operation.lastProviderStatus ? PROVIDER_STATUS_NOTE[operation.lastProviderStatus] : null;

  return (
    <li
      id={`payment-${operation.id}`}
      className="flex scroll-mt-20 flex-col gap-2 py-3 first:pt-0 last:pb-0 target:rounded-md target:bg-accent/40"
      data-testid="payment-operation"
      data-status={operation.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium break-words">{operation.payeeName}</p>
          <p className="text-xs break-all text-muted-foreground">
            Ref {operation.reference} · request <span className="font-mono">{operation.providerRequestId}</span>
          </p>
        </div>
        <Money minor={operation.amountMinor} currency={operation.currency} exponent={operation.exponent} className="font-semibold" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <PaymentStatusBadge status={operation.status} />
        {operation.lastProviderStatus ? (
          <Badge variant="outline" data-testid="provider-status">
            Airwallex: {operation.lastProviderStatus}
          </Badge>
        ) : null}
        {operation.isSandbox ? (
          <Badge variant="outline">
            <FlaskConicalIcon data-icon="inline-start" />
            Sandbox
          </Badge>
        ) : null}
        {operation.isDemo ? <SandboxBadge label="Demo record" /> : null}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {operation.safeErrorSummary ? <p className="text-sm">{operation.safeErrorSummary}</p> : null}
      <p className="text-xs text-muted-foreground">
        Requested <LocalDateTime iso={operation.requestStartedAt} />
        {operation.lastVerifiedAt ? (
          <>
            {" "}
            · last checked with Airwallex <LocalDateTime iso={operation.lastVerifiedAt} />
          </>
        ) : null}
        {operation.feeMinor !== null && operation.feeCurrency ? (
          <>
            {" "}
            · fee <Money minor={operation.feeMinor} currency={operation.feeCurrency} exponent={currencyExponent(operation.feeCurrency)} />
          </>
        ) : null}
        {operation.providerTransferId ? (
          <>
            {" "}
            · transfer <span className="font-mono break-all">{operation.providerTransferId}</span>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <ActionButton
          size="sm"
          action={verifyPaymentAction.bind(null, operation.id)}
          icon={<RefreshCwIcon data-icon="inline-start" />}
          successTitle="Status"
        >
          Check status with Airwallex
        </ActionButton>
        {canResend ? (
          <ActionButton
            size="sm"
            action={resendPaymentAction.bind(null, operation.id)}
            icon={<RotateCcwIcon data-icon="inline-start" />}
            successTitle="Resent"
            confirm={{
              title: "Resend the same request?",
              description:
                "Airwallex has no transfer under this request id. Ledgistry resends the identical request with the same id, so Airwallex cannot create a second transfer. The reserve is checked again first.",
              confirmLabel: "Resend same request",
            }}
          >
            Resend same request
          </ActionButton>
        ) : null}
        {canSimulate && operation.status !== "completed" ? (
          <ActionButton
            size="sm"
            variant="ghost"
            action={simulateTransferAction.bind(null, operation.id, "PAID")}
            icon={<FlaskConicalIcon data-icon="inline-start" />}
            successTitle="Sandbox"
          >
            Sandbox: simulate paid
          </ActionButton>
        ) : null}
        {canSimulate ? (
          <ActionButton
            size="sm"
            variant="ghost"
            action={simulateTransferAction.bind(null, operation.id, "FAILED")}
            icon={<FlaskConicalIcon data-icon="inline-start" />}
            successTitle="Sandbox"
            confirm={{
              title: "Simulate a failed transfer?",
              description:
                "Airwallex Sandbox will mark this transfer as FAILED (invalid account). Ledgistry then reads that status back. This is a sandbox simulation, not a real failure.",
              confirmLabel: "Simulate failure",
              destructive: true,
            }}
          >
            Sandbox: simulate failure
          </ActionButton>
        ) : null}
      </div>
    </li>
  );
}

/** Payment operations with their provider-verified status and the safe follow-up actions. */
export async function PaymentsCard({ limit = 20 }: { limit?: number }) {
  const context = await requireWorkspace();
  const operations = await listPaymentOperations(context, { limit });
  const sandbox = sandboxTransfersAllowed();

  return (
    <Card data-testid="payments-card">
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Sandbox transfers you approved. A status is shown as Completed only when Airwallex reports the transfer as
          PAID.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {operations.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SendIcon />
              </EmptyMedia>
              <EmptyTitle>No payments yet</EmptyTitle>
              <EmptyDescription>Approve a recommended obligation from the cash plan to send a sandbox transfer.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Payments">
            {operations.map((operation) => (
              <OperationItem key={operation.id} operation={operation} sandbox={sandbox} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
