import { describe, expect, it } from "vitest";

import { canTransition, mapProviderStatus } from "./status";

describe("mapProviderStatus", () => {
  it("shows Completed only for a PAID transfer", () => {
    expect(mapProviderStatus("PAID")).toBe("completed");
    for (const status of ["SCHEDULED", "PROCESSING", "SENT", "IN_APPROVAL", "OVERDUE"]) {
      expect(mapProviderStatus(status)).toBe("pending");
    }
  });

  it("maps failures and cancellations, and never guesses an unknown status", () => {
    expect(mapProviderStatus("FAILED")).toBe("failed");
    expect(mapProviderStatus("cancelled")).toBe("cancelled");
    expect(mapProviderStatus("APPROVAL_REJECTED")).toBe("cancelled");
    expect(mapProviderStatus("COMPLETED")).toBe("unknown");
    expect(mapProviderStatus("")).toBe("unknown");
    expect(mapProviderStatus(null)).toBe("unknown");
  });
});

describe("canTransition", () => {
  it("lets a lost response be resolved, but not a cancelled payment reopen", () => {
    expect(canTransition("prepared", "verification_required")).toBe(true);
    expect(canTransition("verification_required", "completed")).toBe(true);
    expect(canTransition("cancelled", "pending")).toBe(false);
  });

  it("keeps a PAID transfer open to a later provider failure, as Airwallex documents", () => {
    expect(canTransition("completed", "failed")).toBe(true);
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("failed", "cancelled")).toBe(true);
    expect(canTransition("failed", "completed")).toBe(false);
  });
});
