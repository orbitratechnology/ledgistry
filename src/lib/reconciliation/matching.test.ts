import { describe, expect, it } from "vitest";

import {
  findSuspectedDuplicates,
  pairKey,
  proposeMatches,
  type MatchableReceipt,
  type MatchableTransaction,
} from "./matching";
import { containsReference, nameSimilarity } from "./text";

const txn = (overrides: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: "t1",
  currency: "USD",
  exponent: 2,
  amountMinor: 450_000n,
  unappliedMinor: 450_000n,
  providerStatus: "SETTLED",
  reference: "INV-2041",
  statementReference: null,
  counterpartyName: "Harbor Retail Ltd",
  occurredAt: "2026-10-24T09:00:00Z",
  ...overrides,
});

const receipt = (overrides: Partial<MatchableReceipt> = {}): MatchableReceipt => ({
  id: "r1",
  currency: "USD",
  exponent: 2,
  outstandingMinor: 900_000n,
  reference: "INV-2041",
  payerName: "Harbor Retail",
  expectedDate: "2026-10-23",
  ...overrides,
});

const propose = (
  transactions: MatchableTransaction[],
  receipts: MatchableReceipt[],
  decided: string[] = [],
) => proposeMatches({ transactions, receipts, decidedPairs: new Set(decided) });

describe("text helpers", () => {
  it("matches references on token boundaries regardless of separators", () => {
    expect(containsReference("Payment for INV-2041, thanks", "INV-2041")).toBe(true);
    expect(containsReference("inv 2041", "INV-2041")).toBe(true);
    expect(containsReference("INV2041", "INV-2041")).toBe(true);
    expect(containsReference("INV-20410", "INV-2041")).toBe(false);
    expect(containsReference("XINV-2041", "INV-2041")).toBe(false);
    expect(containsReference(null, "INV-2041")).toBe(false);
    expect(containsReference("AB", "AB")).toBe(false); // too short to be evidence
  });

  it("scores payer names ignoring legal suffixes and case", () => {
    expect(nameSimilarity("Harbor Retail Ltd", "HARBOR RETAIL")).toBe(1);
    expect(nameSimilarity("Northwind Traders", "Northwind Logistics")).toBeCloseTo(1 / 3);
    expect(nameSimilarity("Acme", null)).toBe(0);
  });
});

