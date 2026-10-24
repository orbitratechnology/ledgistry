import "server-only";

import {
  assessDemoReadiness,
  DEMO_BENEFICIARY_LABEL,
  DEMO_CURRENCY,
  DEMO_RESERVE_MINOR,
  demoRecords,
  usd,
  type ReadinessItem,
} from "@/lib/demo/scenario";
import { todayIso } from "@/lib/finance/states";
import { ACTIVE_PAYMENT_STATUSES } from "@/lib/payments/status";
import { recordAuditEvent } from "@/server/audit/record";
import type { WorkspaceContext } from "@/server/auth/session";
import { listBeneficiaries, type BeneficiarySummary } from "@/server/airwallex/beneficiaries";
import { getAirwallexClient } from "@/server/airwallex/client";
import { checkAirwallexConnection } from "@/server/airwallex/connection";
import { listGlobalAccounts } from "@/server/airwallex/global-accounts";
import { getBalanceOverview } from "@/server/balances/queries";
import { recalculatePlans } from "@/server/planner/recalculate";
import { listReservePolicies } from "@/server/planner/inputs";

export type DemoOutcome = { ok: boolean; message: string; warnings?: string[] };

/** The sandbox beneficiary sample payments go to: the preferred label, else any USD LOCAL one. */
function demoBeneficiary(beneficiaries: BeneficiarySummary[]): BeneficiarySummary | null {
  const usdLocal = beneficiaries.filter(
    (beneficiary) => beneficiary.currency === DEMO_CURRENCY && beneficiary.transferMethods.includes("LOCAL"),
  );
  return usdLocal.find((beneficiary) => beneficiary.label === DEMO_BENEFICIARY_LABEL) ?? usdLocal[0] ?? null;
}

async function countActiveDemoRecords({ supabase, workspace }: WorkspaceContext) {
  const [obligations, receipts] = await Promise.all([
    supabase
      .from("obligations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("is_demo", true)
      .is("archived_at", null),
    supabase
      .from("expected_receipts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("is_demo", true)
      .is("archived_at", null),
  ]);
  return { obligations: obligations.count ?? 0, receipts: receipts.count ?? 0 };
}

export type DemoStatus = {
  items: ReadinessItem[];
  activeRecords: number;
  reconciliationStartAt: string | null;
};

/** Live readiness of the sandbox and this workspace for the demo scenario. */
export async function getDemoStatus(context: WorkspaceContext): Promise<DemoStatus> {
  const client = getAirwallexClient();
  const [connection, accounts, beneficiaries, balances, reserves, counts] = await Promise.all([
    checkAirwallexConnection(),
    listGlobalAccounts(client).catch(() => undefined),
    listBeneficiaries(client).catch(() => undefined),
    getBalanceOverview(context),
    listReservePolicies(context),
    countActiveDemoRecords(context),
  ]);
  const usdAccount = accounts?.find((account) => account.baseCurrency === DEMO_CURRENCY);
  const usdBalance = balances.latest?.balances.find((balance) => balance.currency === DEMO_CURRENCY);
  const reserve = reserves.find((policy) => policy.currency === DEMO_CURRENCY);

  return {
    items: assessDemoReadiness({
      connected: connection.state === "connected",
      connectionMessage: connection.message,
      usdGlobalAccount: accounts === undefined ? undefined : usdAccount ? { label: usdAccount.label, status: usdAccount.status } : null,
      beneficiary: beneficiaries === undefined ? undefined : (demoBeneficiary(beneficiaries) ?? null),
      usdAvailableMinor: usdBalance?.availableMinor ?? null,
      reserve: reserve ? { amountMinor: reserve.amountMinor, enabled: reserve.enabled } : null,
      demoObligations: counts.obligations,
      demoReceipts: counts.receipts,
    }),
    activeRecords: counts.obligations + counts.receipts,
    reconciliationStartAt: context.workspace.reconciliationStartAt,
  };
}

/** Sets the USD reserve to the scenario's amount, switched on. Returns a summary when it changed. */
async function ensureDemoReserve(context: WorkspaceContext): Promise<string | null> {
  const { supabase, workspace, user } = context;
  const existing = (await listReservePolicies(context)).find((policy) => policy.currency === DEMO_CURRENCY);
  if (existing && existing.amountMinor === DEMO_RESERVE_MINOR && existing.enabled) return null;

  const { data, error } = existing
    ? await supabase
        .from("reserve_policies")
        .update({ reserve_amount_minor: Number(DEMO_RESERVE_MINOR), enabled: true })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase
        .from("reserve_policies")
        .insert({ workspace_id: workspace.id, currency: DEMO_CURRENCY, reserve_amount_minor: Number(DEMO_RESERVE_MINOR) })
        .select("id")
        .single();
  if (error || !data) throw new Error("Could not set the demo reserve.");

  const summary = existing
    ? `Changed the protected USD reserve from ${usd(existing.amountMinor)}${existing.enabled ? "" : " (off)"} to ${usd(DEMO_RESERVE_MINOR)} for the demo.`
    : `Set a protected USD reserve of ${usd(DEMO_RESERVE_MINOR)} for the demo.`;
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: existing ? "reserve.updated" : "reserve.created",
    entityType: "reserve_policy",
    entityId: data.id,
    outcome: "success",
    summary,
    metadata: {
      currency: DEMO_CURRENCY,
      amount_minor: DEMO_RESERVE_MINOR.toString(),
      previous_minor: existing?.amountMinor.toString() ?? null,
      demo: true,
    },
  });
  return summary;
}

