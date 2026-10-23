"use server";

import { refresh } from "next/cache";

import { requireWorkspace } from "@/server/auth/session";

/** Re-runs the live connection check by re-rendering the Settings page. */
export async function recheckConnectionAction(): Promise<void> {
  await requireWorkspace();
  refresh();
}
