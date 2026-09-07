import { describe, expect, it, vi } from "vitest";
import { readModelCatalog } from "../src/config/model-catalog";
import { listOrganizationComputers } from "../src/organizations/organization-computers-service";

describe("organization computers service", () => {
  it("groups only enrolled identities and observes every incarnation of the same computer", async () => {
    const response = await listOrganizationComputers({
      generatedAt: "2026-09-07T00:00:00.000Z",
      memberUserIds: ["member"],
      organizationId: "org",
      modelCatalog: readModelCatalog(),
      lookupMemberComputerInventory: async () => ({
        devices: ["old", "new", "unrelated"].map((deviceId, index) => ({
          deviceId,
          connectedComputerId:
            deviceId === "unrelated" ? null : "one-physical-computer",
          ownerUserId: "member",
          firstSeenAtMs: 1,
          lastObservedAtMs: index + 1,
          updatedAtMs: index + 1,
          userDisplayName: null,
          observedDisplayName: "Same name",
          osVersion: null,
          deviceType: "laptop",
          platformFamily: "macOS",
        })),
        executionTargets: [],
        liveSessions: null,
      }),
    });
    expect(response.computers).toHaveLength(2);
    expect(response.computers.map((computer) => computer.computerId)).toEqual([
      "new",
      "unrelated",
    ]);
    expect(
      response.computers.every(
        (computer) => computer.serviceState === "unknown"
      )
    ).toBe(true);
  });
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
            openMeldTools: {
              updateOperation: {
                operationId: "update-1",
                phase: "waiting_for_work" as const,
                requestSource: "automatic" as const,
                requestedAt: "2026-08-18T05:00:00.000Z",
                targetVersion: "0.3.66",
                updatedAt: "2026-08-18T05:01:00.000Z",
                urgency: "available" as const,
              },
              cli: {
                installedPackageVersion: "0.3.66",
                latestPackageVersion: "0.3.66",
                reasonCodes: [],
                status: "current" as const,
                updatePolicy: "ok" as const,
                wakeBlocked: false,
              },
              service: {
                installedVersion: "0.3.65",
                latestVersion: "0.3.66",
                reasonCodes: ["service.update_available"],
                requiredVersion: "0.3.65",
                status: "update_available" as const,
                updatePolicy: "available" as const,
                wakeBlocked: false,
              },
              skills: {
                reasonCodes: [],
                status: "current" as const,
                targetCount: 1,
                updatePolicy: "ok" as const,
                wakeBlocked: false,
              },
            },
            serviceUpdateWakeBlocked: false,
          },
        ],
      })),
      memberUserIds: ["user-fangyuan"],
      modelCatalog: readModelCatalog(),
      organizationId: "org-amplift",
    });

    expect(response.computers).toEqual([
      expect.objectContaining({
        computerId: "device-user-fangyuan",
        deviceDisplayName: "Fangyuan's MacBook Pro",
        localAgents: [],
        openMeldTools: expect.objectContaining({
          updateOperation: expect.objectContaining({
            operationId: "update-1",
            phase: "waiting_for_work",
          }),
          service: expect.objectContaining({
            installedVersion: "0.3.65",
            status: "update_available",
          }),
        }),
        ownerUserId: "user-fangyuan",
        serviceState: "connected",
      }),
    ]);
  });

  it("projects useful team-safe agent diagnostics without exposing accounts or local paths", async () => {
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
            lastObservedAtMs: 100,
            openMeldServiceRuntimeId: "runtime-without-details",
            runtimeLane: "prod" as const,
          },
          {
            agentControllerRef: "builtin:claude-code",
            agentControllerInterface: {
              agentControllerRef: "builtin:claude-code",
              auth: {
                email: "private@example.com",
                label: "Private account",
                status: "authenticated" as const,
                type: "oauth",
              },
              capabilities: {
                approvals: true,
                cancel: false,
                interrupt: true,
                modelSelection: true,
                nativeEventStream: true,
                permissionModes: true,
                structuredUserInput: false,
              },
              check: {
                lastSucceededAt: "2026-08-18T04:59:00.000Z",
                status: "succeeded" as const,
              },
              checkedAt: "2026-08-18T05:00:00.000Z",
              controllerId: "claude-code",
              displayName: "Claude Code",
              launch: {
                argsPrefix: ["--private-setting"],
                commandPath: "/Users/fangyuan/.local/bin/claude",
                installChoiceCount: 2,
                status: "ready" as const,
              },
              message: "Private diagnostic message",
              models: [{ displayName: "Claude Sonnet", id: "claude-sonnet" }],
              nativeInterface: "claude-cli" as const,
              schemaVersion: 1 as const,
              skills: [
                {
                  displayName: "Private company skill",
                  id: "private-company-skill",
                },
              ],
              status: "ready" as const,
              version: "2.1.234",
              versionAdvisory: {
                checkedAt: "2026-08-18T05:00:00.000Z",
                currentVersion: "2.1.234",
                latestVersion: "2.1.234",
                message: "Private update detail",
                status: "current" as const,
                updateCommand: "npm install -g private-package",
              },
            },
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
      modelCatalog: readModelCatalog(),
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
          details: {
            capabilities: {
              approvals: true,
              cancel: false,
              interrupt: true,
              modelSelection: true,
              nativeEventStream: true,
              permissionModes: true,
              structuredUserInput: false,
            },
            check: {
              lastSucceededAt: "2026-08-18T04:59:00.000Z",
              status: "succeeded",
            },
            checkedAt: "2026-08-18T05:00:00.000Z",
            conversationCapabilities: {
              discover: "unsupported",
              externalImport: "by_ref_id",
              fork: "by_ref_id",
              resume: "by_ref_id",
              turnOverride: "unsupported",
            },
            launch: {
              installChoiceCount: 2,
              status: "ready",
            },
            models: [{ displayName: "Claude Sonnet" }],
            nativeInterface: "claude-cli",
            status: "ready",
            version: "2.1.234",
            versionAdvisory: {
              checkedAt: "2026-08-18T05:00:00.000Z",
              currentVersion: "2.1.234",
              latestVersion: "2.1.234",
              status: "current",
            },
          },
          enabled: true,
          status: "ready",
        },
      ],
      osVersion: "15.5",
      ownerUserId: "user-fangyuan",
      platformFamily: "macOS",
      serviceState: "unknown",
    });
    const serialized = JSON.stringify(response.computers[0]);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Private account");
    expect(serialized).not.toContain("/Users/fangyuan");
    expect(serialized).not.toContain("--private-setting");
    expect(serialized).not.toContain("Private diagnostic message");
    expect(serialized).not.toContain("Private company skill");
    expect(serialized).not.toContain("npm install");
  });
});
