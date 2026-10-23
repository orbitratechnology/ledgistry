"use client";

import { ClockIcon, TriangleAlertIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeTime(fromMs: number, nowMs: number) {
  const seconds = Math.round((fromMs - nowMs) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 45 * 60) return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3600) return relativeFormat.format(Math.round(seconds / 3600), "hour");
  return relativeFormat.format(Math.round(seconds / 86400), "day");
}

const TICK_MS = 30_000;

function subscribeToClock(onTick: () => void) {
  const id = window.setInterval(onTick, TICK_MS);
  return () => window.clearInterval(id);
}

// Bucketed so consecutive reads within a render return the same value.
const readClock = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
const readServerClock = () => null;

/**
 * Current time on the client (null during SSR/hydration), refreshed every 30s so
 * "x minutes ago" and staleness stay truthful while the page is open.
 */
function useNow(): number | null {
  return useSyncExternalStore(subscribeToClock, readClock, readServerClock);
}

export function LocalDateTime({ iso }: { iso: string }) {
  const now = useNow();
  const date = new Date(iso);
  // Server/first paint uses UTC so markup is deterministic; after mount, the viewer's timezone.
  const text = date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: now === null ? "UTC" : undefined,
  });
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {now === null ? `${text} UTC` : text}
    </time>
  );
}

export function DataFreshness({
  fetchedAt,
  staleAfterMinutes = 15,
  subject = "Balances",
}: {
  fetchedAt: string;
  staleAfterMinutes?: number;
  subject?: string;
}) {
  const now = useNow();
  const fetchedMs = Date.parse(fetchedAt);
  const stale = now !== null && now - fetchedMs > staleAfterMinutes * 60_000;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant={stale ? "warning" : "success"}>
          {stale ? <TriangleAlertIcon data-icon="inline-start" /> : <ClockIcon data-icon="inline-start" />}
          {stale ? "Stale" : "Fresh"}
        </Badge>
        <span>
          Updated {now === null ? "" : `${relativeTime(fetchedMs, now)} · `}
          <LocalDateTime iso={fetchedAt} />
        </span>
      </div>
      {stale ? (
        <Alert variant="warning" role="status">
          <TriangleAlertIcon />
          <AlertTitle>{subject} may be out of date</AlertTitle>
          <AlertDescription>
            The last Airwallex read is more than {staleAfterMinutes} minutes old. Refresh before
            making payment decisions.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
