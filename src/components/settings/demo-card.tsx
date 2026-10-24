import {
  ArchiveIcon,
  CircleCheckIcon,
  CircleXIcon,
  DatabaseIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";

import { loadDemoDataAction, removeDemoDataAction, resetDemoDataAction } from "@/app/(workspace)/settings/actions";
import { ActionButton } from "@/components/common/action-button";
import { LocalDateTime } from "@/components/common/freshness";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_PARTIAL_DEPOSIT_MINOR, DEMO_STARTING_AVAILABLE_MINOR, usd, type ReadinessState } from "@/lib/demo/scenario";
import { requireWorkspace } from "@/server/auth/session";
import { getDemoStatus } from "@/server/demo/service";

const STATE: Record<ReadinessState, { icon: LucideIcon; className: string; label: string }> = {
  ready: { icon: CircleCheckIcon, className: "text-success", label: "Ready" },
  attention: { icon: TriangleAlertIcon, className: "text-warning", label: "Needs attention" },
  missing: { icon: CircleXIcon, className: "text-destructive", label: "Missing" },
};

const STEPS = [
  "Refresh balances: the plan uses the live Airwallex USD balance.",
  "On Overview, the plan recommends Pacific Freight Co. and defers Brightline Packaging Ltd to protect the reserve.",
  "Review the freight payment, approve it once, and watch Airwallex move it to PAID (Sandbox: simulate paid).",
  `On Reconciliation, simulate a ${usd(DEMO_PARTIAL_DEPOSIT_MINOR)} deposit from Harbor Retail Ltd with reference HR-INV-2041 into the USD account.`,
  "Confirm the suggested match: the receipt stays partially received with the shortfall outstanding.",
  "Back on Overview, the recalculated plan explains what changed; Activity shows the whole chain.",
];

/** Readiness of the sandbox and workspace for the demo, plus the idempotent load and reset. */
export async function DemoCard() {
  const status = await getDemoStatus(await requireWorkspace());
  const ready = status.items.every((item) => item.state === "ready");

  return (
    <Card className="@4xl/main:col-span-2" data-testid="demo-card">
      <CardHeader>
        <CardTitle>Demo scenario</CardTitle>
        <CardDescription>
          A {usd(DEMO_STARTING_AVAILABLE_MINOR)} cash position, a protected reserve and two supplier bills competing for it.
          Only sample business records are created, labelled <span className="font-medium">Demo record</span>; balances
          and transfer statuses always come from Airwallex Sandbox.
        </CardDescription>
        <CardAction>
          <Badge variant={ready ? "success" : "warning"}>
            {ready ? <CircleCheckIcon data-icon="inline-start" /> : <TriangleAlertIcon data-icon="inline-start" />}
            {ready ? "Ready to demo" : "Needs attention"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 @4xl/main:grid-cols-2">
        <section aria-labelledby="demo-readiness-heading" className="flex flex-col gap-3">
          <h3 id="demo-readiness-heading" className="text-sm font-medium">
            Readiness
          </h3>
          <ul className="flex flex-col gap-3 text-sm">
            {status.items.map((item) => {
              const state = STATE[item.state];
              return (
                <li key={item.id} className="flex gap-2" data-testid={`demo-check-${item.id}`} data-state={item.state}>
                  <state.icon className={`mt-0.5 size-4 shrink-0 ${state.className}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {item.label} <span className="sr-only">({state.label})</span>
                    </p>
                    <p className="break-words text-muted-foreground">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {status.reconciliationStartAt ? (
              <>
                Reconciliation starts <LocalDateTime iso={status.reconciliationStartAt} />: deposits created earlier are not
                imported, so the demo only shows its own evidence.
              </>
            ) : (
              "Reconciliation imports deposits from the last 90 days. Loading demo data starts it from now."
            )}
          </p>
        </section>
        <section aria-labelledby="demo-steps-heading" className="flex flex-col gap-3">
          <h3 id="demo-steps-heading" className="text-sm font-medium">
            Run the demo
          </h3>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm marker:text-muted-foreground">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <ActionButton
          variant={status.activeRecords > 0 ? "outline" : "default"}
          action={loadDemoDataAction}
          icon={<DatabaseIcon data-icon="inline-start" />}
          successTitle="Demo data"
        >
          Load demo data
        </ActionButton>
        {status.activeRecords > 0 ? (
          <ActionButton
            action={resetDemoDataAction}
            icon={<RotateCcwIcon data-icon="inline-start" />}
            successTitle="Demo data reset"
            confirm={{
              title: "Reset demo data?",
              description: `Archives the sample obligations and expected receipt (their history stays in the activity trail), creates fresh ones and restarts reconciliation from now. Airwallex balances and transfers are not changed: run "bun run demo:balance" to restore the ${usd(DEMO_STARTING_AVAILABLE_MINOR)} starting balance.`,
              confirmLabel: "Reset demo data",
            }}
          >
            Reset demo data
          </ActionButton>
        ) : null}
        {status.activeRecords > 0 ? (
          <ActionButton
            variant="ghost"
            action={removeDemoDataAction}
            icon={<ArchiveIcon data-icon="inline-start" />}
            successTitle="Demo data removed"
            confirm={{
              title: "Remove demo data?",
              description:
                "Archives the sample obligations and expected receipt. Their history stays in the activity trail; nothing at Airwallex changes.",
              confirmLabel: "Remove demo data",
            }}
          >
            Remove demo data
          </ActionButton>
        ) : null}
      </CardFooter>
    </Card>
  );
}
