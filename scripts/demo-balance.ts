/**
 * Demo reset helper: brings Airwallex Sandbox USD available back to exactly USD 12,000.00 (the
 * demo's starting cash) by converting between the sandbox account's own wallets. Sandbox only.
 * The app never does this itself: its only money-moving path is an approved transfer.
 *
 *   bun run demo:balance              # dry run: shows the conversion it would make
 *   bun run demo:balance --yes        # makes it (funding currency EUR; override with --via GBP)
 */
import { z } from "zod";

import { DEMO_CURRENCY, DEMO_STARTING_AVAILABLE_MINOR, usd } from "@/lib/demo/scenario";
import { getAirwallexConfig, readServerEnv } from "@/lib/env";
import { formatMoney, minorToDecimalString } from "@/lib/money";
import { fetchCurrentBalances } from "@/server/airwallex/balances";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";

const args = process.argv.slice(2);
const execute = args.includes("--yes");
const viaIndex = args.indexOf("--via");
const via = (viaIndex >= 0 ? args[viaIndex + 1] : "EUR")?.toUpperCase() ?? "EUR";

const conversionSchema = z
  .object({
    conversion_id: z.string().nullish(),
    id: z.string().nullish(),
    status: z.string().nullish(),
    buy_currency: z.string().nullish(),
    buy_amount: z.union([z.number(), z.string()]).nullish(),
    sell_currency: z.string().nullish(),
    sell_amount: z.union([z.number(), z.string()]).nullish(),
  })
  .loose();

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const config = getAirwallexConfig();
if (!config.ok) fail(config.message);
if (config.environment !== "sandbox" || !readServerEnv().AIRWALLEX_SANDBOX_ONLY) {
  fail("Refusing to run: this helper only works against Airwallex Sandbox with AIRWALLEX_SANDBOX_ONLY on.");
}
if (!/^[A-Z]{3}$/.test(via) || via === DEMO_CURRENCY) fail(`--via must be another currency code, not ${via}.`);

const client = getAirwallexClient();

async function availableOf(currency: string) {
  const { balances } = await fetchCurrentBalances(client);
  const balance = balances.find((row) => row.currency === currency);
  return balance?.availableMinor ?? null;
}

try {
  const available = await availableOf(DEMO_CURRENCY);
  if (available === null) fail("Airwallex reports no USD available balance.");
  const difference = DEMO_STARTING_AVAILABLE_MINOR - available;
  console.log(`USD available now: ${usd(available)}; demo starts from ${usd(DEMO_STARTING_AVAILABLE_MINOR)}.`);
  if (difference === 0n) {
    console.log("✓ Already exact. Nothing to do.");
    process.exit(0);
  }

  const amount = minorToDecimalString(difference < 0n ? -difference : difference, 2);
  // Too little USD: buy exactly the shortfall. Too much: sell exactly the excess.
  const body =
    difference > 0n
      ? { buy_currency: DEMO_CURRENCY, buy_amount: amount, sell_currency: via }
      : { sell_currency: DEMO_CURRENCY, sell_amount: amount, buy_currency: via };
  const plan =
    difference > 0n ? `buy ${usd(difference)} with ${via}` : `sell ${usd(-difference)} for ${via}`;

  if (!execute) {
    console.log(`Dry run: would ${plan} (sandbox conversion). Run again with --yes to do it.`);
    process.exit(0);
  }

  const requestId = `ledgistry-demo-balance-${crypto.randomUUID().replaceAll("-", "")}`;
  const { data } = await client.request("/api/v1/fx/conversions/create", {
    method: "POST",
    body: { request_id: requestId, ...body },
    schema: conversionSchema,
    timeoutMs: 30_000,
  });
  console.log(
    `Converted: ${data.sell_amount ?? "?"} ${data.sell_currency ?? ""} → ${data.buy_amount ?? "?"} ${data.buy_currency ?? ""} (${
      data.status ?? "status unknown"
    }, request ${requestId}).`,
  );

  const after = await availableOf(DEMO_CURRENCY);
  const fundingAfter = await availableOf(via);
  console.log(
    `USD available now: ${after === null ? "unavailable" : usd(after)}${
      fundingAfter === null ? "" : `; ${via} available ${formatMoney(fundingAfter, via, 2)}`
    }.`,
  );
  if (after !== DEMO_STARTING_AVAILABLE_MINOR) {
    console.log("! Not exact yet: the conversion may still be settling. Run the dry run again in a moment.");
  }
} catch (error) {
  fail(error instanceof AirwallexError ? error.safeMessage : "Unexpected error.");
}
