"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";

import { refreshBalancesAction } from "@/app/(workspace)/overview/actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

export function RefreshBalancesButton({
  label = "Refresh balances",
  variant = "outline",
}: {
  label?: string;
  variant?: "default" | "outline";
}) {
  const [pending, startTransition] = useTransition();

  function onRefresh() {
    startTransition(async () => {
      const result = await refreshBalancesAction();
      if (result.ok) {
        toast.add({ type: "success", title: "Balances refreshed", description: result.message });
        for (const warning of result.warnings) {
          toast.add({ type: "warning", title: "Currency skipped", description: warning });
        }
      } else {
        toast.add({ type: "error", title: "Refresh failed", description: result.message });
      }
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="lg"
      className="h-10 md:h-9"
      onClick={onRefresh}
      disabled={pending}
      aria-live="polite"
    >
      {pending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
      {pending ? "Refreshing…" : label}
    </Button>
  );
}
