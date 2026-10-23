"use client";

import { RefreshCwIcon } from "lucide-react";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { recheckConnectionAction } from "./actions";

export function RecheckConnectionButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="lg"
      className="h-10 md:h-9"
      disabled={pending}
      onClick={() => startTransition(() => recheckConnectionAction())}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
      {pending ? "Checking…" : "Re-check connection"}
    </Button>
  );
}
