import { describe, expect, it } from "vitest";

import { fieldErrorsFrom, obligationFormSchema, receiptFormSchema } from "./forms";

const obligation = {
  payeeName: "Pacific Freight",
  description: "Ocean freight October",
  invoiceReference: "",
  amount: "6,500.00",
  currency: "usd",
  dueDate: "2026-10-30",
  priority: "critical",
  status: "planned",
  beneficiaryId: "",
  notes: "",
};

describe("obligationFormSchema", () => {
  it("parses amounts exactly in minor units and normalises optional fields", () => {
    const parsed = obligationFormSchema.parse(obligation);
    expect(parsed).toMatchObject({
      currency: "USD",
      amountMinor: 650_000n,
      invoiceReference: null,
      beneficiaryId: null,
      notes: null,
    });
  });

  it("reports amount errors against the amount field using the currency's precision", () => {
    const result = obligationFormSchema.safeParse({ ...obligation, currency: "JPY", amount: "10.5" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrorsFrom(result.error)).toEqual({ amount: "This currency has no decimal places." });
    }
  });

  it("rejects system-only statuses, unknown currencies and bad dates", () => {
    const result = obligationFormSchema.safeParse({
      ...obligation,
      status: "paid",
      currency: "ZZZ",
      dueDate: "30/10/2026",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(fieldErrorsFrom(result.error)).sort()).toEqual(["currency", "dueDate", "status"]);
    }
  });
});

describe("receiptFormSchema", () => {
  it("requires a meaningful reference for matching", () => {
    const result = receiptFormSchema.safeParse({
      payerName: "Harbor Retail",
      reference: "AB",
      amount: "9000",
      currency: "USD",
      expectedDate: "2026-10-23",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrorsFrom(result.error)).toHaveProperty("reference");
  });
});
