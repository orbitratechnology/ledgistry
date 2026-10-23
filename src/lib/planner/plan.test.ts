import { describe, expect, it } from "vitest";

import { diffPlans } from "./diff";
import { buildPlan, canonicalPlanInputs, type PlanInputs, type PlanObligation, type PlanReceipt } from "./plan";
import { parseStoredPlan, serializePlan } from "./serialize";

const usd = (major: number) => BigInt(Math.round(major * 100));
const text = (value: string) => value.replace(/\s/g, " ");

const obligation = (overrides: Partial<PlanObligation> = {}): PlanObligation => ({
  id: "o-freight",
  payeeName: "Oceanic Freight",
  description: "October freight",
  invoiceReference: "FR-1001",
  amountMinor: usd(6_500),
  dueDate: "2026-10-30",
  priority: "critical",
  status: "planned",
  hasPaymentDetails: true,
  beneficiaryLabel: "Oceanic Freight · USD",
  allowPartialPayment: false,
  version: 1,
  isDemo: true,
  ...overrides,
});

const receipt = (overrides: Partial<PlanReceipt> = {}): PlanReceipt => ({
  id: "r-harbor",
  payerName: "Harbor Retail",
  reference: "INV-2041",
  outstandingMinor: usd(9_000),
  expectedDate: "2026-10-28",
  isDemo: true,
  ...overrides,
});

const supplier = obligation({
  id: "o-supplier",
  payeeName: "Northwind Supplies",
  amountMinor: usd(3_000),
  priority: "low",
  dueDate: "2026-10-27",
  invoiceReference: "NW-77",
});

const inputs = (overrides: Partial<PlanInputs> = {}): PlanInputs => ({
  currency: "USD",
  exponent: 2,
  today: "2026-10-23",
  balance: { snapshotId: "snap-1", availableMinor: usd(12_000), fetchedAt: "2026-10-23T10:00:00Z" },
  reserve: { amountMinor: usd(4_000), enabled: true },
  obligations: [obligation(), supplier],
  receipts: [receipt()],
  ...overrides,
});

describe("buildPlan — PRD Flow D", () => {
  it("recommends the critical freight and defers the supplier to protect the reserve", () => {
    const plan = buildPlan(inputs());
    expect(plan.status).toBe("ok");
    expect(plan.summary.spendableNowMinor).toBe(usd(8_000));

    const [freight, deferred] = plan.items;
    expect(freight).toMatchObject({ rank: 1, obligationId: "o-freight", decision: "recommended" });
    expect(freight.availableAfterMinor).toBe(usd(5_500));
    expect(freight.headroomAfterMinor).toBe(usd(1_500));

    expect(deferred).toMatchObject({ rank: 2, obligationId: "o-supplier", decision: "deferred", reasonCode: "exceeds_headroom" });
    expect(deferred.availableAfterMinor).toBe(usd(2_500));
    expect(text(deferred.reason)).toBe(
      "Paying this after the higher-ranked payments above would reduce projected available cash to USD 2,500.00, below your USD 4,000.00 reserve.",
    );
    expect(plan.summary.availableAfterPlanMinor).toBe(usd(5_500));
  });

  it("never adds the expected receipt to spendable cash; it only appears in the forecast", () => {
    const plan = buildPlan(inputs());
    expect(plan.summary.spendableNowMinor).toBe(usd(8_000));
    expect(plan.forecast?.totalMinor).toBe(usd(9_000));
    expect(plan.forecast?.outcomes).toEqual([
      { obligationId: "o-supplier", fits: true, availableAfterMinor: usd(11_500) },
    ]);

    const withoutReceipt = buildPlan(inputs({ receipts: [] }));
    expect(withoutReceipt.items.map((item) => item.decision)).toEqual(plan.items.map((item) => item.decision));
  });

  it("recommends the supplier once real cash covers it after the partial receipt", () => {
    // Freight paid (USD 12,000 − 6,500), then a USD 4,500 partial receipt landed: USD 10,000 actual.
    const after = buildPlan(
      inputs({
        balance: { snapshotId: "snap-2", availableMinor: usd(10_000), fetchedAt: "2026-10-23T11:00:00Z" },
        obligations: [obligation({ status: "paid" }), supplier],
        receipts: [receipt({ outstandingMinor: usd(4_500) })],
      }),
    );
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ obligationId: "o-supplier", decision: "recommended" });
    expect(after.items[0].availableAfterMinor).toBe(usd(7_000));
    expect(after.forecast?.totalMinor).toBe(usd(4_500));

    const changes = diffPlans(buildPlan(inputs()), after).map((change) => text(change.text));
    expect(changes).toContain("Available cash fell from USD 12,000.00 to USD 10,000.00.");
    expect(changes).toContain("Northwind Supplies (USD 3,000.00) moved from Deferred to Recommended.");
    expect(changes).toContain("Oceanic Freight (USD 6,500.00) is no longer in the plan.");
    expect(changes).toContain(
      "Expected receipts still outstanding (forecast) changed from USD 9,000.00 to USD 4,500.00.",
    );
  });
});

