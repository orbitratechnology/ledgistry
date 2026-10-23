"use client";

import { CircleAlertIcon, FlaskConicalIcon } from "lucide-react";
import { Suspense, use, useActionState, useState } from "react";

import { simulateDepositAction } from "@/app/(workspace)/reconciliation/actions";
import { FormSheet } from "@/components/common/form-sheet";
import { SelectField, TextField } from "@/components/common/form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import type { FormState } from "@/lib/validation/forms";

export type GlobalAccountOption = { id: string; label: string; currency: string | null; status: string | null };
export type GlobalAccountOptions =
  | { ok: true; items: GlobalAccountOption[] }
  | { ok: false; message: string };

function SimulateForm({
  accountsPromise,
  onDone,
}: {
  accountsPromise: Promise<GlobalAccountOptions>;
  onDone: () => void;
}) {
  const accounts = use(accountsPromise);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await simulateDepositAction(previous, formData);
    if (result.ok) {
      toast.add({ type: "success", title: "Sandbox deposit created", description: result.message });
      onDone();
    }
    return { ...result, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const items = accounts.ok ? accounts.items : [];
  const [selectedId, setSelectedId] = useState(values.globalAccountId ?? items[0]?.id ?? "");

  if (!accounts.ok || items.length === 0) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>No Global Account available</AlertTitle>
        <AlertDescription>
          {accounts.ok
            ? "Simulated deposits need a Global Account in the Airwallex Sandbox account."
            : accounts.message}
        </AlertDescription>
      </Alert>
    );
  }

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  return (
    <form action={formAction} noValidate>
      <FieldGroup key={state.attempt ?? 0}>
        {state.message && !state.ok ? (
          <Alert variant="destructive" aria-live="polite">
            <CircleAlertIcon />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <SelectField
          name="globalAccountId"
          label="Global Account"
          required
          defaultValue={selected.id}
          onValueChange={setSelectedId}
          options={items.map((item) => ({
            value: item.id,
            label: `${item.label}${item.currency ? ` · receives ${item.currency}` : ""}${item.status ? ` · ${item.status.toLowerCase()}` : ""}`,
          }))}
          error={errors.globalAccountId}
        />
        <input type="hidden" name="currency" value={selected.currency ?? "USD"} />
        <TextField
          name="amount"
          label={`Amount (${selected.currency ?? "account currency"})`}
          required
          inputMode="decimal"
          placeholder="4,500.00"
          defaultValue={values.amount}
          error={errors.amount ?? errors.currency}
          description="Airwallex credits simulated deposits in the Global Account's base currency."
        />
        <TextField
          name="payerName"
          label="Payer name"
          required
          defaultValue={values.payerName}
          error={errors.payerName}
        />
        <TextField
          name="reference"
          label="Reference on the transfer"
          required
          defaultValue={values.reference}
          error={errors.reference}
          description="Use an expected receipt's reference to see a reference match."
        />
        <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <FlaskConicalIcon data-icon="inline-start" />}
          Create sandbox deposit
        </Button>
      </FieldGroup>
    </form>
  );
}

export function SimulateDepositSheet({ accounts }: { accounts: Promise<GlobalAccountOptions> }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
      title="Simulate a sandbox deposit"
      description="Creates test money in Airwallex Sandbox via the simulation API, then syncs it. It is labelled as a simulation everywhere — it is not a real customer payment."
      trigger={
        <Button variant="outline" size="lg" className="h-10 md:h-9">
          <FlaskConicalIcon data-icon="inline-start" />
          Simulate deposit
        </Button>
      }
    >
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SimulateForm key={formKey} accountsPromise={accounts} onDone={() => setOpen(false)} />
      </Suspense>
    </FormSheet>
  );
}