describe("proposeMatches", () => {
  it("suggests an exact reference + amount match without flagging review", () => {
    const [proposal] = propose([txn({ amountMinor: 900_000n, unappliedMinor: 900_000n })], [receipt()]);
    expect(proposal).toMatchObject({
      matchType: "exact_reference",
      status: "suggested",
      discrepancy: { kind: "none" },
    });
    expect(proposal.signals).toEqual(
      expect.arrayContaining(["reference_match", "amount_match", "payer_similarity", "date_proximity"]),
    );
    expect(proposal.confidence).toBe(1);
  });

  it("describes a partial receipt and its shortfall precisely", () => {
    const [proposal] = propose([txn()], [receipt()]);
    expect(proposal.status).toBe("suggested");
    expect(proposal.signals).toContain("partial_amount");
    expect(proposal.discrepancy).toEqual({ kind: "shortfall", amountMinor: 450_000n });
    expect(proposal.explanation.replace(/\s/g, " ")).toContain("USD 4,500.00 would remain outstanding");
  });

  it("never matches across currencies", () => {
    expect(propose([txn({ currency: "HKD" })], [receipt()])).toEqual([]);
  });

  it("requires review when only payer/amount/date evidence exists", () => {
    const [proposal] = propose(
      [txn({ reference: "Wire transfer", amountMinor: 900_000n, unappliedMinor: 900_000n })],
      [receipt()],
    );
    expect(proposal.matchType).toBe("exact_amount");
    expect(proposal.status).toBe("needs_review");
    expect(proposal.reviewReasons.join(" ")).toMatch(/No reference match/);
  });

  it("does not propose on a similar amount alone", () => {
    const proposals = propose(
      [txn({ reference: null, counterpartyName: "Someone Else", occurredAt: "2026-09-01T00:00:00Z" })],
      [receipt({ outstandingMinor: 450_000n })],
    );
    expect(proposals).toEqual([]);
  });

  it("marks ambiguous candidates for review instead of picking one", () => {
    const proposals = propose(
      [txn({ amountMinor: 900_000n, unappliedMinor: 900_000n })],
      [receipt({ id: "r1" }), receipt({ id: "r2" })],
    );
    expect(proposals).toHaveLength(2);
    expect(proposals.every((proposal) => proposal.status === "needs_review")).toBe(true);
    expect(proposals[0].reviewReasons[0]).toMatch(/Several expected receipts/);
  });

  it("flags an overpayment as needing review", () => {
    const [proposal] = propose(
      [txn({ amountMinor: 1_000_000n, unappliedMinor: 1_000_000n })],
      [receipt()],
    );
    expect(proposal.discrepancy).toEqual({ kind: "excess", amountMinor: 100_000n });
    expect(proposal.status).toBe("needs_review");
  });

  it("only proposes against what is still outstanding / unapplied", () => {
    expect(propose([txn({ unappliedMinor: 0n })], [receipt()])).toEqual([]);
    expect(propose([txn()], [receipt({ outstandingMinor: 0n })])).toEqual([]);
  });

  it("is idempotent: previously decided pairs are never re-proposed", () => {
    expect(propose([txn()], [receipt()], [pairKey("t1", "r1")])).toEqual([]);
  });

  it("does not promote a runner-up while the best fit is already awaiting review", () => {
    const receipts = [
      receipt({ id: "r1" }),
      // Same payer and exactly the deposit amount, but no reference: a weaker fit.
      receipt({ id: "r2", reference: "PO-7", outstandingMinor: 450_000n }),
    ];
    const open = new Set([pairKey("t1", "r1")]);
    expect(proposeMatches({ transactions: [txn()], receipts, decidedPairs: new Set(), openPairs: open })).toEqual([]);
    // Once the best fit is rejected, the runner-up may be proposed, flagged for review.
    const [next] = propose([txn()], receipts, [pairKey("t1", "r1")]);
    expect(next.expectedReceiptId).toBe("r2");
    expect(next.status).toBe("needs_review");
  });

  it("keeps pending deposits reviewable and ignores rejected ones", () => {
    const [pending] = propose([txn({ providerStatus: "PENDING" })], [receipt()]);
    expect(pending.status).toBe("needs_review");
    expect(propose([txn({ providerStatus: "REJECTED" })], [receipt()])).toEqual([]);
  });

  it("produces stable output for identical input", () => {
    const input = [[txn()], [receipt({ id: "r1" }), receipt({ id: "r2", reference: "PO-1" })]] as const;
    expect(propose([...input[0]], [...input[1]])).toEqual(propose([...input[0]], [...input[1]]));
  });
});

describe("findSuspectedDuplicates", () => {
  it("flags same amount + reference within three days", () => {
    const flagged = findSuspectedDuplicates([
      txn({ id: "a" }),
      txn({ id: "b", occurredAt: "2026-10-25T10:00:00Z" }),
      txn({ id: "c", reference: "INV-9999" }),
    ]);
    expect([...flagged].sort()).toEqual(["a", "b"]);
  });

  it("does not flag the same reference far apart or with different amounts", () => {
    expect(
      findSuspectedDuplicates([
        txn({ id: "a" }),
        txn({ id: "b", occurredAt: "2026-11-30T00:00:00Z" }),
        txn({ id: "c", amountMinor: 1n, unappliedMinor: 1n }),
      ]).size,
    ).toBe(0);
  });

  it("flags same payer and amount when neither deposit has a reference", () => {
    const flagged = findSuspectedDuplicates([
      txn({ id: "a", reference: null }),
      txn({ id: "b", reference: null }),
    ]);
    expect(flagged.size).toBe(2);
  });

  it("marks proposals on suspected duplicates for review", () => {
    const proposals = proposeMatches({
      transactions: [txn({ id: "a" }), txn({ id: "b" })],
      receipts: [receipt()],
      decidedPairs: new Set(),
    });
    expect(proposals.every((proposal) => proposal.status === "needs_review")).toBe(true);
    expect(proposals[0].reviewReasons.join(" ")).toMatch(/possible duplicate/);
  });
});
