"use client";

import { useState, useTransition } from "react";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

export type ActionOutcome = { ok: boolean; message: string; warnings?: string[] };

type ConfirmOptions = {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Ask for an optional note that is passed to the action and stored with the decision. */
  withNote?: boolean;
};

/**
 * Runs a Server Action (already bound to its record) with pending state and toast feedback.
 * With `confirm`, the action only runs from an explicit button in a confirmation dialog.
 */
export function ActionButton({
  action,
  children,
  icon,
  variant = "outline",
  size = "default",
  className,
  confirm,
  successTitle = "Done",
}: {
  action: (note?: string) => Promise<ActionOutcome>;
  children: React.ReactNode;
  icon?: React.ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
  className?: string;
  confirm?: ConfirmOptions;
  successTitle?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  function run() {
    startTransition(async () => {
      const result = await action(note || undefined);
      if (result.ok) {
        toast.add({ type: "success", title: successTitle, description: result.message });
        for (const warning of result.warnings ?? []) {
          toast.add({ type: "warning", title: "Heads up", description: warning });
        }
        setOpen(false);
        setNote("");
      } else {
        toast.add({ type: "error", title: "Not completed", description: result.message });
      }
    });
  }

  const content = (
    <>
      {pending ? <Spinner data-icon="inline-start" /> : icon}
      {children}
    </>
  );

  if (!confirm) {
    return (
      <Button variant={variant} size={size} className={className} disabled={pending} onClick={run}>
        {content}
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={variant} size={size} className={className} disabled={pending} />}
      >
        {content}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirm.withNote ? (
          <Field>
            <FieldLabel htmlFor="decision-note">Note (optional)</FieldLabel>
            <Textarea
              id="decision-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why? Stored in the audit trail."
            />
          </Field>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={confirm.destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={run}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirm.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
