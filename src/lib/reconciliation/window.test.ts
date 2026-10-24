import { describe, expect, it } from "vitest";

import { importWindowStart, LOOKBACK_DAYS } from "./window";

const now = Date.parse("2026-10-24T12:00:00Z");
const day = 86_400_000;

describe("importWindowStart", () => {
  it("uses the default lookback without a reconciliation start date", () => {
    expect(importWindowStart(null, now).getTime()).toBe(now - LOOKBACK_DAYS * day);
  });

  it("starts at the reconciliation start date when it is within the lookback", () => {
    expect(importWindowStart("2026-10-24T09:30:00Z", now).toISOString()).toBe("2026-10-24T09:30:00.000Z");
  });

  it("never reaches further back than the lookback, nor into the future", () => {
    expect(importWindowStart("2020-01-01T00:00:00Z", now).getTime()).toBe(now - LOOKBACK_DAYS * day);
    expect(importWindowStart("2026-12-01T00:00:00Z", now).getTime()).toBe(now);
  });

  it("ignores an unreadable date", () => {
    expect(importWindowStart("not a date", now).getTime()).toBe(now - LOOKBACK_DAYS * day);
  });
});