describe("buildPlan — ranking and decisions", () => {
  it("ranks by priority, then due date, then smaller amount", () => {
    const plan = buildPlan(
      inputs({
        balance: { snapshotId: "s", availableMinor: usd(100_000), fetchedAt: "2026-10-23T10:00:00Z" },
        obligations: [
          obligation({ id: "c", payeeName: "C", priority: "high", dueDate: "2026-11-01", amountMinor: usd(500) }),
          obligation({ id: "a", payeeName: "A", priority: "low", dueDate: "2026-10-01", amountMinor: usd(100) }),
          obligation({ id: "b", payeeName: "B", priority: "high", dueDate: "2026-10-25", amountMinor: usd(900) }),
          obligation({ id: "d", payeeName: "D", priority: "high", dueDate: "2026-10-25", amountMinor: usd(300) }),
        ],
      }),
    );
    expect(plan.items.map((item) => item.obligationId)).toEqual(["d", "b", "c", "a"]);
    expect(plan.items.find((item) => item.obligationId === "a")?.overdue).toBe(true);
  });

  it("still recommends a lower-ranked payment that fits after a larger one is deferred", () => {
    const plan = buildPlan(
      inputs({
        balance: { snapshotId: "s", availableMinor: usd(10_000), fetchedAt: "2026-10-23T10:00:00Z" },
        obligations: [obligation({ amountMinor: usd(7_000) }), obligation({ ...supplier, amountMinor: usd(2_000) })],
      }),
    );
    expect(plan.items.map((item) => [item.obligationId, item.decision])).toEqual([
      ["o-freight", "deferred"],
      ["o-supplier", "recommended"],
    ]);
    expect(text(plan.items[0].reason)).toBe(
      "Paying this would reduce projected available cash to USD 3,000.00, below your USD 4,000.00 reserve.",
    );
  });

  it("holds cash for a higher-ranked obligation that only lacks payment details", () => {
    const plan = buildPlan(
      inputs({
        balance: { snapshotId: "s", availableMinor: usd(10_000), fetchedAt: "2026-10-23T10:00:00Z" },
        obligations: [obligation({ amountMinor: usd(5_000), hasPaymentDetails: false, beneficiaryLabel: null }), supplier],
      }),
    );
    expect(plan.items.map((item) => item.decision)).toEqual(["needs_details", "deferred"]);
    expect(plan.summary.heldForDetailsMinor).toBe(usd(5_000));
    expect(plan.summary.recommendedCount).toBe(0);
  });

  it("allows a payment that lands exactly on the reserve, but not one cent below", () => {
    const exact = buildPlan(inputs({ obligations: [obligation({ amountMinor: usd(8_000) })], receipts: [] }));
    expect(exact.items[0].decision).toBe("recommended");
    expect(exact.items[0].headroomAfterMinor).toBe(0n);

    const over = buildPlan(inputs({ obligations: [obligation({ amountMinor: usd(8_000) + 1n })], receipts: [] }));
    expect(over.items[0].decision).toBe("deferred");
  });

  it("defers everything when cash is already below the reserve", () => {
    const plan = buildPlan(
      inputs({ balance: { snapshotId: "s", availableMinor: usd(3_000), fetchedAt: "2026-10-23T10:00:00Z" } }),
    );
    expect(plan.summary.spendableNowMinor).toBe(0n);
    expect(plan.items.every((item) => item.reasonCode === "below_reserve_already")).toBe(true);
    expect(plan.warnings.map((warning) => warning.code)).toContain("below_reserve");
  });

  it("blocks planning without an actual balance instead of assuming one", () => {
    const plan = buildPlan(inputs({ balance: null }));
    expect(plan.status).toBe("no_balance");
    expect(plan.items.every((item) => item.decision === "blocked")).toBe(true);
    expect(plan.forecast).toBeNull();
    expect(plan.summary.availableAfterPlanMinor).toBeNull();
  });

  it("warns when no reserve is protected and plans against zero", () => {
    const plan = buildPlan(inputs({ reserve: null }));
    expect(plan.reserveMinor).toBe(0n);
    expect(plan.warnings[0].code).toBe("no_reserve");
    expect(plan.items.map((item) => item.decision)).toEqual(["recommended", "recommended"]);

    const disabled = buildPlan(inputs({ reserve: { amountMinor: usd(4_000), enabled: false } }));
    expect(disabled.reserveMinor).toBe(0n);
    expect(disabled.warnings[0].code).toBe("reserve_disabled");
  });

  it("lists drafts, your deferrals and in-flight payments without allocating cash to them", () => {
    const plan = buildPlan(
      inputs({
        obligations: [
          obligation({ id: "draft", status: "draft" }),
          obligation({ id: "mine", status: "deferred" }),
          obligation({ id: "flight", status: "in_progress" }),
          obligation({ id: "done", status: "paid" }),
          obligation({ id: "gone", status: "cancelled" }),
        ],
      }),
    );
    expect(plan.status).toBe("nothing_to_plan");
    expect(plan.items).toEqual([]);
    expect(plan.excluded.map((item) => item.obligationId).sort()).toEqual(["draft", "flight", "mine"]);
  });

  it("never plans partial payments", () => {
    const plan = buildPlan(inputs({ obligations: [obligation({ amountMinor: usd(9_000), allowPartialPayment: true })] }));
    expect(plan.items[0].decision).toBe("deferred");
    expect(plan.warnings.map((warning) => warning.code)).toContain("partial_not_planned");
  });

  it("only forecasts receipts expected within the horizon, overdue ones included", () => {
    const plan = buildPlan(
      inputs({
        receipts: [
          receipt({ id: "late", expectedDate: "2026-10-01" }),
          receipt({ id: "soon", expectedDate: "2026-11-20" }),
          receipt({ id: "far", expectedDate: "2027-01-15" }),
          receipt({ id: "done", outstandingMinor: 0n }),
        ],
      }),
    );
    expect(plan.forecast?.receipts.map((item) => [item.id, item.overdue])).toEqual([
      ["late", true],
      ["soon", false],
    ]);
  });

  it("keeps exact minor units for zero-decimal currencies", () => {
    const plan = buildPlan(
      inputs({
        currency: "JPY",
        exponent: 0,
        balance: { snapshotId: "s", availableMinor: 1_000_000n, fetchedAt: "2026-10-23T10:00:00Z" },
        reserve: { amountMinor: 400_000n, enabled: true },
        obligations: [obligation({ amountMinor: 600_000n })],
        receipts: [],
      }),
    );
    expect(plan.items[0].decision).toBe("recommended");
    expect(text(plan.items[0].reason)).toBe("Paying this leaves JPY 400,000 available, JPY 0 above your JPY 400,000 reserve.");
  });
});

