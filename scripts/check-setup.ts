/**
 * Read-only setup check: configuration, Airwallex Sandbox access, the demo prerequisites,
 * Supabase reachability and AI settings. Prints statuses only, never key values.
 *
 *   bun run setup:check
 */
import { DEMO_BENEFICIARY_LABEL, DEMO_CURRENCY, DEMO_STARTING_AVAILABLE_MINOR, usd } from "@/lib/demo/scenario";
import { getAirwallexConfig, getAnthropicConfig, readServerEnv } from "@/lib/env";
import { listBeneficiaries } from "@/server/airwallex/beneficiaries";
import { fetchCurrentBalances } from "@/server/airwallex/balances";
import { getAirwallexClient } from "@/server/airwallex/client";
import { AirwallexError } from "@/server/airwallex/errors";
import { listGlobalAccounts } from "@/server/airwallex/global-accounts";

type Level = "ok" | "warn" | "fail";
const MARK: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
let failed = false;

function report(level: Level, label: string, detail: string) {
  if (level === "fail") failed = true;
  console.log(`${MARK[level]} ${label.padEnd(30)} ${detail}`);
}

function providerMessage(error: unknown) {
  return error instanceof AirwallexError ? error.safeMessage : "Unexpected error.";
}

console.log("Ledgistry setup check (read-only)\n");

// Configuration ---------------------------------------------------------------------------
const env = readServerEnv();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
report(
  supabaseUrl && supabaseKey ? "ok" : "fail",
  "Supabase configuration",
  supabaseUrl && supabaseKey ? new URL(supabaseUrl).host : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
);
const airwallex = getAirwallexConfig(env);
report(
  airwallex.ok ? "ok" : "fail",
  "Airwallex configuration",
  airwallex.ok ? `${new URL(airwallex.baseUrl).host} (${airwallex.environment}, API ${airwallex.apiVersion})` : airwallex.message,
);
report(env.AIRWALLEX_SANDBOX_ONLY ? "ok" : "warn", "Sandbox-only guard", env.AIRWALLEX_SANDBOX_ONLY ? "On" : "Off: only sandbox is supported in this MVP.");
const ai = getAnthropicConfig(env);
report(ai.ok ? "ok" : "warn", "AI assistance", ai.ok ? `Model ${ai.modelId}` : `${ai.message} Everything else still works.`);
report(
  "ok",
  "Operator access",
  env.LEDGISTRY_OPERATOR_EMAILS.length > 0 ? `Allowlist of ${env.LEDGISTRY_OPERATOR_EMAILS.length}` : "Any account in Supabase Auth (disable public sign-ups).",
);

// Supabase ----------------------------------------------------------------------------------
if (supabaseUrl && supabaseKey) {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseKey },
      signal: AbortSignal.timeout(10_000),
    });
    report(response.ok ? "ok" : "fail", "Supabase Auth reachable", response.ok ? "Healthy" : `HTTP ${response.status}`);
  } catch {
    report("fail", "Supabase Auth reachable", "No response within 10 s.");
  }
}

// Airwallex Sandbox ---------------------------------------------------------------------------
if (airwallex.ok) {
  const client = getAirwallexClient();
  try {
    await client.verifyCredentials();
    report("ok", "Airwallex authentication", "Token issued.");

    const balances = await fetchCurrentBalances(client).catch((error: unknown) => {
      report("fail", "Balances read", providerMessage(error));
      return null;
    });
    if (balances) {
      const usdBalance = balances.balances.find((balance) => balance.currency === DEMO_CURRENCY);
      const available = usdBalance?.availableMinor ?? null;
      report(
        available === DEMO_STARTING_AVAILABLE_MINOR ? "ok" : "warn",
        "Demo starting balance",
        available === null
          ? "Airwallex reports no USD balance."
          : available === DEMO_STARTING_AVAILABLE_MINOR
            ? `${usd(available)} available, as the demo expects.`
            : `${usd(available)} available; the demo expects ${usd(DEMO_STARTING_AVAILABLE_MINOR)}. Run "bun run demo:balance".`,
      );
    }

    const accounts = await listGlobalAccounts(client).catch(() => null);
    const usdAccount = accounts?.find((account) => account.baseCurrency === DEMO_CURRENCY);
    report(
      usdAccount?.status?.toUpperCase() === "ACTIVE" ? "ok" : "warn",
      "USD Global Account",
      accounts === null
        ? "Could not list Global Accounts."
        : usdAccount
          ? `${usdAccount.label} (${usdAccount.status?.toLowerCase() ?? "status unknown"})`
          : "None: the simulated USD deposit needs one.",
    );

    const beneficiaries = await listBeneficiaries(client).catch(() => null);
    const usdLocal = beneficiaries?.filter((beneficiary) => beneficiary.currency === DEMO_CURRENCY && beneficiary.transferMethods.includes("LOCAL"));
    const preferred = usdLocal?.find((beneficiary) => beneficiary.label === DEMO_BENEFICIARY_LABEL) ?? usdLocal?.[0];
    report(
      preferred ? "ok" : "warn",
      "USD beneficiary (LOCAL)",
      beneficiaries === null ? "Could not list beneficiaries." : preferred ? preferred.label : "None: sample payments need one.",
    );
  } catch (error) {
    report("fail", "Airwallex authentication", providerMessage(error));
  }
}

console.log(failed ? "\nSome required checks failed." : "\nRequired checks passed.");
process.exit(failed ? 1 : 0);
