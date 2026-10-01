import { describe, expect, it, vi } from "vitest";
import { probeCursorUsageLimits } from "../src/local-service/inventory/cursor-usage-probe";

const observedAt = "2026-10-01T08:00:00Z";

describe("Cursor account usage", () => {
  it("uses native dashboard percentages and never exposes the login token", async () => {
    // T3 Code's CursorUsageResponse contract, pinned to
    // 0cf482b08bca0249ec94fbcbd0eb04fff28d9b3d. BillingCycleEnd is milliseconds.
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        billingCycleEnd: "1790812800000",
        planUsage: {
          totalPercentUsed: 125,
          autoPercentUsed: 40,
          apiPercentUsed: 0,
        },
      })
    );
    const readKeychain = vi.fn().mockResolvedValue("local-secret");
    const limits = await probeCursorUsageLimits({
      observedAt,
      environment: {},
      platform: "darwin",
      fetchFn,
      readKeychain,
    });
    expect(limits.map((limit) => limit.usedPercent)).toEqual([100, 40, 0]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
      expect.objectContaining({
        redirect: "error",
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          authorization: "Bearer local-secret",
          "connect-protocol-version": "1",
          "x-cursor-client-type": "cli",
        }),
      })
    );
    expect(JSON.stringify(limits)).not.toContain("local-secret");
  });

  it.each([
    { CURSOR_API_KEY: "another-account" },
    { AGENT_CLI_CREDENTIAL_STORE: "memory" },
    {
      CURSOR_API_ENDPOINT: "https://proxy.example.com",
      CURSOR_AUTH_TOKEN: "explicit-secret",
    },
  ])("does not read or send a stored token with an incompatible configuration: %j", async (environment) => {
    const fetchFn = vi.fn();
    const readKeychain = vi.fn();
    const limits = await probeCursorUsageLimits({
      observedAt,
      environment,
      platform: "darwin",
      fetchFn,
      readKeychain,
    });
    expect(limits[0]?.reason).toBe("not_applicable");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(readKeychain).not.toHaveBeenCalled();
  });
});
