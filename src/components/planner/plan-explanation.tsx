import { RotateCcwIcon, SparklesIcon } from "lucide-react";

import { retryPlanExplanationAction } from "@/app/(workspace)/overview/actions";
import { ActionButton } from "@/components/common/action-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlanChange } from "@/lib/planner/diff";
import type { PlanResult } from "@/lib/planner/plan";
import { getPlanExplanation } from "@/server/ai/plan-explanations";
import { requireWorkspace } from "@/server/auth/session";

/**
 * Claude's plain-language reading of an immutable plan, generated once per version and cached.
 * The plan above it is complete without this card; failures fall back to the deterministic view.
 */
export async function PlanExplanation({
  planId,
  version,
  plan,
  changes,
}: {
  planId: string;
  version: number;
  plan: PlanResult;
  changes: PlanChange[];
}) {
  const context = await requireWorkspace();
  const explanation = await getPlanExplanation(context, planId, version, plan, changes);

  return (
    <Card size="sm" data-testid="plan-explanation" data-status={explanation.status}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" aria-hidden="true" />
          Plain-language explanation
        </CardTitle>
        <CardDescription>Written by Claude from plan v{version}. It explains; it does not decide.</CardDescription>
        <CardAction>
          <Badge variant="outline">AI</Badge>
        </CardAction>
      </CardHeader>
      {explanation.status === "ready" ? (
        <>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="font-medium" data-testid="plan-explanation-headline">
              {explanation.content.headline}
            </p>
            <p>{explanation.content.summary}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {explanation.content.keyFacts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            {explanation.content.limitations.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                {explanation.content.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Checked before display: any figure that is not in the plan is rejected.
          </CardFooter>
        </>
      ) : (
        <CardContent className="flex flex-col gap-3 text-sm">
          <p role="status">
            {explanation.message} The plan is complete without it: every reason shown comes from the planner.
          </p>
          {explanation.kind !== "disabled" ? (
            <div>
              <ActionButton
                size="sm"
                action={retryPlanExplanationAction.bind(null, planId)}
                icon={<RotateCcwIcon data-icon="inline-start" />}
                successTitle="Explanation"
              >
                Try again
              </ActionButton>
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

export function PlanExplanationSkeleton() {
  return (
    <Card size="sm" aria-busy="true" aria-label="Preparing the explanation">
      <CardHeader className="gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </CardContent>
    </Card>
  );
}
