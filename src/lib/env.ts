import "server-only";

import { z } from "zod";

import { isOperatorAllowed, parseOperatorAllowlist } from "@/lib/auth/operator-allowlist";

/** Exact Airwallex hosts. Anything else is rejected outright. */
export const AIRWALLEX_HOSTS = {
  sandbox: "https://api.sandbox.airwallex.com",
  production: "https://api.airwallex.com",
} as const;

const DEFAULT_AIRWALLEX_API_VERSION = "2026-08-21";

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const serverEnvSchema = z.object({
  APP_MODE: z.enum(["development", "preview", "production", "test"]).default("development"),
  AIRWALLEX_BASE_URL: z
    .string()
    .trim()
    .default(AIRWALLEX_HOSTS.sandbox)
    .transform((url) => url.replace(/\/+$/, "")),
  AIRWALLEX_CLIENT_ID: optionalSecret,
  // The PRD name is AIRWALLEX_API_KEY; cloud sessions provide AIRWALLEX_SECRET.
  AIRWALLEX_API_KEY: optionalSecret,
  AIRWALLEX_SECRET: optionalSecret,
  AIRWALLEX_SANDBOX_ONLY: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AIRWALLEX_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "AIRWALLEX_API_VERSION must look like 2026-08-21")
    .default(DEFAULT_AIRWALLEX_API_VERSION),
  // Optional comma-separated allowlist of operator emails permitted into the workspace.
  LEDGISTRY_OPERATOR_EMAILS: z.string().optional().transform(parseOperatorAllowlist),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid server environment configuration — ${issues.join("; ")}`);
  }
  return parsed.data;
}

export type AirwallexConfig =
  | {
      ok: true;
      baseUrl: string;
      environment: "sandbox" | "production";
      clientId: string;
      apiKey: string;
      apiVersion: string;
    }
  | {
      ok: false;
      reason: "missing_credentials" | "host_not_allowed";
      message: string;
      baseUrl: string;
    };

/**
 * Resolves Airwallex configuration without throwing so the UI can show a truthful setup state.
 * Sandbox-only mode (the MVP default) refuses any host other than the sandbox.
 */
export function getAirwallexConfig(env: ServerEnv = readServerEnv()): AirwallexConfig {
  const baseUrl = env.AIRWALLEX_BASE_URL;
  const environment =
    baseUrl === AIRWALLEX_HOSTS.sandbox
      ? "sandbox"
      : baseUrl === AIRWALLEX_HOSTS.production
        ? "production"
        : null;

  if (!environment) {
    return {
      ok: false,
      reason: "host_not_allowed",
      baseUrl,
      message: `AIRWALLEX_BASE_URL must be exactly ${AIRWALLEX_HOSTS.sandbox}.`,
    };
  }
  if (env.AIRWALLEX_SANDBOX_ONLY && environment !== "sandbox") {
    return {
      ok: false,
      reason: "host_not_allowed",
      baseUrl,
      message: "Sandbox-only mode is enabled, so production Airwallex hosts are refused.",
    };
  }

  const apiKey = env.AIRWALLEX_API_KEY ?? env.AIRWALLEX_SECRET;
  if (!env.AIRWALLEX_CLIENT_ID || !apiKey) {
    return {
      ok: false,
      reason: "missing_credentials",
      baseUrl,
      message: "Set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY on the server to connect Airwallex.",
    };
  }

  return {
    ok: true,
    baseUrl,
    environment,
    clientId: env.AIRWALLEX_CLIENT_ID,
    apiKey,
    apiVersion: env.AIRWALLEX_API_VERSION,
  };
}

export function isOperatorEmailAllowed(
  email: string | null | undefined,
  env: ServerEnv = readServerEnv(),
): boolean {
  return isOperatorAllowed(email, env.LEDGISTRY_OPERATOR_EMAILS);
}
