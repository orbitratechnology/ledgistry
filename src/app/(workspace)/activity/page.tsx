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
        description="Append-only audit trail of syncs, decisions and provider responses, newest first."
      />
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
