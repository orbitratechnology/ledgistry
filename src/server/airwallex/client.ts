import "server-only";

import type { z } from "zod";

import { getAirwallexConfig, type AirwallexConfig } from "@/lib/env";
import { TokenProvider } from "./auth";
import { AirwallexError } from "./errors";
import { sendRequest, type FetchLike } from "./http";

type RequestOptions<Schema extends z.ZodType> = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  schema: Schema;
  timeoutMs?: number;
};

export type AirwallexResult<T> = { data: T; correlationId: string | null };

type ClientOptions = {
  config: Extract<AirwallexConfig, { ok: true }>;
  fetchImpl?: FetchLike;
  tokens?: TokenProvider;
  sleep?: (ms: number) => Promise<void>;
  maxReadRetries?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class AirwallexClient {
  readonly config: ClientOptions["config"];
  private readonly fetchImpl: FetchLike;
  private readonly tokens: TokenProvider;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxReadRetries: number;

  constructor(options: ClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokens =
      options.tokens ??
      new TokenProvider({
        baseUrl: options.config.baseUrl,
        clientId: options.config.clientId,
        apiKey: options.config.apiKey,
        fetchImpl: this.fetchImpl,
      });
    this.sleep = options.sleep ?? defaultSleep;
    this.maxReadRetries = options.maxReadRetries ?? 2;
  }

  /** Authenticates (or reuses the cached token) without calling any other endpoint. */
  async verifyCredentials(): Promise<void> {
    await this.tokens.getToken();
  }

  /**
   * Calls an Airwallex endpoint and validates the response. GET requests are retried on
   * rate limits, timeouts and 5xx; POST requests are never retried automatically, because
   * money-moving calls must be resolved by request_id instead (PRD §8.7).
   */
  async request<Schema extends z.ZodType>(
    path: string,
    { method = "GET", query, body, schema, timeoutMs = 15_000 }: RequestOptions<Schema>,
  ): Promise<AirwallexResult<z.infer<Schema>>> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const isSafeRead = method === "GET";
    let attempt = 0;
    let reauthenticated = false;

    for (;;) {
      let token: string | undefined;
      try {
        token = await this.tokens.getToken();
        const response = await sendRequest(this.fetchImpl, url.toString(), {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-api-version": this.config.apiVersion,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          timeoutMs,
        });

        const parsed = schema.safeParse(response.body);
        if (!parsed.success) {
          throw new AirwallexError("unexpected_response", {
            status: response.status,
            correlationId: response.correlationId,
            cause: parsed.error,
          });
        }
        return { data: parsed.data, correlationId: response.correlationId };
      } catch (error) {
        if (!(error instanceof AirwallexError)) throw error;

        // The API rejected a cached token (not the login itself): log in again once, reads only.
        if (
          error.kind === "invalid_credentials" &&
          token !== undefined &&
          isSafeRead &&
          !reauthenticated
        ) {
          this.tokens.invalidate(token);
          reauthenticated = true;
          continue;
        }

        if (isSafeRead && error.retryable && attempt < this.maxReadRetries) {
          attempt += 1;
          const backoff = 300 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
          await this.sleep(Math.min(error.retryAfterMs ?? backoff, 5_000));
          continue;
        }
        throw error;
      }
    }
  }
}

let shared: { key: string; client: AirwallexClient } | null = null;

/**
 * Process-wide client, so the access token is reused across requests.
 * Throws a typed AirwallexError when configuration is missing or the host is not allowed.
 */
export function getAirwallexClient(): AirwallexClient {
  const config = getAirwallexConfig();
  if (!config.ok) {
    throw new AirwallexError(config.reason, { detail: config.message });
  }
  const key = `${config.baseUrl}|${config.clientId}|${config.apiVersion}`;
  if (shared?.key !== key) {
    shared = { key, client: new AirwallexClient({ config }) };
  }
  return shared.client;
}
