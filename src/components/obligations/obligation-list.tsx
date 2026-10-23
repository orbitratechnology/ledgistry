import { ArchiveIcon, ArchiveRestoreIcon, UserRoundXIcon } from "lucide-react";

import {
  archiveObligationAction,
  restoreObligationAction,
} from "@/app/(workspace)/obligations/actions";
import { ActionButton } from "@/components/common/action-button";
import { ObligationStatusBadge, OverdueBadge, PriorityBadge, SandboxBadge } from "@/components/common/badges";
import { Money } from "@/components/common/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIsoDate } from "@/lib/format";
import type { ObligationView } from "@/server/obligations/queries";
import { ObligationSheet, type BeneficiaryOptions } from "./obligation-sheet";

const dateLabel = formatIsoDate;

function Actions({ item, beneficiaries }: { item: ObligationView; beneficiaries: Promise<BeneficiaryOptions> }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {!item.archived ? (
        <ObligationSheet
          beneficiaries={beneficiaries}
          initial={{
            id: item.id,
            payeeName: item.payeeName,
            description: item.description,
            invoiceReference: item.invoiceReference ?? "",
            amount: item.amountInput,
            currency: item.currency,
            dueDate: item.dueDate,
            priority: item.priority,
            status: item.status,
            beneficiaryId: item.beneficiaryId ?? "",
            notes: item.notes ?? "",
          }}
        />
      ) : null}
      {item.archived ? (
        <ActionButton
          action={restoreObligationAction.bind(null, item.id)}
          variant="ghost"
          size="sm"
          icon={<ArchiveRestoreIcon data-icon="inline-start" />}
          successTitle="Restored"
        >
          Restore
        </ActionButton>
      ) : (
        <ActionButton
          action={archiveObligationAction.bind(null, item.id)}
          variant="ghost"
          size="sm"
          icon={<ArchiveIcon data-icon="inline-start" />}
          successTitle="Archived"
          confirm={{
            title: `Archive the obligation to ${item.payeeName}?`,
            description:
              "It disappears from open lists and planning. Nothing is paid or cancelled at Airwallex, and you can restore it later.",
            confirmLabel: "Archive obligation",
            destructive: true,
          }}
        >
          Archive
        </ActionButton>
      )}
    </div>
  );
}

function Beneficiary({ item }: { item: ObligationView }) {
  return item.beneficiaryLabel ? (
    <span className="text-sm">{item.beneficiaryLabel}</span>
  ) : (
    <Badge variant="outline">
      <UserRoundXIcon data-icon="inline-start" />
      No beneficiary yet
    </Badge>
  );
}

export function ObligationList({
  items,
  beneficiaries,
}: {
  items: ObligationView[];
  beneficiaries: Promise<BeneficiaryOptions>;
}) {
  return (
    <>
      {/* Phones: cards. */}
      <ul className="flex flex-col gap-3 md:hidden" aria-label="Obligations">
        {items.map((item) => (
          <li key={item.id}>
            <Card size="sm" data-testid="obligation-card">
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.payeeName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {item.description}
                      {item.invoiceReference ? ` · ${item.invoiceReference}` : ""}
                    </p>
                  </div>
                  <Money
                    minor={item.amountMinor}
                    currency={item.currency}
                    exponent={item.exponent}
                    className="font-semibold"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={item.priority} />
                  <ObligationStatusBadge status={item.status} />
                  {item.overdue ? <OverdueBadge /> : null}
                  {item.isDemo ? <SandboxBadge label="Demo record" /> : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Due {dateLabel(item.dueDate)}</span>
                  <Beneficiary item={item} />
                </div>
                <Actions item={item} beneficiaries={beneficiaries} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {/* Tablet and desktop: table. */}
      <Card className="hidden py-0 md:flex">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payee</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Beneficiary</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-testid="obligation-row">
                <TableCell className="max-w-64 whitespace-normal">
                  <p className="font-medium">{item.payeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                    {item.invoiceReference ? ` · ${item.invoiceReference}` : ""}
                  </p>
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money minor={item.amountMinor} currency={item.currency} exponent={item.exponent} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <span>{dateLabel(item.dueDate)}</span>
                    {item.overdue ? <OverdueBadge /> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={item.priority} />
                </TableCell>
                <TableCell>
                  <ObligationStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="hidden max-w-52 whitespace-normal lg:table-cell">
                  <Beneficiary item={item} />
                </TableCell>
                <TableCell>
                  <Actions item={item} beneficiaries={beneficiaries} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
