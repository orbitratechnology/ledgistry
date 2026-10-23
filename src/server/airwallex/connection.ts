import "server-only";

import { getAirwallexConfig } from "@/lib/env";
import { fetchCurrentBalances } from "./balances";
import { getAirwallexClient } from "./client";
import { AirwallexError } from "./errors";

export type ConnectionState =
  | "connected"
  | "missing_credentials"
  | "invalid_credentials"
  | "missing_scope"
  | "host_not_allowed"
  | "unavailable";

export type ConnectionStatus = {
  state: ConnectionState;
  environment: "sandbox" | "production" | null;
  baseUrl: string;
  apiVersion: string | null;
  message: string;
  checkedAt: string;
};

const CONNECTED_MESSAGE = "Authenticated with Airwallex Sandbox.";

function stateFromError(error: AirwallexError): ConnectionState {
  switch (error.kind) {
    case "missing_credentials":
    case "host_not_allowed":
    case "invalid_credentials":
      return error.kind;
    case "forbidden":
      return "missing_scope";
    default:
      return "unavailable";
  }
}

/**
 * Truthful connection check: authenticates (reusing the cached token when valid) and, when
 * `verifyScope` is set, also reads balances to confirm the key has the permission Ledgistry needs.
 */
export async function checkAirwallexConnection(
  { verifyScope = false }: { verifyScope?: boolean } = {},
): Promise<ConnectionStatus> {
  const config = getAirwallexConfig();
  const base = {
    environment: config.ok ? config.environment : null,
    baseUrl: config.baseUrl,
    apiVersion: config.ok ? config.apiVersion : null,
    checkedAt: new Date().toISOString(),
  };

  try {
    const client = getAirwallexClient();
    if (verifyScope) {
      await fetchCurrentBalances(client);
    } else {
      await client.verifyCredentials();
    }
    return { ...base, state: "connected", message: CONNECTED_MESSAGE };
  } catch (error) {
    if (!(error instanceof AirwallexError)) throw error;
    return {
      ...base,
      state: stateFromError(error),
      message:
        error.kind === "missing_credentials" || error.kind === "host_not_allowed"
          ? error.message
          : error.safeMessage,
    };
  }
}
