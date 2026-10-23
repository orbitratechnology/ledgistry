"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { OBLIGATION_STATUS_LABEL, PRIORITY_LABEL, type ObligationStatus } from "@/lib/finance/states";
import { currencyExponent, formatMoney } from "@/lib/money";
import {
  fieldErrorsFrom,
  formValues,
  obligationFormSchema,
  type FormState,
} from "@/lib/validation/forms";
import { recordAuditEvent } from "@/server/audit/record";
import { requireWorkspace } from "@/server/auth/session";
import { listBeneficiaries } from "@/server/airwallex/beneficiaries";
import { getAirwallexClient } from "@/server/airwallex/client";

const idSchema = z.uuid();

async function resolveBeneficiary(beneficiaryId: string | null, currency: string) {
  if (!beneficiaryId) return { ok: true as const, label: null, warning: null };
  try {
    const beneficiaries = await listBeneficiaries(getAirwallexClient());
    const match = beneficiaries.find((beneficiary) => beneficiary.id === beneficiaryId);
    if (!match) return { ok: false as const, error: "This beneficiary no longer exists in Airwallex." };
    const warning =
      match.currency && match.currency !== currency
        ? `The beneficiary's account is in ${match.currency}, not ${currency}. Check before paying.`
        : null;
    return { ok: true as const, label: match.label, warning };
  } catch {
    return {
      ok: false as const,
      error: "Couldn't verify the beneficiary with Airwallex right now. Try again or leave it empty.",
    };
  }
}

/** Creates (no id) or updates an obligation. Payment-locked fields are enforced by the database. */
export async function saveObligationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  const values = formValues(formData);
  const idInput = values.id || null;
  if (idInput && !idSchema.safeParse(idInput).success) {
    return { message: "This obligation could not be found.", values };
  }

  const parsed = obligationFormSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  const input = parsed.data;

  const beneficiary = await resolveBeneficiary(input.beneficiaryId, input.currency);
  if (!beneficiary.ok) return { fieldErrors: { beneficiaryId: beneficiary.error }, values };

  const record = {
    payee_name: input.payeeName,
    description: input.description,
    invoice_reference: input.invoiceReference,
    amount_minor: Number(input.amountMinor),
    currency: input.currency,
    due_date: input.dueDate,
    priority: input.priority,
    status: input.status,
    beneficiary_id: input.beneficiaryId,
    beneficiary_label: beneficiary.label,
    notes: input.notes,
  };
  const amountLabel = formatMoney(input.amountMinor, input.currency, currencyExponent(input.currency));

  if (!idInput) {
    const { data, error } = await supabase
      .from("obligations")
      .insert({ ...record, workspace_id: workspace.id })
      .select("id")
      .single();
    if (error || !data) return { message: error?.message ?? "Could not save the obligation.", values };

    await recordAuditEvent(supabase, {
      workspaceId: workspace.id,
      actor: { type: "user", userId: user.id },
      eventType: "obligation.created",
      entityType: "obligation",
      entityId: data.id,
      outcome: "success",
      summary: `Created obligation to ${input.payeeName}: ${amountLabel} due ${input.dueDate} (${PRIORITY_LABEL[input.priority]}).`,
      metadata: { amount_minor: record.amount_minor, currency: input.currency, priority: input.priority },
    });
    refresh();
    return { ok: true, message: beneficiary.warning ?? "Obligation created." };
  }

  const { data: before, error: loadError } = await supabase
    .from("obligations")
    .select("payee_name, description, invoice_reference, amount_minor, currency, due_date, priority, status, beneficiary_id, notes, version")
    .eq("id", idInput)
    .maybeSingle();
  if (loadError || !before) return { message: "This obligation could not be found.", values };

  const { data: after, error } = await supabase
    .from("obligations")
    .update(record)
    .eq("id", idInput)
    .select("version")
    .single();
  if (error || !after) return { message: error?.message ?? "Could not save the obligation.", values };

  const changed = (Object.keys(record) as (keyof typeof record)[]).filter(
    (key) => key !== "beneficiary_label" && String(before[key as keyof typeof before] ?? "") !== String(record[key] ?? ""),
  );
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: "obligation.updated",
    entityType: "obligation",
    entityId: idInput,
    outcome: "success",
    summary:
      changed.length === 0
        ? `Saved obligation to ${input.payeeName} with no changes.`
        : `Updated obligation to ${input.payeeName}: ${changed.join(", ").replaceAll("_", " ")}${
            after.version !== before.version ? ` (payment details changed, version ${after.version})` : ""
          }.`,
    metadata: { changed_fields: changed, version: after.version, status: input.status },
  });
  refresh();
  return { ok: true, message: beneficiary.warning ?? "Obligation updated." };
}

async function setArchived(id: string, archived: boolean): Promise<{ ok: boolean; message: string }> {
  const { supabase, workspace, user } = await requireWorkspace();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Obligation not found." };

  const { data, error } = await supabase
    .from("obligations")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("payee_name, status")
    .single();
  if (error || !data) return { ok: false, message: error?.message ?? "Obligation not found." };

  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: archived ? "obligation.archived" : "obligation.restored",
    entityType: "obligation",
    entityId: id,
    outcome: "success",
    summary: `${archived ? "Archived" : "Restored"} obligation to ${data.payee_name} (${OBLIGATION_STATUS_LABEL[data.status as ObligationStatus]}).`,
  });
  refresh();
  return { ok: true, message: archived ? "Obligation archived." : "Obligation restored." };
}

export async function archiveObligationAction(id: string) {
  return setArchived(id, true);
}

export async function restoreObligationAction(id: string) {
  return setArchived(id, false);
}
