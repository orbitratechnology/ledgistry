"use client";

import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { saveReserveAction } from "@/app/(workspace)/settings/actions";
import { FormSheet } from "@/components/common/form-sheet";
import { SelectField, TextField } from "@/components/common/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { FORM_CURRENCIES, type FormState } from "@/lib/validation/forms";

export type ReserveInitialValues = { currency: string; amount: string };

function ReserveForm({
  initial,
  takenCurrencies,
  onSaved,
}: {
  initial?: ReserveInitialValues;
  takenCurrencies: string[];
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await saveReserveAction(previous, formData);
    if (result.ok) {
      toast.add({ type: "success", title: "Reserve saved", description: result.message });
      onSaved();
    }
    return { ...result, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const values = { ...initial, ...state.values } as Partial<ReserveInitialValues>;
  const errors = state.fieldErrors ?? {};
  const available = FORM_CURRENCIES.filter((code) => code === initial?.currency || !takenCurrencies.includes(code));

  return (
    <form action={formAction} noValidate>
      <FieldGroup key={state.attempt ?? 0}>
        {state.message && !state.ok ? (
          <Alert variant="destructive" aria-live="polite">
            <CircleAlertIcon />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {initial ? (
          <input type="hidden" name="currency" value={initial.currency} />
        ) : (
          <SelectField
            name="currency"
            label="Currency"
            required
            defaultValue={values.currency ?? available[0]}
            options={available.map((code) => ({ value: code, label: code }))}
            error={errors.currency}
            description="Each currency is protected separately; nothing is converted."
          />
        )}
        <TextField
          name="amount"
          label={initial ? `Protected ${initial.currency} reserve` : "Protected reserve"}
          required
          inputMode="decimal"
          placeholder="4,000.00"
          defaultValue={values.amount}
          error={errors.amount}
          description="The planner never recommends a payment that would take available cash below this amount."
        />
        <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {initial ? "Save reserve" : "Set reserve"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ReserveSheet({
  initial,
  takenCurrencies,
}: {
  initial?: ReserveInitialValues;
  takenCurrencies: string[];
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
      title={initial ? `Edit ${initial.currency} reserve` : "Set a protected reserve"}
      description="Cash the planner keeps untouched. Changing it creates a new plan version."
      trigger={
        initial ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${initial.currency} reserve`}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button variant="outline" size="lg" className="h-10 md:h-9">
            <PlusIcon data-icon="inline-start" />
            Add reserve
          </Button>
        )
      }
    >
      <ReserveForm key={formKey} initial={initial} takenCurrencies={takenCurrencies} onSaved={() => setOpen(false)} />
    </FormSheet>
  );
}
