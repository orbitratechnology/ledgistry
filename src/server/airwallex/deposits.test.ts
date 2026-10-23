import { describe, expect, it } from "vitest";

import { AirwallexClient } from "./client";
import { dateWindows, fetchDeposits, normalizeDeposits } from "./deposits";
import { json, loginOk, scriptedFetch, testConfig } from "./test-helpers";

const deposit = (overrides: Record<string, unknown> = {}) => ({
  id: "dep-1",
  amount: 4500,
  currency: "USD",
  status: "SETTLED",
  type: "BANK_TRANSFER",
  reference: "INV-2041",
  provider_transaction_id: "stmt-1",
  global_account_id: "ga-1",
  created_at: "2026-10-23T12:44:27+0000",
  settled_at: "2026-10-23T12:44:29+0000",
  payer: { name: "Harbor Retail Ltd", bank_account: { account_number: "123456789" } },
  ...overrides,
});

describe("dateWindows", () => {
  it("covers 90 days in 30-day windows, newest first, without gaps", () => {
    const until = new Date("2026-10-23T00:00:00Z");
    const since = new Date(until.getTime() - 90 * 86_400_000);
    const windows = dateWindows(since, until);
    expect(windows).toHaveLength(3);
    expect(windows[0].to).toEqual(until);
    expect(windows.at(-1)?.from).toEqual(since);
    for (let i = 1; i < windows.length; i += 1) expect(windows[i].to).toEqual(windows[i - 1].from);
    for (const window of windows) {
      expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(30 * 86_400_000);
    }
  });

  it("returns a single window for short ranges", () => {
    const until = new Date("2026-10-23T00:00:00Z");
    expect(dateWindows(new Date("2026-10-20T00:00:00Z"), until)).toHaveLength(1);
  });
});

describe("normalizeDeposits", () => {
  it("keeps evidence fields, converts to minor units and drops bank details", () => {
    const { rows, issues } = normalizeDeposits([deposit()], new Set(["dep-1"]));
    expect(issues).toEqual([]);
    expect(rows[0]).toMatchObject({
      provider_transaction_id: "dep-1",
      direction: "credit",
      amount_minor: 450_000,
      currency: "USD",
      provider_reference: "INV-2041",
      statement_reference: "stmt-1",
      counterparty_name: "Harbor Retail Ltd",
      provider_status: "SETTLED",
      is_sandbox_simulation: true,
      occurred_at: "2026-10-23T12:44:29+0000",
    });
    expect(JSON.stringify(rows[0])).not.toContain("123456789");
  });

  it("reports unrepresentable amounts instead of rounding them", () => {
    const { rows, issues } = normalizeDeposits([deposit({ currency: "JPY", amount: 10.5 })], new Set());
    expect(rows).toEqual([]);
    expect(issues[0].depositId).toBe("dep-1");
  });
});

describe("fetchDeposits", () => {
  it("queries each window with both bounds and de-duplicates boundary deposits", async () => {
    const { fetchImpl, calls } = scriptedFetch(
      () => loginOk(),
      () => json(200, { items: [deposit()], has_more: false }),
      () => json(200, { items: [deposit(), deposit({ id: "dep-2" })], has_more: false }),
      () => json(200, { items: [], has_more: false }),
    );
    const client = new AirwallexClient({ config: testConfig, fetchImpl, sleep: async () => {} });
    const until = new Date("2026-10-23T00:00:00Z");
    const result = await fetchDeposits(client, new Date(until.getTime() - 90 * 86_400_000), until);

    expect(result.deposits.map((item) => item.id).sort()).toEqual(["dep-1", "dep-2"]);
    const urls = calls.slice(1).map((call) => new URL(call.url));
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.searchParams.get("from_created_at")).toBeTruthy();
      expect(url.searchParams.get("to_created_at")).toBeTruthy();
      expect(url.searchParams.get("page_num")).toBe("0");
    }
  });
});
