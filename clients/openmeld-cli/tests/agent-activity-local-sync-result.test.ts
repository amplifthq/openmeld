import { describe, expect, it } from "vitest";
import { resolveCombinedAgentActivitySyncStatus } from "../src/agent-activity/local-sync";

describe("resolveCombinedAgentActivitySyncStatus", () => {
  it("reports unavailable when Session Inventory fails after Activity submits", () => {
    expect(
      resolveCombinedAgentActivitySyncStatus({
        activityStatus: "submitted",
        sessionInventoryStatus: "unavailable",
      })
    ).toBe("unavailable");
  });

  it("reports submitted when either successful lane submitted work", () => {
    expect(
      resolveCombinedAgentActivitySyncStatus({
        activityStatus: "idle",
        sessionInventoryStatus: "submitted",
      })
    ).toBe("submitted");
  });

  it("reports unavailable when Activity fails after Session Inventory submits", () => {
    expect(
      resolveCombinedAgentActivitySyncStatus({
        activityStatus: "unavailable",
        sessionInventoryStatus: "submitted",
      })
    ).toBe("unavailable");
  });
});
