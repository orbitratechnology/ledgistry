import { describe, expect, it } from "vitest";

import { isOperatorAllowed, parseOperatorAllowlist } from "./auth/operator-allowlist";
import { AIRWALLEX_HOSTS, getAirwallexConfig, readServerEnv } from "./env";

const creds = { AIRWALLEX_CLIENT_ID: "client", AIRWALLEX_API_KEY: "key" };
const config = (env: Record<string, string>) => getAirwallexConfig(readServerEnv(env));

describe("getAirwallexConfig", () => {
  it("defaults to the sandbox host with the pinned API version", () => {
    const result = config(creds);
    expect(result).toMatchObject({
      ok: true,
      environment: "sandbox",
      baseUrl: AIRWALLEX_HOSTS.sandbox,
      apiVersion: "2026-08-21",
    });
  });

  it("accepts AIRWALLEX_SECRET as the API key name", () => {
    const result = config({ AIRWALLEX_CLIENT_ID: "client", AIRWALLEX_SECRET: "secret" });
    expect(result.ok && result.apiKey).toBe("secret");
  });

  it("reports missing credentials instead of pretending to be connected", () => {
    expect(config({})).toMatchObject({ ok: false, reason: "missing_credentials" });
    expect(config({ AIRWALLEX_CLIENT_ID: "client", AIRWALLEX_API_KEY: "  " })).toMatchObject({
      ok: false,
      reason: "missing_credentials",
    });
  });

  it("refuses the production host while sandbox-only mode is on (the default)", () => {
    expect(config({ ...creds, AIRWALLEX_BASE_URL: AIRWALLEX_HOSTS.production })).toMatchObject({
      ok: false,
      reason: "host_not_allowed",
    });
  });

  it("allows production only when sandbox-only mode is explicitly disabled", () => {
    expect(
      config({
        ...creds,
        AIRWALLEX_BASE_URL: AIRWALLEX_HOSTS.production,
        AIRWALLEX_SANDBOX_ONLY: "false",
      }),
    ).toMatchObject({ ok: true, environment: "production" });
  });

  it("rejects look-alike hosts exactly", () => {
    for (const host of [
      "https://api.sandbox.airwallex.com.evil.test",
      "http://api.sandbox.airwallex.com",
      "https://sandbox.airwallex.com",
    ]) {
      expect(config({ ...creds, AIRWALLEX_BASE_URL: host })).toMatchObject({
        ok: false,
        reason: "host_not_allowed",
      });
    }
  });

  it("normalises a trailing slash on the sandbox host", () => {
    expect(config({ ...creds, AIRWALLEX_BASE_URL: `${AIRWALLEX_HOSTS.sandbox}/` })).toMatchObject({
      ok: true,
    });
  });

  it("validates the API version format", () => {
    expect(() => readServerEnv({ ...creds, AIRWALLEX_API_VERSION: "latest" })).toThrow(
      /AIRWALLEX_API_VERSION/,
    );
  });
});

describe("operator allowlist", () => {
  it("admits anyone when unset", () => {
    expect(isOperatorAllowed("anyone@example.com", parseOperatorAllowlist(undefined))).toBe(true);
  });

  it("matches case-insensitively and trims entries", () => {
    const allowlist = parseOperatorAllowlist(" Ops@Example.com , cfo@example.com,");
    expect(allowlist).toEqual(["ops@example.com", "cfo@example.com"]);
    expect(isOperatorAllowed("OPS@example.com", allowlist)).toBe(true);
    expect(isOperatorAllowed("intruder@example.com", allowlist)).toBe(false);
    expect(isOperatorAllowed(null, allowlist)).toBe(false);
  });
});
