import "server-only";

export type AirwallexErrorKind =
  | "missing_credentials"
  | "host_not_allowed"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "unexpected_response";

const OPERATOR_MESSAGES: Record<AirwallexErrorKind, string> = {
  missing_credentials: "Airwallex credentials are not configured on the server.",
  host_not_allowed: "The configured Airwallex host is not allowed in sandbox-only mode.",
  invalid_credentials: "Airwallex rejected the client ID or API key. Check the sandbox credentials.",
  forbidden: "The Airwallex API key is missing a required permission (scope) for this request.",
  not_found: "Airwallex could not find the requested resource.",
  bad_request: "Airwallex rejected the request as invalid.",
  rate_limited: "Airwallex is rate limiting requests. Wait a moment and try again.",
  timeout: "Airwallex did not respond in time. Try again shortly.",
  unavailable: "Airwallex Sandbox is temporarily unavailable. Try again shortly.",
  unexpected_response: "Airwallex returned a response Ledgistry could not read safely.",
};

/** Provider failure with an operator-safe message. Raw provider bodies stay server-side. */
export class AirwallexError extends Error {
  readonly kind: AirwallexErrorKind;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly correlationId: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    kind: AirwallexErrorKind,
    options: {
      status?: number | null;
      providerCode?: string | null;
      correlationId?: string | null;
      retryAfterMs?: number | null;
      detail?: string;
      cause?: unknown;
    } = {},
  ) {
    super(options.detail ?? OPERATOR_MESSAGES[kind], { cause: options.cause });
    this.name = "AirwallexError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.providerCode = options.providerCode ?? null;
    this.correlationId = options.correlationId ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  /** Message that is safe to show in the UI and store in audit/sync records. */
  get safeMessage(): string {
    return OPERATOR_MESSAGES[this.kind];
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "unavailable";
  }
}

export function kindFromStatus(status: number): AirwallexErrorKind {
  if (status === 401) return "invalid_credentials";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "bad_request";
}

export function operatorMessageFor(kind: AirwallexErrorKind): string {
  return OPERATOR_MESSAGES[kind];
}
