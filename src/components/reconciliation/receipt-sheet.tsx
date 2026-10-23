"use client";

import { CircleAlertIcon, PencilIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useActionState, useState, useTransition } from "react";

import { extractReceiptEvidenceAction, saveReceiptAction } from "@/app/(workspace)/reconciliation/actions";
import { FormSheet } from "@/components/common/form-sheet";
import { SelectField, TextAreaField, TextField } from "@/components/common/form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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

/** `atAttempt`: the submit count when the AI filled the form, so later submits win over it. */
type Prefill = { values: Partial<ReceiptInitialValues>; notes: string[]; version: number; atAttempt: number };

/** Optional: Claude reads pasted remittance text into the form. The operator still checks and saves. */
function FillFromText({ onFilled }: { onFilled: (values: Partial<ReceiptInitialValues>, notes: string[]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setError(null);
      const result = await extractReceiptEvidenceAction(text);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const { suggestion } = result;
      onFilled(
        {
          payerName: suggestion.payerName ?? undefined,
          reference: suggestion.reference ?? undefined,
          amount: suggestion.amount ?? undefined,
          currency: suggestion.currency && (FORM_CURRENCIES as readonly string[]).includes(suggestion.currency)
            ? suggestion.currency
            : undefined,
          expectedDate: suggestion.expectedDate ?? undefined,
        },
        suggestion.notes,
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-3" data-testid="fill-from-text">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="remittance-text">
          Fill from pasted text <span className="font-normal text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="remittance-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Paste a remittance email or invoice note"
          aria-describedby="remittance-text-description"
        />
        <FieldDescription id="remittance-text-description">
          Claude copies values that appear in the text; anything it cannot find stays empty. Check every field.
        </FieldDescription>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </Field>
      <Button type="button" variant="outline" onClick={run} disabled={pending || text.trim().length < 10}>
        {pending ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
        Fill form with AI
      </Button>
    </div>
  );
}

function ReceiptForm({ initial, onSaved }: { initial?: ReceiptInitialValues; onSaved: () => void }) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await saveReceiptAction(previous, formData);
    if (result.ok) {
      toast.add({ type: "success", title: "Saved", description: result.message });
      onSaved();
    }
    return { ...result, attempt: (previous.attempt ?? 0) + 1 };
  }, {});
  const prefillIsNewer = prefill !== null && prefill.atAttempt === (state.attempt ?? 0);
  const values = (
    prefillIsNewer ? { ...initial, ...state.values, ...prefill.values } : { ...initial, ...prefill?.values, ...state.values }
  ) as Partial<ReceiptInitialValues>;
  const errors = state.fieldErrors ?? {};

  return (
    <div className="flex flex-col gap-4">
      {initial ? null : (
        <FillFromText
          onFilled={(filled, notes) =>
            setPrefill((current) => ({
              values: filled,
              notes,
              version: (current?.version ?? 0) + 1,
              atAttempt: state.attempt ?? 0,
            }))
          }
        />
      )}
      {prefill ? (
        <Alert variant="info" data-testid="ai-prefill-notice">
          <SparklesIcon />
          <AlertTitle>Filled by AI from your text</AlertTitle>
          <AlertDescription>
            Check each field before saving; nothing is stored until you do.
            {prefill.notes.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {prefill.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <form action={formAction} noValidate>
        {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
        <FieldGroup key={`${state.attempt ?? 0}-${prefill?.version ?? 0}`}>
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
    </div>
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
