import type { FetchLike } from "./http";

export type RecordedCall = { url: string; init: RequestInit | undefined };

type Responder = (call: RecordedCall, index: number) => Response | Promise<Response>;

/** Scripted fetch: each call consumes the next responder (the last one repeats). */
export function scriptedFetch(...responders: Responder[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    return responder(call, calls.length - 1);
  };
  return { fetchImpl, calls };
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const loginOk = (expiresAt = "2099-01-01T00:00:00+0000", token = "token-1") =>
  json(201, { token, expires_at: expiresAt });

export const testConfig = {
  ok: true as const,
  baseUrl: "https://api.sandbox.airwallex.com",
  environment: "sandbox" as const,
  clientId: "client-id",
  apiKey: "super-secret-key",
  apiVersion: "2026-08-21",
};
