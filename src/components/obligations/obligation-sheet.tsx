"use client";

import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Suspense, use, useActionState, useState } from "react";

import { saveObligationAction } from "@/app/(workspace)/obligations/actions";
import { FormSheet } from "@/components/common/form-sheet";
import { SelectField, TextAreaField, TextField } from "@/components/common/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  OBLIGATION_PRIORITIES,
  OBLIGATION_STATUS_LABEL,
  OPERATOR_OBLIGATION_STATUSES,
  PRIORITY_LABEL,
} from "@/lib/finance/states";
import { FORM_CURRENCIES, type FormState } from "@/lib/validation/forms";

export type BeneficiaryOption = { id: string; label: string; currency: string | null };
export type BeneficiaryOptions =
  | { ok: true; items: BeneficiaryOption[] }
  | { ok: false; message: string };

export type ObligationInitialValues = {
  id: string;
  payeeName: string;
  description: string;
  invoiceReference: string;
  amount: string;
  currency: string;
  dueDate: string;
  priority: string;
  status: string;
  beneficiaryId: string;
  notes: string;
};

function BeneficiaryField({
  optionsPromise,
  error,
  defaultValue,
}: {
  optionsPromise: Promise<BeneficiaryOptions>;
  error?: string;
  defaultValue?: string;
}) {
  const options = use(optionsPromise);
  if (!options.ok) {
    return (
      <SelectField
        name="beneficiaryId"
        label="Airwallex beneficiary"
        options={[]}
        placeholder="Unavailable right now"
        disabled
        description={options.message}
        error={error}
      />
    );
  }
  return (
    <SelectField
      name="beneficiaryId"
      label="Airwallex beneficiary"
      placeholder="Choose later"
      defaultValue={defaultValue}
      options={options.items.map((item) => ({
        value: item.id,
        label: item.currency ? `${item.label} · ${item.currency}` : item.label,
      }))}
      description="Required before this obligation can be paid. Bank details stay in Airwallex."
      error={error}
    />
  );
}

function ObligationForm({
  initial,
  beneficiaries,
  onSaved,
}: {
  initial?: ObligationInitialValues;
  beneficiaries: Promise<BeneficiaryOptions>;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await saveObligationAction(previous, formData);
    if (result.ok) {
      toast.add({ type: "success", title: "Saved", description: result.message });
      onSaved();
    }
    return { ...result, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const values = { ...initial, ...state.values } as Partial<ObligationInitialValues>;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate>
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FieldGroup key={state.attempt ?? 0}>
        {state.message && !state.ok ? (
          <Alert variant="destructive" aria-live="polite">
            <CircleAlertIcon />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="payeeName" label="Payee" required defaultValue={values.payeeName} error={errors.payeeName} />
        <TextField
          name="description"
          label="What it pays for"
          required
          defaultValue={values.description}
          error={errors.description}
        />
        <TextField
          name="invoiceReference"
          label="Invoice reference"
          defaultValue={values.invoiceReference}
          error={errors.invoiceReference}
        />
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <TextField
            name="amount"
            label="Amount"
            required
            inputMode="decimal"
            placeholder="6,500.00"
            defaultValue={values.amount}
            error={errors.amount}
          />
          <SelectField
            name="currency"
            label="Currency"
            required
            defaultValue={values.currency ?? "USD"}
            options={FORM_CURRENCIES.map((code) => ({ value: code, label: code }))}
            error={errors.currency}
          />
        </div>
        <TextField name="dueDate" label="Due date" type="date" required defaultValue={values.dueDate} error={errors.dueDate} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            name="priority"
            label="Priority"
            required
            defaultValue={values.priority ?? "normal"}
            options={OBLIGATION_PRIORITIES.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] }))}
            error={errors.priority}
          />
          <SelectField
            name="status"
            label="Status"
            required
            defaultValue={values.status ?? "planned"}
            options={OPERATOR_OBLIGATION_STATUSES.map((status) => ({
              value: status,
              label: OBLIGATION_STATUS_LABEL[status],
            }))}
            error={errors.status}
          />
        </div>
        <Suspense fallback={<Skeleton className="h-16 w-full" />}>
          <BeneficiaryField optionsPromise={beneficiaries} error={errors.beneficiaryId} defaultValue={values.beneficiaryId} />
        </Suspense>
        <TextAreaField name="notes" label="Notes" defaultValue={values.notes} error={errors.notes} />
        <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {initial ? "Save changes" : "Create obligation"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ObligationSheet({
  beneficiaries,
  initial,
}: {
  beneficiaries: Promise<BeneficiaryOptions>;
  initial?: ObligationInitialValues;
}) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open so stale action state never leaks between edits.
  const [formKey, setFormKey] = useState(0);

  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
      title={initial ? "Edit obligation" : "New obligation"}
      description={
        initial
          ? "Changing the amount, currency, payee or beneficiary creates a new version that any approval must match."
          : "A business record of money you owe. It is not paid until you approve a transfer."
      }
      trigger={
        initial ? (
          <Button variant="ghost" size="sm" aria-label={`Edit obligation to ${initial.payeeName}`}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button size="lg" className="h-10 md:h-9">
            <PlusIcon data-icon="inline-start" />
            New obligation
          </Button>
        )
      }
    >
      <ObligationForm key={formKey} initial={initial} beneficiaries={beneficiaries} onSaved={() => setOpen(false)} />
    </FormSheet>
  );
}
