import { describe, expect, it } from "vitest";

import { deriveReceiptState, deriveTransactionState, isOperatorEditableStatus } from "./states";

const receiptFacts = (overrides: Partial<Parameters<typeof deriveReceiptState>[0]> = {}) => ({
  cancelled: false,
  expectedMinor: 900_000n,
  receivedMinor: 0n,
  openReviewCount: 0,
  openSuggestionCount: 0,
  expectedDate: "2026-10-23",
  today: "2026-10-23",
  ...overrides,
});

describe("deriveReceiptState", () => {
  it("is expected before anything arrives", () => {
    expect(deriveReceiptState(receiptFacts())).toMatchObject({
      state: "expected",
      outstandingMinor: 900_000n,
      overdue: false,
    });
  });

  it("never reports a partial receipt as matched", () => {
    const result = deriveReceiptState(receiptFacts({ receivedMinor: 450_000n }));
    expect(result.state).toBe("partially_received");
    expect(result.outstandingMinor).toBe(450_000n);
  });

  it("is matched only when fully received", () => {
    expect(deriveReceiptState(receiptFacts({ receivedMinor: 900_000n })).state).toBe("matched");
  });

  it("flags overdue receipts with an outstanding balance", () => {
    expect(deriveReceiptState(receiptFacts({ today: "2026-10-30" }))).toMatchObject({
      state: "overdue",
      overdue: true,
    });
    const partial = deriveReceiptState(receiptFacts({ today: "2026-10-30", receivedMinor: 1n }));
    expect(partial).toMatchObject({ state: "partially_received", overdue: true });
  });

  it("prioritises open reviews and cancellation", () => {
    expect(deriveReceiptState(receiptFacts({ openReviewCount: 1 })).state).toBe("needs_review");
    expect(deriveReceiptState(receiptFacts({ cancelled: true, today: "2027-01-01" }))).toMatchObject({
      state: "cancelled",
      overdue: false,
    });
  });
});

describe("deriveTransactionState", () => {
  const facts = (overrides: Partial<Parameters<typeof deriveTransactionState>[0]> = {}) => ({
    providerStatus: "SETTLED",
    amountMinor: 450_000n,
    appliedMinor: 0n,
    openSuggestionCount: 0,
    openReviewCount: 0,
    duplicateSuspected: false,
    ...overrides,
  });

  it("covers the PRD match states", () => {
    expect(deriveTransactionState(facts()).state).toBe("unmatched");
    expect(deriveTransactionState(facts({ openSuggestionCount: 1 })).state).toBe("suggested_match");
    expect(deriveTransactionState(facts({ openReviewCount: 1 })).state).toBe("needs_review");
    expect(deriveTransactionState(facts({ appliedMinor: 100n })).state).toBe("partially_matched");
    expect(deriveTransactionState(facts({ appliedMinor: 450_000n })).state).toBe("matched");
    expect(deriveTransactionState(facts({ duplicateSuspected: true })).state).toBe("duplicate_suspected");
  });

  it("needs review when the provider reverses a deposit after it was matched", () => {
    expect(
      deriveTransactionState(facts({ appliedMinor: 450_000n, providerStatus: "REVERSED" })),
    ).toMatchObject({ state: "needs_review", providerChangedAfterMatch: true });
  });
});

describe("isOperatorEditableStatus", () => {
  it("allows operator statuses and retries after failure only", () => {
    expect(isOperatorEditableStatus("planned")).toBe(true);
    expect(isOperatorEditableStatus("failed")).toBe(true);
    expect(isOperatorEditableStatus("paid")).toBe(false);
    expect(isOperatorEditableStatus("in_progress")).toBe(false);
  });
});
