import "server-only";

import { z } from "zod";

import { AirwallexError } from "./errors";
import { sendRequest, type FetchLike } from "./http";

const loginResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1),
});

type CachedToken = { token: string; expiresAtMs: number };

export type TokenProviderOptions = {
  baseUrl: string;
  clientId: string;
  apiKey: string;
  fetchImpl: FetchLike;
  now?: () => number;
  /** Refresh this long before `expires_at` so in-flight requests never carry a dying token. */
  refreshSkewMs?: number;
  timeoutMs?: number;
};

/**
 * Server-only Airwallex access-token cache. Logs in once, reuses the token until it is
 * within `refreshSkewMs` of `expires_at`, and coalesces concurrent refreshes into one login.
 */
export class TokenProvider {
  private cached: CachedToken | null = null;
  private inflight: Promise<CachedToken> | null = null;
  private readonly now: () => number;
  private readonly refreshSkewMs: number;

  constructor(private readonly options: TokenProviderOptions) {
    this.now = options.now ?? Date.now;
    this.refreshSkewMs = options.refreshSkewMs ?? 60_000;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAtMs - this.refreshSkewMs > this.now()) {
      return this.cached.token;
    }
    this.inflight ??= this.login().finally(() => {
      this.inflight = null;
    });
    const fresh = await this.inflight;
    return fresh.token;
  }

  /** Drops the cached token if it is the one that was just rejected. */
  invalidate(token: string): void {
    if (this.cached?.token === token) this.cached = null;
  }

  private async login(): Promise<CachedToken> {
    const { body, correlationId } = await sendRequest(
      this.options.fetchImpl,
      `${this.options.baseUrl}/api/v1/authentication/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-id": this.options.clientId,
          "x-api-key": this.options.apiKey,
        },
        timeoutMs: this.options.timeoutMs ?? 10_000,
      },
    );

    const parsed = loginResponseSchema.safeParse(body);
    const expiresAtMs = parsed.success ? Date.parse(parsed.data.expires_at) : Number.NaN;
    if (!parsed.success || Number.isNaN(expiresAtMs)) {
      throw new AirwallexError("unexpected_response", { correlationId });
    }

    this.cached = { token: parsed.data.token, expiresAtMs };
    return this.cached;
  }
}
