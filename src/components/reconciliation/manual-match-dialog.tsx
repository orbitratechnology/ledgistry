"use client";

import { LinkIcon } from "lucide-react";
import { useState, useTransition } from "react";

import { manualMatchAction } from "@/app/(workspace)/reconciliation/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

export type ReceiptChoice = { id: string; label: string; applyPreview: string };

/** Operator-chosen association. The database caps the applied amount at what is outstanding. */
export function ManualMatchDialog({
  transactionId,
  depositLabel,
  choices,
}: {
  transactionId: string;
  depositLabel: string;
  choices: ReceiptChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [receiptId, setReceiptId] = useState(choices[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const selected = choices.find((choice) => choice.id === receiptId);

  function confirm() {
    startTransition(async () => {
      const result = await manualMatchAction(transactionId, receiptId);
      if (result.ok) {
        toast.add({ type: "success", title: "Matched", description: result.message });
        setOpen(false);
      } else {
        toast.add({ type: "error", title: "Not matched", description: result.message });
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="outline" size="sm" disabled={choices.length === 0} />}
      >
        <LinkIcon data-icon="inline-start" />
        Match manually
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apply this deposit to a receipt</AlertDialogTitle>
          <AlertDialogDescription>{depositLabel}</AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={`receipt-${transactionId}`}>Expected receipt</FieldLabel>
          <NativeSelect
            id={`receipt-${transactionId}`}
            value={receiptId}
            onChange={(event) => setReceiptId(event.target.value)}
            className="w-full *:h-10"
          >
            {choices.map((choice) => (
              <NativeSelectOption key={choice.id} value={choice.id}>
                {choice.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {selected ? <FieldDescription>{selected.applyPreview}</FieldDescription> : null}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending || !receiptId} onClick={confirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Confirm match
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
