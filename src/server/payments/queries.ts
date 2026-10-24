import "server-only";

import { currencyExponent, parseMinor } from "@/lib/money";
import type { PaymentStatus } from "@/lib/payments/status";
import type { WorkspaceContext } from "@/server/auth/session";

export type PaymentOperationView = {
  id: string;
  obligationId: string;
  payeeName: string;
  amountMinor: bigint;
  currency: string;
  exponent: number;
  reference: string;
  status: PaymentStatus;
  lastProviderStatus: string | null;
  providerRequestId: string;
  providerTransferId: string | null;
  feeMinor: bigint | null;
  feeCurrency: string | null;
  failureCode: string | null;
  safeErrorSummary: string | null;
  isSandbox: boolean;
  requestStartedAt: string;
  submittedAt: string | null;
  lastVerifiedAt: string | null;
  completedAt: string | null;
};

const OPERATION_COLUMNS =
  "id, obligation_id, currency, reference, status, last_provider_status, provider_request_id, provider_transfer_id, provider_fee_currency, failure_code, safe_error_summary, is_sandbox, request_started_at, submitted_at, last_verified_at, completed_at, amount:amount_minor::text, fee:provider_fee_minor::text, obligations(payee_name)";

type OperationRow = {
  id: string;
  obligation_id: string;
  currency: string;
  reference: string;
  status: string;
  last_provider_status: string | null;
  provider_request_id: string;
  provider_transfer_id: string | null;
  provider_fee_currency: string | null;
  failure_code: string | null;
  safe_error_summary: string | null;
  is_sandbox: boolean;
  request_started_at: string;
  submitted_at: string | null;
  last_verified_at: string | null;
  completed_at: string | null;
  amount: string;
  fee: string | null;
  obligations: { payee_name: string } | null;
};

function toView(row: OperationRow): PaymentOperationView {
  return {
    id: row.id,
    obligationId: row.obligation_id,
    payeeName: row.obligations?.payee_name ?? "Unknown payee",
    amountMinor: parseMinor(row.amount) ?? 0n,
    currency: row.currency,
    exponent: currencyExponent(row.currency),
    reference: row.reference,
    status: row.status as PaymentStatus,
    lastProviderStatus: row.last_provider_status,
    providerRequestId: row.provider_request_id,
    providerTransferId: row.provider_transfer_id,
    feeMinor: parseMinor(row.fee),
    feeCurrency: row.provider_fee_currency,
    failureCode: row.failure_code,
    safeErrorSummary: row.safe_error_summary,
    isSandbox: row.is_sandbox,
    requestStartedAt: row.request_started_at,
    submittedAt: row.submitted_at,
    lastVerifiedAt: row.last_verified_at,
    completedAt: row.completed_at,
  };
}

/** Payment operations, newest first. */
export async function listPaymentOperations(
  { supabase, workspace }: WorkspaceContext,
  { limit = 50, obligationId }: { limit?: number; obligationId?: string } = {},
): Promise<PaymentOperationView[]> {
  let query = supabase
    .from("payment_operations")
    .select(OPERATION_COLUMNS)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (obligationId) query = query.eq("obligation_id", obligationId);
  const { data, error } = await query.overrideTypes<OperationRow[], { merge: false }>();
  if (error) throw new Error("Could not load payments.");
  return data.map(toView);
}

export async function getPaymentOperation(
  { supabase, workspace }: WorkspaceContext,
  operationId: string,
): Promise<PaymentOperationView | null> {
  const { data } = await supabase
    .from("payment_operations")
    .select(OPERATION_COLUMNS)
    .eq("workspace_id", workspace.id)
    .eq("id", operationId)
    .maybeSingle()
    .overrideTypes<OperationRow | null, { merge: false }>();
  return data ? toView(data) : null;
}

/** The newest operation per obligation (for status badges next to obligations and plan items). */
export async function latestOperationByObligation(context: WorkspaceContext): Promise<Map<string, PaymentOperationView>> {
  const operations = await listPaymentOperations(context, { limit: 200 });
  const latest = new Map<string, PaymentOperationView>();
  for (const operation of operations) {
    if (!latest.has(operation.obligationId)) latest.set(operation.obligationId, operation);
  }
  return latest;
}
