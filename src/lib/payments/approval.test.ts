import { describe, expect, it } from "vitest";

import {
  canonicalPaymentIntent,
  evaluatePaymentGate,
  transferReference,
  type GateFacts,
  type PaymentIntent,
} from "./approval";

const intent: PaymentIntent = {
  workspaceId: "w1",
  obligationId: "o1",
  obligationVersion: 3,
  payeeName: "Oceanic Freight",
  amountMinor: 650_000n,
  currency: "USD",
  beneficiaryId: "b1",
  transferMethod: "LOCAL",
  reference: "FR-1001",
  reserveMinor: 400_000n,
  reserveEnabled: true,
};

const now = new Date("2026-10-24T10:00:00Z");
const facts = (overrides: Partial<GateFacts> = {}): GateFacts => ({
  sandbox: true,
  obligation: {
    status: "planned",
    archived: false,
    amountMinor: 650_000n,
    currency: "USD",
    exponent: 2,
    hasActiveOperation: false,
  },
  beneficiary: { state: "found", currency: "USD", transferMethods: ["LOCAL"] },
  balance: { availableMinor: 1_200_000n, fetchedAt: "2026-10-24T09:58:00Z" },
  reserveMinor: 400_000n,
  planDecision: "recommended",
  planReason: null,
  now,
  ...overrides,
});
const codes = (overrides: Partial<GateFacts>) => evaluatePaymentGate(facts(overrides)).map((blocker) => blocker.code);

describe("approval fingerprint inputs", () => {
  it("is identical for identical intents", () => {
    expect(canonicalPaymentIntent({ ...intent })).toBe(canonicalPaymentIntent(intent));
  });

  it.each([
    ["amount", { amountMinor: 650_001n }],
    ["currency", { currency: "EUR" }],
    ["payee", { payeeName: "Oceanic Freight Ltd" }],
    ["beneficiary", { beneficiaryId: "b2" }],
    ["reference", { reference: "FR-1002" }],
    ["obligation version", { obligationVersion: 4 }],
    ["reserve", { reserveMinor: 450_000n }],
    ["reserve switch", { reserveEnabled: false }],
    ["transfer method", { transferMethod: "SWIFT" }],
  ] as const)("changes when the %s changes, invalidating a stale approval", (_label, change) => {
    expect(canonicalPaymentIntent({ ...intent, ...change })).not.toBe(canonicalPaymentIntent(intent));
  });
});

describe("transferReference", () => {
  it("prefers the invoice reference and keeps provider-safe characters", () => {
    expect(transferReference("FR-1001", "Ocean freight")).toBe("FR-1001");
    expect(transferReference(null, "Ocean freight; October <urgent>")).toBe("Ocean freight October urgent");
    expect(transferReference("", "x".repeat(60))).toHaveLength(35);
  });
});

describe("evaluatePaymentGate", () => {
  it("allows a recommended, fully specified sandbox payment that keeps the reserve", () => {
    expect(evaluatePaymentGate(facts())).toEqual([]);
  });

  it("refuses anything outside the sandbox", () => {
    expect(codes({ sandbox: false })).toContain("not_sandbox");
  });

  it("refuses when paying would breach the reserve, and says by how much", () => {
    const blockers = evaluatePaymentGate(facts({ balance: { availableMinor: 1_000_000n, fetchedAt: "2026-10-24T09:58:00Z" }, planDecision: "deferred" }));
    expect(blockers.map((blocker) => blocker.code)).toEqual(["reserve"]);
    expect(blockers[0].message.replace(/\s/g, " ")).toBe(
      "Paying USD 6,500.00 would leave USD 3,500.00, below your USD 4,000.00 reserve.",
    );
  });

  it("refuses a payment the fresh plan no longer recommends", () => {
    expect(codes({ planDecision: "deferred", planReason: "Paying this would breach the reserve." })).toEqual(["not_recommended"]);
  });

  it("requires a live balance", () => {
    expect(codes({ balance: null })).toContain("no_balance");
    expect(codes({ balance: { availableMinor: 1_200_000n, fetchedAt: "2026-10-24T09:50:00Z" } })).toContain("stale_balance");
  });

  it("requires a beneficiary in the obligation's currency, without assuming FX", () => {
    expect(codes({ beneficiary: { state: "none" } })).toContain("no_beneficiary");
    expect(codes({ beneficiary: { state: "not_found" } })).toContain("beneficiary_not_found");
    expect(codes({ beneficiary: { state: "found", currency: "EUR", transferMethods: ["LOCAL"] } })).toContain(
      "beneficiary_currency",
    );
  });

  it("refuses drafts, archived obligations and a second payment while one is in flight", () => {
    expect(codes({ obligation: { ...facts().obligation, status: "draft" } })).toContain("status");
    expect(codes({ obligation: { ...facts().obligation, status: "paid" } })).toContain("status");
    expect(codes({ obligation: { ...facts().obligation, archived: true } })).toContain("archived");
    expect(codes({ obligation: { ...facts().obligation, hasActiveOperation: true } })).toContain("in_flight");
  });

  it("allows retrying a failed payment through a new approval", () => {
    expect(codes({ obligation: { ...facts().obligation, status: "failed" } })).toEqual([]);
  });
});
