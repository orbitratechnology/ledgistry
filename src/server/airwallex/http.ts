import "server-only";

import { AirwallexError, kindFromStatus } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RawResponse = {
  status: number;
  body: unknown;
  correlationId: string | null;
  retryAfterMs: number | null;
};

const CORRELATION_HEADERS = ["x-awx-traceid", "x-b3-traceid", "x-request-id"];

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * One HTTP exchange with Airwallex: explicit timeout, JSON parsing, and mapping of
 * transport failures to typed errors. No retries here — see client.ts.
 */
export async function sendRequest(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<RawResponse> {
  const { timeoutMs, ...requestInit } = init;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...requestInit,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AirwallexError("timeout", { cause });
    }
    throw new AirwallexError("unavailable", { cause });
  }

  const correlationId =
    CORRELATION_HEADERS.map((header) => response.headers.get(header)).find(Boolean) ?? null;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (cause) {
      if (response.ok) {
        throw new AirwallexError("unexpected_response", {
          status: response.status,
          correlationId,
          cause,
        });
      }
    }
  }

  if (!response.ok) {
    const providerCode =
      body && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : null;
    throw new AirwallexError(kindFromStatus(response.status), {
      status: response.status,
      providerCode,
      correlationId,
      retryAfterMs,
    });
  }

  return { status: response.status, body, correlationId, retryAfterMs };
}
