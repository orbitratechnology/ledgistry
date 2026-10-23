/** "What changed" between two plan versions, derived only from their structured facts. */

import { formatMoney } from "@/lib/money";
import type { PlanDecision, PlanResult } from "./plan";

export type PlanChange = {
  kind: "balance" | "reserve" | "forecast" | "decision" | "added" | "removed";
  text: string;
};

const DECISION_LABEL: Record<PlanDecision, string> = {
  recommended: "Recommended",
  needs_details: "Needs payment details",
  deferred: "Deferred",
  blocked: "Blocked",
};

export function diffPlans(previous: PlanResult, current: PlanResult): PlanChange[] {
  const money = (minor: bigint) => formatMoney(minor, current.currency, current.exponent);
  const changes: PlanChange[] = [];

  const before = previous.summary.availableMinor;
  const after = current.summary.availableMinor;
  if (before !== after) {
    changes.push({
      kind: "balance",
      text:
        before === null || after === null
          ? `Available cash is now ${after === null ? "unavailable" : money(after)}.`
          : `Available cash ${after > before ? "rose" : "fell"} from ${money(before)} to ${money(after)}.`,
    });
  }
  if (previous.reserveMinor !== current.reserveMinor) {
    changes.push({
      kind: "reserve",
      text: `The protected reserve changed from ${money(previous.reserveMinor)} to ${money(current.reserveMinor)}.`,
    });
  }
  const forecastBefore = previous.forecast?.totalMinor ?? 0n;
  const forecastAfter = current.forecast?.totalMinor ?? 0n;
  if (forecastBefore !== forecastAfter) {
    changes.push({
      kind: "forecast",
      text: `Expected receipts still outstanding (forecast) changed from ${money(forecastBefore)} to ${money(forecastAfter)}.`,
    });
  }

  const previousItems = new Map(previous.items.map((item) => [item.obligationId, item]));
  const currentIds = new Set(current.items.map((item) => item.obligationId));
  for (const item of current.items) {
    const old = previousItems.get(item.obligationId);
    const label = `${item.payeeName} (${money(item.amountMinor)})`;
    if (!old) {
      changes.push({ kind: "added", text: `${label} entered the plan as ${DECISION_LABEL[item.decision]}.` });
    } else if (old.decision !== item.decision) {
      changes.push({
        kind: "decision",
        text: `${label} moved from ${DECISION_LABEL[old.decision]} to ${DECISION_LABEL[item.decision]}.`,
      });
    } else if (old.amountMinor !== item.amountMinor) {
      changes.push({
        kind: "decision",
        text: `${item.payeeName} changed from ${money(old.amountMinor)} to ${money(item.amountMinor)} and stays ${DECISION_LABEL[item.decision]}.`,
      });
    }
  }
  for (const old of previous.items) {
    if (!currentIds.has(old.obligationId)) {
      changes.push({ kind: "removed", text: `${old.payeeName} (${money(old.amountMinor)}) is no longer in the plan.` });
    }
  }
  return changes;
}