describe("plan identity and storage", () => {
  it("is stable for the same inputs regardless of their order", () => {
    const a = inputs();
    const b = inputs({ obligations: [...a.obligations].reverse(), receipts: [...a.receipts].reverse() });
    expect(buildPlan(a)).toEqual(buildPlan(b));
    expect(canonicalPlanInputs(a)).toBe(canonicalPlanInputs(b));
  });

  it("changes identity when any material input changes", () => {
    const base = canonicalPlanInputs(inputs());
    expect(canonicalPlanInputs(inputs({ obligations: [obligation({ version: 2 }), supplier] }))).not.toBe(base);
    expect(canonicalPlanInputs(inputs({ reserve: { amountMinor: usd(4_500), enabled: true } }))).not.toBe(base);
    expect(
      canonicalPlanInputs(
        inputs({ balance: { snapshotId: "snap-9", availableMinor: usd(12_000), fetchedAt: "2026-10-23T12:00:00Z" } }),
      ),
    ).not.toBe(base);
    expect(canonicalPlanInputs(inputs({ receipts: [receipt({ outstandingMinor: usd(4_500) })] }))).not.toBe(base);
    expect(canonicalPlanInputs(inputs({ today: "2026-10-24" }))).not.toBe(base);
  });

  it("round-trips through storage with exact amounts", () => {
    const plan = buildPlan(inputs());
    const stored = JSON.parse(JSON.stringify(serializePlan(plan)));
    expect(parseStoredPlan(stored)).toEqual(plan);
    expect(parseStoredPlan({ ...stored, reserveMinor: "12.5" })).toBeNull();
  });
});
