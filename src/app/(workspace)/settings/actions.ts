"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { currencyExponent, formatMoney, parseMinor } from "@/lib/money";
import { fieldErrorsFrom, formValues, reserveFormSchema, type FormState } from "@/lib/validation/forms";
import { recordAuditEvent } from "@/server/audit/record";
import { requireWorkspace } from "@/server/auth/session";
import { loadDemoData, removeDemoData, resetDemoData, type DemoOutcome } from "@/server/demo/service";
import { recalculatePlans } from "@/server/planner/recalculate";

/** Re-runs the live connection check by re-rendering the Settings page. */
export async function recheckConnectionAction(): Promise<void> {
  await requireWorkspace();
  refresh();
}

/** Creates or updates the protected reserve for one currency, then replans. */
export async function saveReserveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  const values = formValues(formData);
  const parsed = reserveFormSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values };
  const { currency, amountMinor } = parsed.data;
  const money = (minor: bigint) => formatMoney(minor, currency, currencyExponent(currency));

  const { data: existing, error: loadError } = await supabase
    .from("reserve_policies")
    .select("id, enabled, amount:reserve_amount_minor::text")
    .eq("workspace_id", workspace.id)
    .eq("currency", currency)
    .maybeSingle();
  if (loadError) return { message: "Could not load the reserve. Try again.", values };

  const { data, error } = existing
    ? await supabase
        .from("reserve_policies")
        .update({ reserve_amount_minor: Number(amountMinor) })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase
        .from("reserve_policies")
        .insert({ workspace_id: workspace.id, currency, reserve_amount_minor: Number(amountMinor) })
        .select("id")
        .single();
  if (error || !data) return { message: "Could not save the reserve. Try again.", values };

  const previous = existing ? parseMinor(existing.amount) : null;
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: existing ? "reserve.updated" : "reserve.created",
    entityType: "reserve_policy",
    entityId: data.id,
    outcome: "success",
    summary:
      previous !== null
        ? `Changed the protected ${currency} reserve from ${money(previous)} to ${money(amountMinor)}${existing?.enabled ? "" : " (protection is still off)"}.`
        : `Set a protected ${currency} reserve of ${money(amountMinor)}.`,
    metadata: { currency, amount_minor: amountMinor.toString(), previous_minor: previous?.toString() ?? null },
  });

  const plan = await recalculatePlans(context, "reserve_change");
  refresh();
  return {
    ok: true,
    message: `${currency} reserve set to ${money(amountMinor)}.${plan.ok ? " The plan was recalculated." : ` ${plan.message}`}`,
  };
}

/** Switches a reserve's protection on or off; the amount is kept either way. */
export async function setReserveEnabledAction(
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  const context = await requireWorkspace();
  const { supabase, workspace, user } = context;
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Reserve not found." };

  const { data, error } = await supabase
    .from("reserve_policies")
    .update({ enabled })
    .eq("id", id)
    .select("currency, amount:reserve_amount_minor::text")
    .single();
  if (error || !data) return { ok: false, message: "Reserve not found." };

  const label = formatMoney(parseMinor(data.amount) ?? 0n, data.currency, currencyExponent(data.currency));
  await recordAuditEvent(supabase, {
    workspaceId: workspace.id,
    actor: { type: "user", userId: user.id },
    eventType: enabled ? "reserve.enabled" : "reserve.disabled",
    entityType: "reserve_policy",
    entityId: id,
    outcome: enabled ? "success" : "info",
    summary: enabled
      ? `Turned on protection for the ${label} reserve.`
      : `Turned off protection for the ${label} reserve: the planner now protects nothing in ${data.currency}.`,
  });
  await recalculatePlans(context, "reserve_change");
  refresh();
  return { ok: true, message: enabled ? `${data.currency} reserve protection on.` : `${data.currency} reserve protection off.` };
}

/** Loads the sample records for the demo scenario (idempotent). Never changes Airwallex state. */
export async function loadDemoDataAction(): Promise<DemoOutcome> {
  const context = await requireWorkspace();
  const result = await loadDemoData(context);
  refresh();
  return result;
}

/** Archives the active sample records and loads fresh ones. Audit history is kept. */
export async function resetDemoDataAction(): Promise<DemoOutcome> {
  const context = await requireWorkspace();
  const result = await resetDemoData(context);
  refresh();
  return result;
}

/** Archives the active sample records without loading new ones. */
export async function removeDemoDataAction(): Promise<DemoOutcome> {
  const context = await requireWorkspace();
  const result = await removeDemoData(context);
  refresh();
  return result;
}
