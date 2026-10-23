import { describe, expect, it } from "vitest";

import { TokenProvider } from "./auth";
import { AirwallexError } from "./errors";
import { json, loginOk, scriptedFetch, testConfig } from "./test-helpers";

const provider = (fetchImpl: ReturnType<typeof scriptedFetch>["fetchImpl"], now = () => 0) =>
  new TokenProvider({
    baseUrl: testConfig.baseUrl,
    clientId: testConfig.clientId,
    apiKey: testConfig.apiKey,
    fetchImpl,
    now,
  });

describe("TokenProvider", () => {
  it("logs in with client id + api key headers and reuses the token until near expiry", async () => {
    const { fetchImpl, calls } = scriptedFetch(() => loginOk("2026-10-23T10:30:00+0000"));
    let now = Date.parse("2026-10-23T10:00:00Z");
    const tokens = provider(fetchImpl, () => now);

    expect(await tokens.getToken()).toBe("token-1");
    expect(await tokens.getToken()).toBe("token-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${testConfig.baseUrl}/api/v1/authentication/login`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-client-id"]).toBe("client-id");
    expect(headers["x-api-key"]).toBe("super-secret-key");

    // Within the 60s refresh skew of expires_at → logs in again.
    now = Date.parse("2026-10-23T10:29:30Z");
    await tokens.getToken();
    expect(calls).toHaveLength(2);
  });

  it("coalesces concurrent refreshes into a single login", async () => {
    const { fetchImpl, calls } = scriptedFetch(() => loginOk());
    const tokens = provider(fetchImpl);
    const results = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);
    expect(results).toEqual(["token-1", "token-1", "token-1"]);
    expect(calls).toHaveLength(1);
  });

  it("forgets an invalidated token", async () => {
    const { fetchImpl, calls } = scriptedFetch(
      () => loginOk(undefined, "token-1"),
      () => loginOk(undefined, "token-2"),
    );
    const tokens = provider(fetchImpl);
    expect(await tokens.getToken()).toBe("token-1");
    tokens.invalidate("token-1");
    expect(await tokens.getToken()).toBe("token-2");
    expect(calls).toHaveLength(2);
  });

  it("maps rejected credentials to invalid_credentials", async () => {
    const { fetchImpl } = scriptedFetch(() => json(401, { code: "credentials_invalid" }));
    await expect(provider(fetchImpl).getToken()).rejects.toMatchObject({
      kind: "invalid_credentials",
      providerCode: "credentials_invalid",
    });
  });

  it("treats a malformed login response as unexpected", async () => {
    const { fetchImpl } = scriptedFetch(() => json(201, { token: "x", expires_at: "soon" }));
    const error = await provider(fetchImpl).getToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AirwallexError);
    expect((error as AirwallexError).kind).toBe("unexpected_response");
  });
});
