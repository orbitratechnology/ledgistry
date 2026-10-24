import {
  AlertTriangleIcon,
  ArrowUpIcon,
  BanIcon,
  CheckCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  ClockIcon,
  CopyIcon,
  FlaskConicalIcon,
  HourglassIcon,
  HelpCircleIcon,
  LoaderIcon,
  SendIcon,
  PauseIcon,
  SearchCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  OBLIGATION_STATUS_LABEL,
  PRIORITY_LABEL,
  RECEIPT_STATE_LABEL,
  TRANSACTION_STATE_LABEL,
  type ObligationPriority,
  type ObligationStatus,
  type ReceiptState,
  type TransactionMatchState,
} from "@/lib/finance/states";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/payments/status";

type Variant = "default" | "secondary" | "outline" | "success" | "warning" | "info" | "destructive";
type Config = { label: string; variant: Variant; icon: LucideIcon };

function StatusBadge({ config, className }: { config: Config; className?: string }) {
  return (
    <Badge variant={config.variant} className={className}>
      <config.icon data-icon="inline-start" />
      {config.label}
    </Badge>
  );
}

const RECEIPT: Record<ReceiptState, Omit<Config, "label">> = {
  expected: { variant: "secondary", icon: CircleDashedIcon },
  partially_received: { variant: "warning", icon: CircleDotIcon },
  matched: { variant: "success", icon: CircleCheckIcon },
  overdue: { variant: "destructive", icon: ClockIcon },
  needs_review: { variant: "info", icon: SearchCheckIcon },
  cancelled: { variant: "outline", icon: BanIcon },
};

export function ReceiptStateBadge({ state }: { state: ReceiptState }) {
  return <StatusBadge config={{ ...RECEIPT[state], label: RECEIPT_STATE_LABEL[state] }} />;
}

const TRANSACTION: Record<TransactionMatchState, Omit<Config, "label">> = {
  unmatched: { variant: "secondary", icon: CircleDashedIcon },
  suggested_match: { variant: "info", icon: SparklesIcon },
  partially_matched: { variant: "warning", icon: CircleDotIcon },
  matched: { variant: "success", icon: CheckCheckIcon },
  duplicate_suspected: { variant: "destructive", icon: CopyIcon },
  needs_review: { variant: "warning", icon: SearchCheckIcon },
};

export function TransactionStateBadge({ state }: { state: TransactionMatchState }) {
  return <StatusBadge config={{ ...TRANSACTION[state], label: TRANSACTION_STATE_LABEL[state] }} />;
}

const OBLIGATION: Record<ObligationStatus, Omit<Config, "label">> = {
  draft: { variant: "outline", icon: CircleDashedIcon },
  planned: { variant: "info", icon: CircleDotIcon },
  approval_required: { variant: "warning", icon: HourglassIcon },
  in_progress: { variant: "warning", icon: LoaderIcon },
  paid: { variant: "success", icon: CircleCheckIcon },
  deferred: { variant: "secondary", icon: PauseIcon },
  cancelled: { variant: "outline", icon: BanIcon },
  failed: { variant: "destructive", icon: CircleXIcon },
};

export function ObligationStatusBadge({ status }: { status: ObligationStatus }) {
  return <StatusBadge config={{ ...OBLIGATION[status], label: OBLIGATION_STATUS_LABEL[status] }} />;
}

const PRIORITY: Record<ObligationPriority, Omit<Config, "label">> = {
  critical: { variant: "destructive", icon: AlertTriangleIcon },
  high: { variant: "warning", icon: ArrowUpIcon },
  normal: { variant: "secondary", icon: CircleDotIcon },
  low: { variant: "outline", icon: CircleDashedIcon },
};

export function PriorityBadge({ priority }: { priority: ObligationPriority }) {
  return <StatusBadge config={{ ...PRIORITY[priority], label: PRIORITY_LABEL[priority] }} />;
}

export function ProviderStatusBadge({ status }: { status: string }) {
  const config: Config =
    status === "SETTLED"
      ? { label: "Settled", variant: "outline", icon: CircleCheckIcon }
      : status === "PENDING"
        ? { label: "Pending", variant: "warning", icon: HourglassIcon }
        : { label: status.charAt(0) + status.slice(1).toLowerCase(), variant: "destructive", icon: CircleXIcon };
  return <StatusBadge config={config} />;
}

export function SandboxBadge({ label = "Sandbox simulation" }: { label?: string }) {
  return <StatusBadge config={{ label, variant: "outline", icon: FlaskConicalIcon }} />;
}

export function OverdueBadge() {
  return <StatusBadge config={{ label: "Overdue", variant: "destructive", icon: ClockIcon }} />;
}

const PAYMENT: Record<PaymentStatus, Omit<Config, "label">> = {
  prepared: { variant: "outline", icon: CircleDashedIcon },
  submitted: { variant: "info", icon: SendIcon },
  verification_required: { variant: "warning", icon: HelpCircleIcon },
  pending: { variant: "info", icon: LoaderIcon },
  completed: { variant: "success", icon: CircleCheckIcon },
  failed: { variant: "destructive", icon: CircleXIcon },
  cancelled: { variant: "outline", icon: BanIcon },
  unknown: { variant: "warning", icon: HelpCircleIcon },
};

/** "Completed" appears only for a provider-confirmed PAID status (see mapProviderStatus). */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <StatusBadge config={{ ...PAYMENT[status], label: PAYMENT_STATUS_LABEL[status] }} />;
}
