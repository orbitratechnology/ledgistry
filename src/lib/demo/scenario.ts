import type { ObligationPriority } from "@/lib/finance/states";
import { formatMoney } from "@/lib/money";

/**
 * The demo scenario from the PRD (Flow D). Only Ledgistry business records are created here:
 * sample obligations, a sample expected receipt and a reserve. Balances and transfer statuses
 * always come from Airwallex Sandbox.
 */
export const DEMO_CURRENCY = "USD";
const EXPONENT = 2;
/** The figures below assume this much is actually available at Airwallex when the demo starts. */
export const DEMO_STARTING_AVAILABLE_MINOR = 1_200_000n;
export const DEMO_RESERVE_MINOR = 400_000n;
/** Preferred sandbox beneficiary (validated for USD LOCAL transfers of these amounts). */
export const DEMO_BENEFICIARY_LABEL = "US USD LOCAL";
/** The simulated partial deposit made during the walkthrough. */
export const DEMO_PARTIAL_DEPOSIT_MINOR = 450_000n;

const NOTE = "Sample record created by Load demo data. Not a real supplier or customer.";

export type DemoObligation = {
  payeeName: string;
  description: string;
  invoiceReference: string;
  amountMinor: bigint;
  priority: ObligationPriority;
  dueDate: string;
  notes: string;
};

export type DemoReceipt = {
  payerName: string;
  reference: string;
  expectedAmountMinor: bigint;
  expectedDate: string;
  notes: string;
};

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sample records with dates relative to `today` (YYYY-MM-DD). */
export function demoRecords(today: string): { obligations: DemoObligation[]; receipts: DemoReceipt[] } {
  return {
    obligations: [
      {
        payeeName: "Pacific Freight Co.",
        description: "Ocean freight for the October container shipment",
        invoiceReference: "PFC-2026-1187",
        amountMinor: 650_000n,
        priority: "critical",
        dueDate: addDays(today, 2),
        notes: NOTE,
      },
      {
        payeeName: "Brightline Packaging Ltd",
        description: "Packaging materials for the November production batch",
        invoiceReference: "BPL-55102",
        amountMinor: 300_000n,
        priority: "normal",
        dueDate: addDays(today, 9),
        notes: NOTE,
      },
    ],
    receipts: [
      {
        payerName: "Harbor Retail Ltd",
        reference: "HR-INV-2041",
        expectedAmountMinor: 900_000n,
        expectedDate: addDays(today, 1),
        notes: NOTE,
      },
    ],
  };
}

export const usd = (minor: bigint) => formatMoney(minor, DEMO_CURRENCY, EXPONENT);

export type ReadinessState = "ready" | "attention" | "missing";
export type ReadinessItem = { id: string; label: string; state: ReadinessState; detail: string };

export type DemoFacts = {
  connected: boolean;
  connectionMessage: string;
  /** null when Airwallex could not be asked. */
  usdGlobalAccount: { label: string; status: string | null } | null | undefined;
  beneficiary: { label: string } | null | undefined;
  /** Latest Airwallex snapshot of USD available, if any. */
  usdAvailableMinor: bigint | null;
  reserve: { amountMinor: bigint; enabled: boolean } | null;
  demoObligations: number;
  demoReceipts: number;
};

/**
 * Whether the sandbox and workspace can run the scenario as written. `undefined` provider facts
 * mean Airwallex could not be asked (reported as needing attention, never as ready).
 */
export function assessDemoReadiness(facts: DemoFacts): ReadinessItem[] {
  const expected = demoRecords("2000-01-01");
  const items: ReadinessItem[] = [
    {
      id: "connection",
      label: "Airwallex Sandbox connected",
      state: facts.connected ? "ready" : "missing",
      detail: facts.connectionMessage,
    },
    facts.usdGlobalAccount === undefined
      ? { id: "global-account", label: "USD Global Account", state: "attention", detail: "Could not list Global Accounts right now." }
      : facts.usdGlobalAccount === null
        ? {
            id: "global-account",
            label: "USD Global Account",
            state: "missing",
            detail: "Create a USD Global Account in the sandbox to simulate the partial customer deposit.",
          }
        : {
            id: "global-account",
            label: "USD Global Account",
            state: facts.usdGlobalAccount.status?.toUpperCase() === "ACTIVE" ? "ready" : "attention",
            detail: `${facts.usdGlobalAccount.label} receives the simulated ${usd(DEMO_PARTIAL_DEPOSIT_MINOR)} deposit${
              facts.usdGlobalAccount.status ? ` (${facts.usdGlobalAccount.status.toLowerCase()})` : ""
            }.`,
          },
    facts.beneficiary === undefined
      ? { id: "beneficiary", label: "USD beneficiary", state: "attention", detail: "Could not list beneficiaries right now." }
      : facts.beneficiary === null
        ? {
            id: "beneficiary",
            label: "USD beneficiary",
            state: "missing",
            detail: `Add a USD beneficiary (LOCAL) in the sandbox; "${DEMO_BENEFICIARY_LABEL}" is preferred.`,
          }
        : {
            id: "beneficiary",
            label: "USD beneficiary",
            state: "ready",
            detail: `Sample payments go to ${facts.beneficiary.label} (same currency, no FX).`,
          },
    facts.usdAvailableMinor === null
      ? {
          id: "balance",
          label: `Starting balance ${usd(DEMO_STARTING_AVAILABLE_MINOR)}`,
          state: "attention",
          detail: "No USD balance read yet. Refresh balances.",
        }
      : {
          id: "balance",
          label: `Starting balance ${usd(DEMO_STARTING_AVAILABLE_MINOR)}`,
          state: facts.usdAvailableMinor === DEMO_STARTING_AVAILABLE_MINOR ? "ready" : "attention",
          detail:
            facts.usdAvailableMinor === DEMO_STARTING_AVAILABLE_MINOR
              ? `Airwallex reports exactly ${usd(facts.usdAvailableMinor)} available.`
              : `Airwallex reports ${usd(facts.usdAvailableMinor)} available. The scenario assumes ${usd(
                  DEMO_STARTING_AVAILABLE_MINOR,
                )}; run "bun run demo:balance" to restore it (sandbox only).`,
        },
    {
      id: "reserve",
      label: `Protected reserve ${usd(DEMO_RESERVE_MINOR)}`,
      state: facts.reserve?.enabled && facts.reserve.amountMinor === DEMO_RESERVE_MINOR ? "ready" : "attention",
      detail: !facts.reserve
        ? "No USD reserve yet. Load demo data sets it."
        : `USD reserve is ${usd(facts.reserve.amountMinor)}${facts.reserve.enabled ? "" : " and switched off"}.`,
    },
    {
      id: "records",
      label: "Sample records",
      state:
        facts.demoObligations === expected.obligations.length && facts.demoReceipts === expected.receipts.length
          ? "ready"
          : facts.demoObligations + facts.demoReceipts === 0
            ? "missing"
            : "attention",
      detail: `${facts.demoObligations} of ${expected.obligations.length} sample obligations and ${facts.demoReceipts} of ${expected.receipts.length} sample expected receipts are active.`,
    },
  ];
  return items;
}
