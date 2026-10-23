"use client";

import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { saveReceiptAction } from "@/app/(workspace)/reconciliation/actions";
import { FormSheet } from "@/components/common/form-sheet";
import { SelectField, TextAreaField, TextField } from "@/components/common/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { FORM_CURRENCIES, type FormState } from "@/lib/validation/forms";

export type ReceiptInitialValues = {
  id: string;
  payerName: string;
  reference: string;
  amount: string;
  currency: string;
  expectedDate: string;
  notes: string;
};

function ReceiptForm({ initial, onSaved }: { initial?: ReceiptInitialValues; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await saveReceiptAction(previous, formData);
    if (result.ok) {
      toast.add({ type: "success", title: "Saved", description: result.message });
      onSaved();
    }
    return { ...result, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const values = { ...initial, ...state.values } as Partial<ReceiptInitialValues>;
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
        <TextField name="payerName" label="Payer" required defaultValue={values.payerName} error={errors.payerName} />
        <TextField
          name="reference"
          label="Reference"
          required
          defaultValue={values.reference}
          error={errors.reference}
          description="The invoice or payment reference you expect on the incoming transfer. It is the strongest matching evidence."
        />
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <TextField
            name="amount"
            label="Expected amount"
            required
            inputMode="decimal"
            placeholder="9,000.00"
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
        <TextField
          name="expectedDate"
          label="Expected date"
          type="date"
          required
          defaultValue={values.expectedDate}
          error={errors.expectedDate}
        />
        <TextAreaField name="notes" label="Notes" defaultValue={values.notes} error={errors.notes} />
        <Button type="submit" size="lg" className="h-10 w-full" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {initial ? "Save changes" : "Add expected receipt"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ReceiptSheet({ initial }: { initial?: ReceiptInitialValues }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <FormSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
      title={initial ? "Edit expected receipt" : "New expected receipt"}
      description="A forecast of money you expect to receive. It is never counted as available cash until a deposit is matched."
      trigger={
        initial ? (
          <Button variant="ghost" size="sm" aria-label={`Edit receipt ${initial.reference}`}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button variant="outline" size="lg" className="h-10 md:h-9">
            <PlusIcon data-icon="inline-start" />
            Expected receipt
          </Button>
        )
      }
    >
      <ReceiptForm key={formKey} initial={initial} onSaved={() => setOpen(false)} />
    </FormSheet>
  );
}
