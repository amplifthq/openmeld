import { describe, expect, it, vi } from "vitest";
import { listOrganizationComputers } from "../src/organizations/organization-computers-service";

describe("organization computers service", () => {
  it("shows a teammate computer even when it has no Agent Profile", async () => {
    const response = await listOrganizationComputers({
      generatedAt: "2026-08-18T05:00:00.000Z",
      lookupMemberComputerInventory: vi.fn(async ({ userId }) => ({
        devices: [
          {
            connectedComputerId: null,
            deviceId: `device-${userId}`,
            deviceType: "laptop" as const,
            firstSeenAtMs: 100,
            lastObservedAtMs: 200,
            observedDisplayName: "Fangyuan's MacBook Pro",
            osVersion: "15.5",
            ownerUserId: userId,
            platformFamily: "macOS" as const,
            updatedAtMs: 200,
            userDisplayName: null,
          },
        ],
        executionTargets: [],
        liveSessions: [
          {
            deviceId: `device-${userId}`,
            executionCompatibility: {
              expectedEpoch: "1",
              observedEpoch: "1",
              reasonCode: "daemon.runtime_contract.compatible" as const,
              status: "compatible" as const,
            },
            serviceUpdateWakeBlocked: false,
          },
        ],
      })),
      memberUserIds: ["user-fangyuan"],
      organizationId: "org-amplift",
    });

    expect(response.computers).toEqual([
      expect.objectContaining({
        computerId: "device-user-fangyuan",
        deviceDisplayName: "Fangyuan's MacBook Pro",
        localAgents: [],
        ownerUserId: "user-fangyuan",
        serviceState: "connected",
      }),
    ]);
  });

  it("projects only team-safe agent state and reports unknown when live lookup is unavailable", async () => {
    const response = await listOrganizationComputers({
      generatedAt: "2026-08-18T05:00:00.000Z",
      lookupMemberComputerInventory: vi.fn(async () => ({
        devices: [
          {
            connectedComputerId: null,
            deviceId: "device-private",
            deviceType: "desktop" as const,
            firstSeenAtMs: 100,
            lastObservedAtMs: 200,
            observedDisplayName: "Design Mac",
            osVersion: "15.5",
            ownerUserId: "user-fangyuan",
            platformFamily: "macOS" as const,
            updatedAtMs: 200,
            userDisplayName: null,
          },
        ],
        executionTargets: [
          {
            agentControllerRef: "builtin:claude-code",
            capabilityEnabled: true,
            capabilityReasonCodes: [],
            capabilityStatus: "ready" as const,
            deviceId: "device-private",
            lastObservedAtMs: 200,
            openMeldServiceRuntimeId: "runtime-private",
            runtimeLane: "prod" as const,
          },
        ],
        liveSessions: null,
      })),
      memberUserIds: ["user-fangyuan"],
      organizationId: "org-amplift",
    });

    expect(response.computers[0]).toEqual({
      computerId: "device-private",
      deviceDisplayName: "Design Mac",
      deviceType: "desktop",
      lastSeenAtMs: 200,
      localAgents: [
        {
          agentControllerRef: "builtin:claude-code",
          enabled: true,
          status: "ready",
        },
      ],
      osVersion: "15.5",
      ownerUserId: "user-fangyuan",
      platformFamily: "macOS",
      serviceState: "unknown",
    });
    expect(response.computers[0]).not.toHaveProperty("account");
    expect(response.computers[0]).not.toHaveProperty("commandPath");
    expect(response.computers[0]).not.toHaveProperty("installationPath");
  });
});
