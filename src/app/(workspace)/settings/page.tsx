import {
  CircleCheckIcon,
  CircleOffIcon,
  CircleXIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/common/freshness";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { DemoCard } from "@/components/settings/demo-card";
import { ReservesCard } from "@/components/settings/reserves-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { readServerEnv } from "@/lib/env";
import { checkAirwallexConnection, type ConnectionState } from "@/server/airwallex/connection";
import { requireWorkspace } from "@/server/auth/session";
import { listReservePolicies } from "@/server/planner/inputs";
import { RecheckConnectionButton } from "./recheck-button";

export const metadata: Metadata = { title: "Settings" };

const STATE_LABEL: Record<
  ConnectionState,
  { label: string; variant: "success" | "warning" | "destructive"; icon: typeof CircleCheckIcon }
> = {
  connected: { label: "Connected", variant: "success", icon: CircleCheckIcon },
  missing_credentials: { label: "Missing credentials", variant: "destructive", icon: CircleOffIcon },
  invalid_credentials: { label: "Invalid credentials", variant: "destructive", icon: CircleXIcon },
  missing_scope: { label: "Missing API scope", variant: "warning", icon: TriangleAlertIcon },
  host_not_allowed: { label: "Host not allowed", variant: "destructive", icon: CircleOffIcon },
  unavailable: { label: "Service unavailable", variant: "warning", icon: TriangleAlertIcon },
};

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Protected reserves, the Airwallex Sandbox connection, demo setup and the controls that keep it safe."
      />
      <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
        <Suspense fallback={<CardSkeleton />}>
          <Reserves />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <ConnectionCard />
        </Suspense>
        <Suspense fallback={<CardSkeleton />}>
          <WorkspaceCard />
        </Suspense>
        <SafetyCard />
        <Suspense fallback={<CardSkeleton wide />}>
          <DemoCard />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function Reserves() {
  const context = await requireWorkspace();
  return <ReservesCard reserves={await listReservePolicies(context)} />;
}

function DetailList({ items }: { items: { term: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-muted-foreground">{item.term}</dt>
          <dd className="min-w-0 font-medium break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

async function ConnectionCard() {
  const { supabase, workspace } = await requireWorkspace();
  const [status, lastSync] = await Promise.all([
    checkAirwallexConnection({ verifyScope: true }),
    supabase
      .from("sync_runs")
      .select("finished_at")
      .eq("workspace_id", workspace.id)
      .eq("kind", "balances")
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const env = readServerEnv();
  const state = STATE_LABEL[status.state];
  const lastSyncAt = lastSync.data?.finished_at ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Airwallex connection</CardTitle>
        <CardDescription>Server-side, sandbox credentials only. Checked live.</CardDescription>
        <CardAction>
          <Badge variant={state.variant}>
            <state.icon data-icon="inline-start" />
            {state.label}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm" role="status">
          {status.message}
        </p>
        <DetailList
          items={[
            {
              term: "Environment",
              value: status.environment === "sandbox" ? "Sandbox" : (status.environment ?? "Unknown"),
            },
            { term: "API host", value: <span className="font-mono text-xs">{status.baseUrl}</span> },
            { term: "API version", value: status.apiVersion ?? "—" },
            { term: "Sandbox-only guard", value: env.AIRWALLEX_SANDBOX_ONLY ? "On" : "Off" },
            {
              term: "Last balance read",
              value: lastSyncAt ? <LocalDateTime iso={lastSyncAt} /> : "Never",
            },
            { term: "Checked", value: <LocalDateTime iso={status.checkedAt} /> },
          ]}
        />
      </CardContent>
      <CardFooter>
        <RecheckConnectionButton />
      </CardFooter>
    </Card>
  );
}

async function WorkspaceCard() {
  const { user, workspace } = await requireWorkspace();
  const allowlist = readServerEnv().LEDGISTRY_OPERATOR_EMAILS;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>One operator workspace; every record is scoped to it.</CardDescription>
      </CardHeader>
      <CardContent>
        <DetailList
          items={[
            { term: "Name", value: workspace.name },
            { term: "Operator", value: user.email ?? "—" },
            {
              term: "Operator access",
              value:
                allowlist.length > 0
                  ? `Allowlist (${allowlist.length} email${allowlist.length === 1 ? "" : "s"})`
                  : "Any signed-in account",
            },
            {
              term: "Reconciliation start",
              value: workspace.reconciliationStartAt ? (
                <LocalDateTime iso={workspace.reconciliationStartAt} />
              ) : (
                "Last 90 days"
              ),
            },
            { term: "Workspace ID", value: <span className="font-mono text-xs">{workspace.id}</span> },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function SafetyCard() {
  const controls = [
    "Airwallex keys, tokens and the Supabase session never reach the browser.",
    "Only the exact sandbox host is accepted while sandbox-only mode is on.",
    "Balances come from Airwallex reads; nothing is estimated or filled in.",
    "Expected receipts are forecasts and are never added to available cash.",
    "The cash plan is calculated by deterministic code; AI may explain it but never sets an amount.",
    "Plans are immutable versions tied to the balance snapshot and reserve they used.",
    "Every refresh, plan, decision and failure is written to an append-only audit trail.",
  ];
  return (
    <Card className="@4xl/main:col-span-2">
      <CardHeader>
        <CardTitle>Safety controls</CardTitle>
        <CardDescription>Guarantees enforced in server code, not in the browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-3 text-sm @2xl/main:grid-cols-2">
          {controls.map((control) => (
            <li key={control} className="flex gap-2">
              <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>{control}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CardSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <Card aria-busy="true" className={wide ? "@4xl/main:col-span-2" : undefined}>
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}
