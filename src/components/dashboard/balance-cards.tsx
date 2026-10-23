import { LandmarkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { SnapshotBalance } from "@/server/balances/queries";

function Amount({ balance, minor }: { balance: SnapshotBalance; minor: bigint | null }) {
  if (minor === null) {
    return <span className="text-muted-foreground italic">Unavailable</span>;
  }
  return (
    <span className="tabular-nums">
      {formatMoney(minor, balance.currency, balance.exponent, { display: "none" })}
    </span>
  );
}

function BalanceCard({ balance }: { balance: SnapshotBalance }) {
  const rows = [
    { label: "Pending", minor: balance.pendingMinor, hint: "Settling conversions" },
    { label: "Reserved", minor: balance.reservedMinor, hint: "Held for outbound payments" },
    { label: "Total", minor: balance.totalMinor, hint: "Available + pending + reserved" },
  ];

  return (
    <Card className="@container/card min-w-0" data-testid={`balance-card-${balance.currency}`}>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{balance.currency}</span>
          <span>Available now</span>
        </CardDescription>
        <CardTitle className="truncate text-2xl font-semibold @[250px]/card:text-3xl">
          <Amount balance={balance} minor={balance.availableMinor} />
        </CardTitle>
        <CardAction>
          <Badge variant="outline">
            <LandmarkIcon data-icon="inline-start" />
            Actual
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter>
        <dl className="grid w-full grid-cols-3 gap-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex min-w-0 flex-col gap-0.5" title={row.hint}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="truncate font-medium">
                <Amount balance={balance} minor={row.minor} />
              </dd>
            </div>
          ))}
        </dl>
      </CardFooter>
    </Card>
  );
}

const hasFunds = (balance: SnapshotBalance) =>
  [balance.availableMinor, balance.pendingMinor, balance.reservedMinor, balance.totalMinor].some(
    (value) => value !== null && value !== 0n,
  );

export function BalanceCards({ balances }: { balances: SnapshotBalance[] }) {
  const funded = balances.filter(hasFunds);
  const empty = balances.filter((balance) => !hasFunds(balance));

  return (
    <div className="flex flex-col gap-4">
      {funded.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
          {funded.map((balance) => (
            <BalanceCard key={balance.id} balance={balance} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Airwallex returned no funded balances. Every currency below is at zero.
        </p>
      )}
      {empty.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{empty.length} other currencies</span> have
          a zero balance:{" "}
          <span className="font-mono text-xs break-words">
            {empty.map((balance) => balance.currency).join(" · ")}
          </span>
        </p>
      ) : null}
    </div>
  );
}