/** Deposits created before now are not imported, so the demo starts from its own evidence. */
async function startReconciliationNow(context: WorkspaceContext): Promise<string> {
  const startAt = new Date().toISOString();
  const { error } = await context.supabase
    .from("workspaces")
    .update({ reconciliation_start_at: startAt })
    .eq("id", context.workspace.id);
  if (error) throw new Error("Could not set the reconciliation start date.");
  context.workspace.reconciliationStartAt = startAt;
  return startAt;
}

/**
 * Creates the sample records that are not already active, sets the USD reserve and starts
 * reconciliation now. Running it again changes nothing. Never touches Airwallex state.
 */
export async function loadDemoData(context: WorkspaceContext, { reset = false } = {}): Promise<DemoOutcome> {
  const { supabase, workspace, user } = context;
  const today = todayIso();
  const { obligations, receipts } = demoRecords(today);
  const warnings: string[] = [];

  const beneficiaries = await listBeneficiaries(getAirwallexClient()).catch(() => null);
  const beneficiary = beneficiaries ? demoBeneficiary(beneficiaries) : null;
  if (!beneficiary) {
    warnings.push(
      beneficiaries
        ? "No USD LOCAL beneficiary exists in the sandbox, so the sample obligations have no payment details."
        : "Couldn't read beneficiaries from Airwallex, so the sample obligations have no payment details. Load again later.",
    );
  }

  const [{ data: activeObligations }, { data: activeReceipts }] = await Promise.all([
    supabase.from("obligations").select("payee_name").eq("workspace_id", workspace.id).eq("is_demo", true).is("archived_at", null),
    supabase.from("expected_receipts").select("reference").eq("workspace_id", workspace.id).eq("is_demo", true).is("archived_at", null),
  ]);
  const existingPayees = new Set((activeObligations ?? []).map((row) => row.payee_name));
  const existingReferences = new Set((activeReceipts ?? []).map((row) => row.reference));

  const missingObligations = obligations.filter((obligation) => !existingPayees.has(obligation.payeeName));
  const missingReceipts = receipts.filter((receipt) => !existingReferences.has(receipt.reference));

  if (missingObligations.length > 0) {
    const { error } = await supabase.from("obligations").insert(
      missingObligations.map((obligation) => ({
        workspace_id: workspace.id,
        payee_name: obligation.payeeName,
        description: obligation.description,
        invoice_reference: obligation.invoiceReference,
        amount_minor: Number(obligation.amountMinor),
        currency: DEMO_CURRENCY,
        due_date: obligation.dueDate,
        priority: obligation.priority,
        status: "planned",
        beneficiary_id: beneficiary?.id ?? null,
        beneficiary_label: beneficiary?.label ?? null,
        notes: obligation.notes,
        is_demo: true,
      })),
    );
    // 23505: a concurrent load created them first (one active sample record per payee).
    if (error && error.code !== "23505") return { ok: false, message: "Could not create the sample obligations." };
  }
  if (missingReceipts.length > 0) {
    const { error } = await supabase.from("expected_receipts").insert(
      missingReceipts.map((receipt) => ({
        workspace_id: workspace.id,
        payer_name: receipt.payerName,
        reference: receipt.reference,
        expected_amount_minor: Number(receipt.expectedAmountMinor),
        currency: DEMO_CURRENCY,
        expected_date: receipt.expectedDate,
        notes: receipt.notes,
        is_demo: true,
      })),
    );
    if (error && error.code !== "23505") return { ok: false, message: "Could not create the sample expected receipt." };
  }

  const reserveChange = await ensureDemoReserve(context);
  const created = missingObligations.length + missingReceipts.length;
  const startAt = created > 0 || reset ? await startReconciliationNow(context) : workspace.reconciliationStartAt;

  if (created === 0 && !reserveChange) {
    return { ok: true, message: "Demo data is already loaded; nothing changed.", warnings };
  }

  const parts = [
    missingObligations.length > 0 ? `${missingObligations.length} sample obligation${missingObligations.length === 1 ? "" : "s"}` : null,
    missingReceipts.length > 0 ? `${missingReceipts.length} sample expected receipt${missingReceipts.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const summary = `${reset ? "Reloaded" : "Loaded"} demo data: ${parts.length > 0 ? `created ${parts.join(" and ")}` : "records were already present"}${
    reserveChange ? `; USD reserve set to ${usd(DEMO_RESERVE_MINOR)}` : ""
  }. Airwallex balances and transfers were not changed.`;
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: "demo.loaded",
    entityType: "workspace",
    entityId: workspace.id,
    outcome: "success",
    summary,
    metadata: {
      obligations_created: missingObligations.map((obligation) => obligation.payeeName),
      receipts_created: missingReceipts.map((receipt) => receipt.reference),
      reserve_minor: DEMO_RESERVE_MINOR.toString(),
      beneficiary_label: beneficiary?.label ?? null,
      reconciliation_start_at: startAt,
    },
  });

  const plan = await recalculatePlans(context, "demo_data");
  if (!plan.ok) warnings.push(plan.message);
  return { ok: true, message: summary, warnings };
}

/**
 * Archives the active sample records (their audit history stays). Refused while a sample payment
 * is in flight or its outcome is unknown, so a payment that needs attention is never hidden.
 */
async function archiveDemoRecords(context: WorkspaceContext, mode: "reset" | "remove"): Promise<DemoOutcome> {
  const { supabase, workspace, user } = context;
  const { data: demoObligations, error: loadError } = await supabase
    .from("obligations")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("is_demo", true)
    .is("archived_at", null);
  if (loadError) return { ok: false, message: "Could not load the sample records." };
  const ids = (demoObligations ?? []).map((row) => row.id);

  if (ids.length > 0) {
    const { count, error } = await supabase
      .from("payment_operations")
      .select("id", { count: "exact", head: true })
      .in("obligation_id", ids)
      .in("status", [...ACTIVE_PAYMENT_STATUSES]);
    if (error) return { ok: false, message: "Could not check sample payments." };
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message:
          "A sample payment is still in flight or its outcome is unknown. Check its status with Airwallex first; nothing was changed.",
      };
    }
  }

  const archivedAt = new Date().toISOString();
  const [obligationsResult, receiptsResult] = await Promise.all([
    supabase
      .from("obligations")
      .update({ archived_at: archivedAt })
      .eq("workspace_id", workspace.id)
      .eq("is_demo", true)
      .is("archived_at", null)
      .select("id"),
    supabase
      .from("expected_receipts")
      .update({ archived_at: archivedAt })
      .eq("workspace_id", workspace.id)
      .eq("is_demo", true)
      .is("archived_at", null)
      .select("id"),
  ]);
  if (obligationsResult.error || receiptsResult.error) return { ok: false, message: "Could not archive the sample records." };

  const archived = `${obligationsResult.data.length} sample obligation${obligationsResult.data.length === 1 ? "" : "s"} and ${
    receiptsResult.data.length
  } sample expected receipt${receiptsResult.data.length === 1 ? "" : "s"}`;
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: mode === "reset" ? "demo.reset" : "demo.removed",
    entityType: "workspace",
    entityId: workspace.id,
    outcome: "info",
    summary: `${mode === "reset" ? "Reset" : "Removed"} demo data: archived ${archived}. Audit history is kept.`,
    metadata: {
      archived_obligations: obligationsResult.data.map((row) => row.id),
      archived_receipts: receiptsResult.data.map((row) => row.id),
    },
  });
  return { ok: true, message: `Archived ${archived}.` };
}

/** Archives the active sample records and loads fresh ones; reconciliation restarts from now. */
export async function resetDemoData(context: WorkspaceContext): Promise<DemoOutcome> {
  const archived = await archiveDemoRecords(context, "reset");
  if (!archived.ok) return archived;
  return loadDemoData(context, { reset: true });
}

/** Archives the active sample records without loading new ones. */
export async function removeDemoData(context: WorkspaceContext): Promise<DemoOutcome> {
  const archived = await archiveDemoRecords(context, "remove");
  if (!archived.ok) return archived;
  const plan = await recalculatePlans(context, "demo_data");
  return { ok: true, message: `Demo data removed: ${archived.message.charAt(0).toLowerCase()}${archived.message.slice(1)}`, warnings: plan.ok ? [] : [plan.message] };
}
