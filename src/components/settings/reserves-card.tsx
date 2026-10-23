import { ShieldCheckIcon, ShieldOffIcon } from "lucide-react";

import { setReserveEnabledAction } from "@/app/(workspace)/settings/actions";
import { ActionButton } from "@/components/common/action-button";
import { LocalDateTime } from "@/components/common/freshness";
import { Money } from "@/components/common/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { minorToDecimalString } from "@/lib/money";
import type { ReservePolicyView } from "@/server/planner/inputs";
import { ReserveSheet } from "./reserve-sheet";

/** Protected reserve per currency (PRD §8.6). Server-rendered list with client sheets. */
export function ReservesCard({ reserves }: { reserves: ReservePolicyView[] }) {
  const taken = reserves.map((reserve) => reserve.currency);
  return (
    <Card data-testid="reserves-card">
      <CardHeader>
        <CardTitle>Protected reserves</CardTitle>
        <CardDescription>
          Cash the planner never recommends spending. Each currency stands alone; no FX is assumed.
        </CardDescription>
        <CardAction>
          <ReserveSheet takenCurrencies={taken} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {reserves.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldOffIcon />
              </EmptyMedia>
              <EmptyTitle>No reserve protected yet</EmptyTitle>
              <EmptyDescription>
                Without a reserve the planner may recommend spending all available cash in that currency.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y" aria-label="Protected reserves">
            {reserves.map((reserve) => (
              <li
                key={reserve.id}
                data-testid={`reserve-${reserve.currency}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{reserve.currency}</span>
                    {reserve.enabled ? (
                      <Badge variant="success">
                        <ShieldCheckIcon data-icon="inline-start" />
                        Protected
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <ShieldOffIcon data-icon="inline-start" />
                        Off
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated <LocalDateTime iso={reserve.updatedAt} />
                  </p>
                </div>
                <Money
                  minor={reserve.amountMinor}
                  currency={reserve.currency}
                  exponent={reserve.exponent}
                  className="text-base font-semibold"
                />
                <div className="flex items-center gap-1">
                  <ReserveSheet
                    takenCurrencies={taken}
                    initial={{
                      currency: reserve.currency,
                      amount: minorToDecimalString(reserve.amountMinor, reserve.exponent),
                    }}
                  />
                  {reserve.enabled ? (
                    <ActionButton
                      variant="ghost"
                      size="sm"
                      action={setReserveEnabledAction.bind(null, reserve.id, false)}
                      confirm={{
                        title: `Turn off the ${reserve.currency} reserve?`,
                        description:
                          "The planner will protect nothing in this currency and may recommend spending all available cash. The amount is kept so you can turn it back on.",
                        confirmLabel: "Turn off protection",
                        destructive: true,
                      }}
                    >
                      Turn off
                    </ActionButton>
                  ) : (
                    <ActionButton variant="ghost" size="sm" action={setReserveEnabledAction.bind(null, reserve.id, true)}>
                      Turn on
                    </ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
