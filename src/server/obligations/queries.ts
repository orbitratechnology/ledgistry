import "server-only";

import {
  OBLIGATION_PRIORITIES,
  todayIso,
  type ObligationPriority,
  type ObligationStatus,
} from "@/lib/finance/states";
import { currencyExponent, minorToDecimalString, parseMinor } from "@/lib/money";
import type { WorkspaceContext } from "@/server/auth/session";

export type ObligationView = {
  id: string;
  payeeName: string;
  description: string;
  invoiceReference: string | null;
  amountMinor: bigint;
  /** Plain decimal for pre-filling the edit form, e.g. "6500.00". */
  amountInput: string;
  currency: string;
  exponent: number;
  dueDate: string;
  priority: ObligationPriority;
  status: ObligationStatus;
  beneficiaryId: string | null;
  beneficiaryLabel: string | null;
  notes: string | null;
  archived: boolean;
  isDemo: boolean;
  overdue: boolean;
  version: number;
};

export type ObligationFilters = {
  view: "open" | "all" | "archived";
  currency?: string;
  query?: string;
};

const OPEN_STATUSES: ObligationStatus[] = [
  "draft",
  "planned",
  "approval_required",
  "in_progress",
  "deferred",
  "failed",
];

const priorityRank = (priority: ObligationPriority) => OBLIGATION_PRIORITIES.indexOf(priority);

/** Obligations ordered as the planner will consider them: priority, then due date. */
export async function listObligations(
  { supabase, workspace }: WorkspaceContext,
  filters: ObligationFilters,
): Promise<ObligationView[]> {
  let query = supabase
    .from("obligations")
    .select(
      "id, payee_name, description, invoice_reference, currency, due_date, priority, status, beneficiary_id, beneficiary_label, notes, archived_at, is_demo, version, amount:amount_minor::text",
    )
    .eq("workspace_id", workspace.id);

  if (filters.view === "archived") query = query.not("archived_at", "is", null);
  else query = query.is("archived_at", null);
  if (filters.view === "open") query = query.in("status", OPEN_STATUSES);
  if (filters.currency) query = query.eq("currency", filters.currency);

  const { data, error } = await query;
  if (error) throw new Error("Could not load obligations.");

  const today = todayIso();
  const needle = filters.query?.trim().toLowerCase();

  return data
    .map((row): ObligationView => {
      const exponent = currencyExponent(row.currency);
      const amountMinor = parseMinor(row.amount) ?? 0n;
      const status = row.status as ObligationStatus;
      return {
        id: row.id,
        payeeName: row.payee_name,
        description: row.description,
        invoiceReference: row.invoice_reference,
        amountMinor,
        amountInput: minorToDecimalString(amountMinor, exponent),
        currency: row.currency,
        exponent,
        dueDate: row.due_date,
        priority: row.priority as ObligationPriority,
        status,
        beneficiaryId: row.beneficiary_id,
        beneficiaryLabel: row.beneficiary_label,
        notes: row.notes,
        archived: row.archived_at !== null,
        isDemo: row.is_demo,
        overdue: row.due_date < today && OPEN_STATUSES.includes(status),
        version: row.version,
      };
    })
    .filter(
      (row) =>
        !needle ||
        [row.payeeName, row.description, row.invoiceReference ?? ""].some((text) =>
          text.toLowerCase().includes(needle),
        ),
    )
    .sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.payeeName.localeCompare(b.payeeName),
    );
}
