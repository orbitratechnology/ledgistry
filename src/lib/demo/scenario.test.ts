import { describe, expect, it } from "vitest";

import { buildPlan, type PlanInputs, type PlanObligation } from "@/lib/planner/plan";
import {
  assessDemoReadiness,
  DEMO_PARTIAL_DEPOSIT_MINOR,
  DEMO_RESERVE_MINOR,
  DEMO_STARTING_AVAILABLE_MINOR,
  demoRecords,
  type DemoFacts,
} from "./scenario";

const today = "2026-10-24";
const records = demoRecords(today);

const obligations = (paid: string[] = []): PlanObligation[] =>
  records.obligations.map((obligation, index) => ({
    id: `o-${index}`,
    payeeName: obligation.payeeName,
    description: obligation.description,
    invoiceReference: obligation.invoiceReference,
    amountMinor: obligation.amountMinor,
    dueDate: obligation.dueDate,
    priority: obligation.priority,
    status: paid.includes(obligation.payeeName) ? "paid" : "planned",
    hasPaymentDetails: true,
    beneficiaryLabel: "US USD LOCAL",
    allowPartialPayment: false,
    version: 1,
    isDemo: true,
  }));

const plan = (availableMinor: bigint, paid: string[] = []) =>
  buildPlan({
    currency: "USD",
    exponent: 2,
    today,
    balance: { snapshotId: "snap", availableMinor, fetchedAt: `${today}T10:00:00Z` },
    reserve: { amountMinor: DEMO_RESERVE_MINOR, enabled: true },
    obligations: obligations(paid),
    receipts: [],
  } satisfies PlanInputs);

const decisions = (result: ReturnType<typeof plan>) =>
  Object.fromEntries(result.items.map((item) => [item.payeeName, item.decision]));

describe("demo scenario (PRD Flow D)", () => {
  it("creates the PRD's sample records with dates relative to today", () => {
    expect(records.obligations.map((o) => [o.payeeName, o.amountMinor, o.priority, o.dueDate])).toEqual([
      ["Pacific Freight Co.", 650_000n, "critical", "2026-10-26"],
      ["Brightline Packaging Ltd", 300_000n, "normal", "2026-11-02"],
    ]);
    expect(records.receipts).toMatchObject([{ reference: "HR-INV-2041", expectedAmountMinor: 900_000n, expectedDate: "2026-10-25" }]);
    for (const record of [...records.obligations, ...records.receipts]) expect(record.notes).toMatch(/^Sample record/);
  });

  it("starts by recommending the freight and deferring packaging to protect the reserve", () => {
    expect(decisions(plan(DEMO_STARTING_AVAILABLE_MINOR))).toEqual({
      "Pacific Freight Co.": "recommended",
      "Brightline Packaging Ltd": "deferred",
    });
  });

  it("makes packaging payable once the freight is paid and the partial receipt arrives", () => {
    const fee = 1_500n; // any plausible payer-side fee still leaves room above the reserve
    const after = DEMO_STARTING_AVAILABLE_MINOR - 650_000n - fee + DEMO_PARTIAL_DEPOSIT_MINOR;
    expect(decisions(plan(after, ["Pacific Freight Co."]))).toEqual({ "Brightline Packaging Ltd": "recommended" });
    // Without the deposit it stays deferred.
    expect(decisions(plan(after - DEMO_PARTIAL_DEPOSIT_MINOR, ["Pacific Freight Co."]))).toEqual({
      "Brightline Packaging Ltd": "deferred",
    });
  });
});

describe("assessDemoReadiness", () => {
  const ready: DemoFacts = {
    connected: true,
    connectionMessage: "Connected to Airwallex Sandbox.",
    usdGlobalAccount: { label: "Ledgistry USD receipts (sandbox)", status: "ACTIVE" },
    beneficiary: { label: "US USD LOCAL" },
    usdAvailableMinor: DEMO_STARTING_AVAILABLE_MINOR,
    reserve: { amountMinor: DEMO_RESERVE_MINOR, enabled: true },
    demoObligations: 2,
    demoReceipts: 1,
  };
  const states = (facts: DemoFacts) => Object.fromEntries(assessDemoReadiness(facts).map((item) => [item.id, item.state]));

  it("is ready when the sandbox and the workspace match the scenario", () => {
    expect(new Set(Object.values(states(ready)))).toEqual(new Set(["ready"]));
  });

  it("points at the balance script when the sandbox balance differs, without inventing a balance", () => {
    const items = assessDemoReadiness({ ...ready, usdAvailableMinor: 1_000_000n });
    const balance = items.find((item) => item.id === "balance")!;
    expect(balance.state).toBe("attention");
    expect(balance.detail.replace(/\s/g, " ")).toContain("Airwallex reports USD 10,000.00 available");
    expect(balance.detail).toContain("bun run demo:balance");
    expect(states({ ...ready, usdAvailableMinor: null }).balance).toBe("attention");
  });

  it("never reports an unknown provider fact as ready", () => {
    expect(states({ ...ready, connected: false, usdGlobalAccount: undefined, beneficiary: undefined })).toMatchObject({
      connection: "missing",
      "global-account": "attention",
      beneficiary: "attention",
    });
    expect(states({ ...ready, usdGlobalAccount: null, beneficiary: null })).toMatchObject({
      "global-account": "missing",
      beneficiary: "missing",
    });
  });

  it("flags missing or partial sample records and a reserve that differs", () => {
    expect(states({ ...ready, demoObligations: 0, demoReceipts: 0 }).records).toBe("missing");
    expect(states({ ...ready, demoObligations: 1 }).records).toBe("attention");
    expect(states({ ...ready, reserve: { amountMinor: DEMO_RESERVE_MINOR, enabled: false } }).reserve).toBe("attention");
    expect(states({ ...ready, reserve: null }).reserve).toBe("attention");
  });
});
