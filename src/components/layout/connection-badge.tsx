import { CircleCheckIcon, CircleOffIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkAirwallexConnection } from "@/server/airwallex/connection";

/** Live Airwallex connection state; reuses the cached access token, so it is cheap. */
export async function ConnectionBadge() {
  await connection();
  const status = await checkAirwallexConnection();
  const connected = status.state === "connected";
  const misconfigured = status.state === "missing_credentials" || status.state === "host_not_allowed";
  const Icon = connected ? CircleCheckIcon : misconfigured ? CircleOffIcon : TriangleAlertIcon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={connected ? "success" : misconfigured ? "destructive" : "warning"}
            render={
              <Link
                href="/settings"
                aria-label={`Airwallex ${connected ? "connected" : "needs attention"}. ${status.message}`}
              />
            }
          />
        }
      >
        <Icon data-icon="inline-start" />
        <span className="sr-only sm:not-sr-only">
          {connected ? "Airwallex" : "Airwallex issue"}
        </span>
      </TooltipTrigger>
      <TooltipContent>{status.message}</TooltipContent>
    </Tooltip>
  );
}

export function ConnectionBadgeSkeleton() {
  return <Skeleton className="h-5 w-24 rounded-4xl" />;
}
