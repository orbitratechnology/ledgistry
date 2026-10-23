import "server-only";

import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { fetchCurrentBalances, type BalanceNormalizationIssue } from "@/server/airwallex/balances";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";

export type RefreshBalancesResult =
  | {
      ok: true;
      syncRunId: string;
      currencyCount: number;
      fundedCurrencyCount: number;
      issues: BalanceNormalizationIssue[];
    }
  | { ok: false; message: string };

/** bigint → JSON-safe number for PostgREST; amounts beyond 2^53 minor units are refused. */
function minorForDb(value: bigint | null): number | null {
  if (value === null) return null;
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new RangeError("Balance exceeds the supported minor-unit range");
  }
  return asNumber;
}

/**
 * Reads current balances from Airwallex and stores them as an immutable snapshot tied to a
 * sync run. Failures are recorded on the run and in the audit trail with a safe summary.
 */
export async function refreshBalances({
  supabase,
  workspace,
  user,
}: WorkspaceContext): Promise<RefreshBalancesResult> {
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ workspace_id: workspace.id, kind: "balances", started_by: user.id })
    .select("id")
    .single();
  if (runError || !run) {
    return { ok: false, message: "Could not start the balance refresh. Try again." };
  }

  try {
    const result = await fetchCurrentBalances(getAirwallexClient());
    const fetchedAt = result.fetchedAt.toISOString();

    if (result.balances.length > 0) {
      const { error: insertError } = await supabase.from("balance_snapshots").insert(
        result.balances.map((balance) => ({
          workspace_id: workspace.id,
          sync_run_id: run.id,
          provider: "airwallex",
          currency: balance.currency,
          currency_exponent: balance.exponent,
          account_type: balance.accountType,
          available_amount_minor: minorForDb(balance.availableMinor),
          pending_amount_minor: minorForDb(balance.pendingMinor),
          reserved_amount_minor: minorForDb(balance.reservedMinor),
          total_amount_minor: minorForDb(balance.totalMinor),
          prepayment_amount_minor: minorForDb(balance.prepaymentMinor),
          fetched_at: fetchedAt,
        })),
      );
      if (insertError) throw new Error(`Snapshot insert failed (${insertError.code})`);
    }

    const funded = result.balances.filter(
      (balance) => (balance.totalMinor ?? 0n) !== 0n || (balance.availableMinor ?? 0n) !== 0n,
    );

    const { error: finishError } = await supabase
      .from("sync_runs")
      .update({
        status: "succeeded",
        item_count: result.balances.length,
        provider_correlation_id: result.correlationId,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (finishError) throw new Error(`Could not finish sync run (${finishError.code})`);

    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "balances.refreshed",
      entityType: "sync_run",
      entityId: run.id,
      outcome: result.issues.length > 0 ? "info" : "success",
      summary: `Refreshed Airwallex balances: ${result.balances.length} currencies, ${funded.length} with funds.`,
      metadata: {
        currencies_with_funds: funded.map((balance) => balance.currency),
        currency_count: result.balances.length,
        unreadable_currencies: result.issues.map((issue) => issue.currency),
        provider_correlation_id: result.correlationId,
      },
    });

    return {
      ok: true,
      syncRunId: run.id,
      currencyCount: result.balances.length,
      fundedCurrencyCount: funded.length,
      issues: result.issues,
    };
  } catch (error) {
    const providerError = error instanceof AirwallexError ? error : null;
    if (!providerError) console.error("[balances] refresh failed", error);
    const message =
      providerError?.safeMessage ?? "Unexpected error while refreshing balances. Try again.";

    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        error_code: providerError?.kind ?? "internal_error",
        safe_error_summary: message,
        provider_correlation_id: providerError?.correlationId ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "balances.refresh_failed",
      entityType: "sync_run",
      entityId: run.id,
      outcome: "failure",
      summary: message,
      metadata: {
        error_kind: providerError?.kind ?? "internal_error",
        http_status: providerError?.status ?? null,
        provider_code: providerError?.providerCode ?? null,
        provider_correlation_id: providerError?.correlationId ?? null,
      },
    });

    return { ok: false, message };
  }
}
