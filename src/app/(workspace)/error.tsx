"use client";

import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { useEffect } from "react";

import { PageContainer } from "@/components/layout/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error && typeof error === "object" && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <PageContainer>
      <Alert variant="destructive" role="alert">
        <CircleAlertIcon />
        <AlertTitle>This page could not load</AlertTitle>
        <AlertDescription>
          Ledgistry could not load this data. Nothing was changed. Try again; if it keeps failing,
          check the connection status in Settings.
          {digest ? <span className="mt-1 block font-mono text-xs">Reference: {digest}</span> : null}
        </AlertDescription>
      </Alert>
      <div>
        <Button variant="outline" size="lg" onClick={() => retry()}>
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      </div>
    </PageContainer>
  );
}
