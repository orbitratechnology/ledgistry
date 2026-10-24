import {
  CircleCheckIcon,
  CircleXIcon,
  ClockIcon,
  HistoryIcon,
  InfoIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/common/freshness";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { PaymentsCard } from "@/components/payments/payments-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAuditEvents, type AuditEventRow } from "@/server/audit/queries";
import { requireWorkspace } from "@/server/auth/session";

export const metadata: Metadata = { title: "Activity" };

const OUTCOME: Record<
  AuditEventRow["outcome"],
  { label: string; variant: "success" | "destructive" | "warning" | "info"; icon: LucideIcon }
> = {
  success: { label: "Success", variant: "success", icon: CircleCheckIcon },
  failure: { label: "Failed", variant: "destructive", icon: CircleXIcon },
  pending: { label: "Pending", variant: "warning", icon: ClockIcon },
  info: { label: "Info", variant: "info", icon: InfoIcon },
};

const EVENT_LABEL: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "balances.refreshed": "Balances refreshed",
  "balances.refresh_failed": "Balance refresh failed",
  "transactions.synced": "Deposits synced",
  "transactions.sync_failed": "Deposit sync failed",
  "reconciliation.suggestions_generated": "Matches suggested",
  "reconciliation.match_confirmed": "Match confirmed",
  "reconciliation.match_rejected": "Match rejected",
  "reconciliation.match_reversed": "Match reversed",
  "receipt.created": "Receipt added",
  "receipt.updated": "Receipt updated",
  "receipt.cancelled": "Receipt cancelled",
  "receipt.archived": "Receipt archived",
  "obligation.created": "Obligation added",
  "obligation.updated": "Obligation updated",
  "obligation.archived": "Obligation archived",
  "obligation.restored": "Obligation restored",
  "sandbox.deposit_simulated": "Sandbox deposit simulated",
  "sandbox.deposit_simulation_failed": "Deposit simulation failed",
  "plan.generated": "Cash plan calculated",
  "plan.recalculation_failed": "Plan recalculation failed",
  "reserve.created": "Reserve set",
  "reserve.updated": "Reserve changed",
  "reserve.enabled": "Reserve protection on",
  "reserve.disabled": "Reserve protection off",
  "ai.plan_explained": "AI explained a plan",
  "ai.plan_explanation_failed": "AI explanation unavailable",
  "ai.match_suggested": "AI match suggestion",
  "ai.match_suggestion_failed": "AI match suggestion failed",
  "ai.receipt_extracted": "AI read pasted text",
  "ai.receipt_extraction_failed": "AI could not read pasted text",
  "payment.review_opened": "Payment review opened",
  "payment.review_closed": "Payment review closed",
  "payment.review_blocked": "Payment review blocked",
  "payment.approved": "Payment approved",
  "payment.approval_refused": "Approval refused",
  "payment.status_recorded": "Payment status recorded",
  "payment.verification_required": "Payment outcome unknown",
  "payment.completed": "Payment completed",
  "payment.failed": "Payment failed",
  "payment.cancelled": "Payment cancelled",
  "payment.verification_failed": "Payment check failed",
  "sandbox.transfer_simulated": "Sandbox transfer outcome simulated",
  "demo.loaded": "Demo data loaded",
  "demo.reset": "Demo data reset",
  "demo.removed": "Demo data removed",
};

function eventLabel(eventType: string) {
  return EVENT_LABEL[eventType] ?? eventType;
}

function OutcomeBadge({ outcome }: { outcome: AuditEventRow["outcome"] }) {
  const config = OUTCOME[outcome];
  return (
    <Badge variant={config.variant}>
      <config.icon data-icon="inline-start" />
      {config.label}
    </Badge>
  );
}

export default function ActivityPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Activity"
        description="Payments with their verified Airwallex status, then the append-only audit trail of syncs, decisions and provider responses, newest first."
      />
      <Suspense fallback={<ActivitySkeleton />}>
        <PaymentsCard limit={10} />
      </Suspense>
      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityList />
      </Suspense>
    </PageContainer>
  );
}

async function ActivityList() {
  const events = await listAuditEvents(await requireWorkspace());

  if (events.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>
            Balance refreshes, reconciliation decisions and payment operations will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      {/* Mobile: stacked cards. */}
      <ol className="flex flex-col gap-3 md:hidden" aria-label="Activity">
        {events.map((event) => (
          <li key={event.id}>
            <Card size="sm">
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{eventLabel(event.eventType)}</span>
                  <OutcomeBadge outcome={event.outcome} />
                </div>
                <p className="text-sm">{event.summary}</p>
                <p className="text-xs text-muted-foreground">
                  <LocalDateTime iso={event.createdAt} /> ·{" "}
                  {event.actorType === "user" ? "Operator" : "System"}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      {/* Tablet/desktop: table. */}
      <Card className="hidden py-0 md:flex">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Time</TableHead>
              <TableHead className="w-48">Event</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-24">Actor</TableHead>
              <TableHead className="w-28">Outcome</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="text-muted-foreground">
                  <LocalDateTime iso={event.createdAt} />
                </TableCell>
                <TableCell className="font-medium">{eventLabel(event.eventType)}</TableCell>
                <TableCell className="whitespace-normal">{event.summary}</TableCell>
                <TableCell>{event.actorType === "user" ? "Operator" : "System"}</TableCell>
                <TableCell>
                  <OutcomeBadge outcome={event.outcome} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function ActivitySkeleton() {
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
