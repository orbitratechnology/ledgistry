import "server-only";

import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { getAirwallexClient } from "@/server/airwallex/client";
import { fetchDeposits, normalizeDeposits, type ProviderDeposit } from "@/server/airwallex/deposits";
import { AirwallexError } from "@/server/airwallex/errors";
import { generateSuggestions } from "./suggestions";

const LOOKBACK_DAYS = 90;
const CHUNK = 200;
/** The deposit list trails creation (and settlement) by a few seconds; how long to wait for a new deposit. */
const AWAIT_ATTEMPTS = 5;
const AWAIT_DELAY_MS = 2_000;

export type SyncTransactionsResult =
  | {
      ok: true;
      total: number;
      imported: number;
      statusChanged: number;
      suggestions: number;
      warnings: string[];
    }
  | { ok: false; message: string };

/**
 * Imports Airwallex deposits as reconciliation evidence. Re-running is safe: provider IDs are
 * unique per workspace, amounts never change after import, and confirmed matches are untouched.
 * `awaitDepositId` (a deposit just created) re-reads the last day briefly until it is listed and
 * no longer pending. When Airwallex changes a deposit's status, its open suggestions are retired
 * and proposed again, so their evidence never describes a stale status.
 */
export async function syncTransactions(
  context: WorkspaceContext,
  options: { awaitDepositId?: string } = {},
): Promise<SyncTransactionsResult> {
  const { supabase, workspace, user } = context;
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ workspace_id: workspace.id, kind: "transactions", started_by: user.id })
    .select("id")
    .single();
  if (runError || !run) return { ok: false, message: "Could not start the sync. Try again." };

  try {
    const client = getAirwallexClient();
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const fetched = await fetchDeposits(client, since);
    const { correlationId, truncated } = fetched;
    let deposits = fetched.deposits;
    let awaited: ProviderDeposit | undefined;
    if (options.awaitDepositId) {
      const wanted = options.awaitDepositId;
      const settled = (deposit?: ProviderDeposit) => deposit !== undefined && deposit.status.toUpperCase() !== "PENDING";
      awaited = deposits.find((deposit) => deposit.id === wanted);
      for (let attempt = 0; !settled(awaited) && attempt < AWAIT_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, AWAIT_DELAY_MS));
        const recent = await fetchDeposits(client, new Date(Date.now() - 86_400_000));
        awaited = recent.deposits.find((deposit) => deposit.id === wanted) ?? awaited;
      }
      if (awaited) deposits = [...deposits.filter((deposit) => deposit.id !== wanted), awaited];
    }

    const { data: simulations } = await supabase
      .from("sandbox_simulations")
      .select("provider_object_id")
      .eq("workspace_id", workspace.id);
    const simulatedIds = new Set((simulations ?? []).map((row) => row.provider_object_id));
    const { rows, issues } = normalizeDeposits(deposits, simulatedIds);

    let imported = 0;
    const statusChangedIds: string[] = [];
    for (let index = 0; index < rows.length; index += CHUNK) {
      const { data, error } = await supabase.rpc("upsert_provider_transactions", {
        p_workspace_id: workspace.id,
        p_sync_run_id: run.id,
        p_rows: rows.slice(index, index + CHUNK),
      });
      if (error) throw new Error(`Transaction import failed (${error.code})`);
      imported += data.filter((row) => row.inserted).length;
      statusChangedIds.push(...data.filter((row) => row.status_changed).map((row) => row.transaction_id));
    }
    const statusChanged = statusChangedIds.length;

    // Suggestions made under the old status (e.g. "pending, apply once settled") are retired;
    // generateSuggestions below proposes them again with current evidence.
    if (statusChangedIds.length > 0) {
      const { error: retireError } = await supabase
        .from("reconciliation_matches")
        .update({ match_status: "superseded" })
        .in("transaction_id", statusChangedIds)
        .in("match_status", ["suggested", "needs_review"]);
      if (retireError) throw new Error(`Could not refresh suggestions (${retireError.code})`);
    }

    const { error: finishError } = await supabase
      .from("sync_runs")
      .update({
        status: "succeeded",
        item_count: rows.length,
        provider_correlation_id: correlationId,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (finishError) throw new Error(`Could not finish sync run (${finishError.code})`);

    const warnings = issues.map((issue) => `Deposit ${issue.depositId.slice(0, 8)}…: ${issue.message}`);
    if (truncated) warnings.push(`Only the first ${rows.length} deposits were imported this run.`);
    if (options.awaitDepositId && !awaited) {
      warnings.push("Airwallex has not listed the new deposit yet. Sync again in a moment.");
    } else if (awaited && awaited.status.toUpperCase() === "PENDING") {
      warnings.push("Airwallex still reports the new deposit as pending; it can be matched once settled. Sync again in a moment.");
    }

    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "transactions.synced",
      entityType: "sync_run",
      entityId: run.id,
      outcome: warnings.length > 0 ? "info" : "success",
      summary: `Synced ${rows.length} Airwallex deposit${rows.length === 1 ? "" : "s"}: ${imported} new, ${statusChanged} with a changed status.`,
      metadata: {
        deposits: rows.length,
        imported,
        status_changed: statusChanged,
        lookback_days: LOOKBACK_DAYS,
        unreadable: issues.map((issue) => issue.depositId),
        truncated,
        provider_correlation_id: correlationId,
      },
    });

    const suggestions = await generateSuggestions(context);
    return {
      ok: true,
      total: rows.length,
      imported,
      statusChanged,
      suggestions: suggestions.created,
      warnings,
    };
  } catch (error) {
    const providerError = error instanceof AirwallexError ? error : null;
    if (!providerError) console.error("[transactions] sync failed", error);
    const message =
      providerError?.safeMessage ?? "Unexpected error while syncing transactions. Try again.";

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
      eventType: "transactions.sync_failed",
      entityType: "sync_run",
      entityId: run.id,
      outcome: "failure",
      summary: message,
      metadata: {
        error_kind: providerError?.kind ?? "internal_error",
        http_status: providerError?.status ?? null,
        provider_correlation_id: providerError?.correlationId ?? null,
      },
    });
    return { ok: false, message };
  }
}
