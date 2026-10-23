import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AirwallexClient } from "./client";
import { AirwallexError } from "./errors";
import { json, loginOk, scriptedFetch, testConfig, type RecordedCall } from "./test-helpers";

const schema = z.object({ ok: z.boolean() });
const isLogin = (call: RecordedCall) => call.url.endsWith("/authentication/login");

function makeClient(responders: Parameters<typeof scriptedFetch>) {
  const scripted = scriptedFetch(...responders);
  const sleeps: number[] = [];
  const client = new AirwallexClient({
    config: testConfig,
    fetchImpl: scripted.fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls: scripted.calls, sleeps };
}

describe("AirwallexClient.request", () => {
  it("sends the bearer token and pinned API version, and validates the body", async () => {
    const { client, calls } = makeClient([() => loginOk(), () => json(200, { ok: true })]);
    const result = await client.request("/api/v1/balances/current", { schema });

    expect(result.data).toEqual({ ok: true });
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-1");
    expect(headers["x-api-version"]).toBe("2026-08-21");
    expect(calls[1].init?.method).toBe("GET");
  });

  it("retries safe reads on 503 with backoff, then succeeds", async () => {
    const { client, calls, sleeps } = makeClient([
      () => loginOk(),
      () => json(503, { code: "service_unavailable" }),
      () => json(200, { ok: true }),
    ]);
    await expect(client.request("/x", { schema })).resolves.toMatchObject({ data: { ok: true } });
    expect(calls.filter((call) => !isLogin(call))).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
  });

  it("honours Retry-After on 429", async () => {
    const { client, sleeps } = makeClient([
      () => loginOk(),
      () => json(429, { code: "too_many_requests" }, { "retry-after": "2" }),
      () => json(200, { ok: true }),
    ]);
    await client.request("/x", { schema });
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after the bounded number of read retries", async () => {
    const { client, calls } = makeClient([() => loginOk(), () => json(500, {})]);
    await expect(client.request("/x", { schema })).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls.filter((call) => !isLogin(call))).toHaveLength(3); // 1 + 2 retries
  });

  it("never retries POST requests automatically", async () => {
    const { client, calls } = makeClient([() => loginOk(), () => json(503, {})]);
    await expect(
      client.request("/api/v1/transfers/create", { method: "POST", body: {}, schema }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls.filter((call) => !isLogin(call))).toHaveLength(1);
  });

  it("re-authenticates once when a cached token is rejected", async () => {
    const { client, calls } = makeClient([
      () => loginOk(undefined, "token-1"),
      () => json(401, { code: "credentials_expired" }),
      () => loginOk(undefined, "token-2"),
      () => json(200, { ok: true }),
    ]);
    await client.request("/x", { schema });
    const last = calls.at(-1)?.init?.headers as Record<string, string>;
    expect(last.authorization).toBe("Bearer token-2");
    expect(calls.filter(isLogin)).toHaveLength(2);
  });

  it("maps 403 to a missing-scope (forbidden) error without retrying", async () => {
    const { client, calls } = makeClient([() => loginOk(), () => json(403, { code: "forbidden" })]);
    await expect(client.request("/x", { schema })).rejects.toMatchObject({ kind: "forbidden" });
    expect(calls).toHaveLength(2);
  });

  it("maps timeouts to a retryable timeout error", async () => {
    const { client } = makeClient([
      () => loginOk(),
      () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    ]);
    await expect(client.request("/x", { schema })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("fails safely when the provider response does not match the schema", async () => {
    const { client } = makeClient([() => loginOk(), () => json(200, { unexpected: true })]);
    await expect(client.request("/x", { schema })).rejects.toMatchObject({
      kind: "unexpected_response",
    });
  });

  it("never exposes credentials in error messages", async () => {
    const { client } = makeClient([() => json(401, { code: "credentials_invalid" })]);
    const error = (await client.request("/x", { schema }).catch((e: unknown) => e)) as AirwallexError;
    expect(error).toBeInstanceOf(AirwallexError);
    expect(`${error.message} ${error.safeMessage}`).not.toContain(testConfig.apiKey);
    expect(`${error.message} ${error.safeMessage}`).not.toContain(testConfig.clientId);
  });
});
