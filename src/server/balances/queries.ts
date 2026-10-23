import "server-only";

import { parseMinor } from "@/lib/money";
import type { WorkspaceContext } from "@/server/auth/session";

export type SnapshotBalance = {
  id: string;
  currency: string;
  exponent: number;
  accountType: string;
  availableMinor: bigint | null;
  pendingMinor: bigint | null;
  reservedMinor: bigint | null;
  totalMinor: bigint | null;
};

export type BalanceOverview = {
  latest: {
    syncRunId: string;
    fetchedAt: string;
    balances: SnapshotBalance[];
  } | null;
  /** Set when the most recent refresh attempt failed after the last good snapshot. */
  lastFailure: { at: string; message: string } | null;
};

/** Latest successful balance snapshot plus any newer failed attempt. Amounts are read as text. */
export async function getBalanceOverview({
  supabase,
  workspace,
}: WorkspaceContext): Promise<BalanceOverview> {
  const { data: runs, error } = await supabase
    .from("sync_runs")
    .select("id, status, finished_at, safe_error_summary")
    .eq("workspace_id", workspace.id)
    .eq("kind", "balances")
    .neq("status", "running")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) throw new Error("Could not load balance history.");

  const lastSuccess = runs.find((run) => run.status === "succeeded") ?? null;
  const newest = runs[0] ?? null;
  const lastFailure =
    newest && newest.status === "failed"
      ? {
          at: newest.finished_at ?? "",
          message: newest.safe_error_summary ?? "The last balance refresh failed.",
        }
      : null;

  if (!lastSuccess) return { latest: null, lastFailure };

  const { data: rows, error: rowsError } = await supabase
    .from("balance_snapshots")
    .select(
      "id, currency, currency_exponent, account_type, fetched_at, available:available_amount_minor::text, pending:pending_amount_minor::text, reserved:reserved_amount_minor::text, total:total_amount_minor::text",
    )
    .eq("sync_run_id", lastSuccess.id)
    .order("currency");
  if (rowsError) throw new Error("Could not load the latest balances.");

  return {
    latest: {
      syncRunId: lastSuccess.id,
      fetchedAt: rows[0]?.fetched_at ?? lastSuccess.finished_at ?? "",
      balances: rows.map((row) => ({
        id: row.id,
        currency: row.currency,
        exponent: row.currency_exponent,
        accountType: row.account_type,
        availableMinor: parseMinor(row.available),
        pendingMinor: parseMinor(row.pending),
        reservedMinor: parseMinor(row.reserved),
        totalMinor: parseMinor(row.total),
      })),
    },
    lastFailure,
  };
}
