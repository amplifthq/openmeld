import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { readModelCatalog } from "../src/config/model-catalog";
import { listOrganizationComputers } from "../src/organizations/organization-computers-service";

describe("Organization Computers service", () => {
  it("projects team-safe usage evidence only when the reader opts in", async () => {
    const input = {
      generatedAt: "2026-08-20T08:00:00.000Z",
      lookupMemberComputerInventory: async () => ({
        devices: [
          {
            deviceId: "computer-1",
            deviceType: "laptop",
            firstSeenAtMs: 1,
            lastObservedAtMs: 2,
            observedDisplayName: "Maya's Mac",
            osVersion: "15.6",
            ownerUserId: "user-1",
            platformFamily: "macOS",
            updatedAtMs: 2,
            userDisplayName: null,
          },
        ],
        executionTargets: [
          {
            agentControllerInterface: sensitiveSnapshot(),
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "computer-1",
            lastObservedAtMs: 2,
            openMeldServiceRuntimeId: "runtime-1",
            runtimeLane: "prod",
          },
        ],
        liveSessions: [],
      }),
      memberUserIds: ["user-1"],
      modelCatalog: readModelCatalog(),
      organizationId: "organization-1",
    } satisfies Parameters<typeof listOrganizationComputers>[0];

    const legacyResponse = await listOrganizationComputers(input);
    expect(
      legacyResponse.computers[0]?.localAgents[0]?.details?.usageLimits
    ).toBeUndefined();

    const response = await listOrganizationComputers({
      ...input,
      includeUsageLimits: true,
    });

    expect(response.computers[0]?.localAgents[0]).toMatchObject({
      agentControllerRef: "builtin:codex",
      details: {
        models: [
          { displayName: "GPT-5.5", id: "gpt-5.5" },
          { displayName: "Private model" },
        ],
        usageLimits: [
          {
            key: "codex:primary",
            label: "5-hour usage",
            status: "available",
            usedPercent: 82,
          },
          {
            key: "codex:secondary",
            label: "Weekly usage",
            status: "exhausted",
            usedPercent: 100,
          },
        ],
      },
      enabled: true,
      status: "ready",
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("maya@example.com");
    expect(serialized).not.toContain("/Users/maya/bin/codex");
    expect(serialized).not.toContain("private-company-skill");
    expect(serialized).not.toContain("private-plan");
    expect(serialized).not.toContain("prepaidBalance");
  });

  it("keeps the newest exact runtime and lane evidence when controller refs repeat", async () => {
    const input = {
      generatedAt: "2026-08-20T08:05:00.000Z",
      lookupMemberComputerInventory: async () => ({
        devices: [
          {
            deviceId: "computer-1",
            deviceType: "laptop",
            firstSeenAtMs: 1,
            lastObservedAtMs: 300,
            observedDisplayName: "Maya's Mac",
            osVersion: "15.6",
            ownerUserId: "user-1",
            platformFamily: "macOS",
            updatedAtMs: 300,
            userDisplayName: null,
          },
        ],
        executionTargets: [
          {
            agentControllerInterface: sensitiveSnapshot(),
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: [],
            capabilityStatus: "ready",
            deviceId: "computer-1",
            lastObservedAtMs: 200,
            openMeldServiceRuntimeId: "runtime-prod-old",
            runtimeLane: "prod",
          },
          {
            agentControllerInterface: {
              ...sensitiveSnapshot(),
              auth: { status: "unauthenticated" },
              checkedAt: "2026-08-20T08:04:00.000Z",
              message: "Codex is not signed in.",
              status: "unavailable",
              version: "0.149.0",
            },
            agentControllerRef: "builtin:codex",
            capabilityEnabled: true,
            capabilityReasonCodes: [
              "provider_account.access_required",
              "controller.auth.unauthenticated",
            ],
            capabilityStatus: "not_ready",
            deviceId: "computer-1",
            lastObservedAtMs: 300,
            openMeldServiceRuntimeId: "runtime-canary-current",
            runtimeLane: "canary",
          },
        ],
        liveSessions: [],
      }),
      memberUserIds: ["user-1"],
      modelCatalog: readModelCatalog(),
      organizationId: "organization-1",
    } satisfies Parameters<typeof listOrganizationComputers>[0];

    const response = await listOrganizationComputers(input);

    expect(response.computers[0]?.localAgents).toEqual([
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        details: expect.objectContaining({
          checkedAt: "2026-08-20T08:04:00.000Z",
          status: "unavailable",
          version: "0.149.0",
        }),
        status: "not_ready",
      }),
    ]);
  });
});

function sensitiveSnapshot(): AgentControllerInterfaceSnapshot {
  const observedAt = "2026-08-20T08:00:00.000Z";
  return {
    agentControllerRef: "builtin:codex",
    auth: {
      email: "maya@example.com",
      label: "Private account",
      status: "authenticated",
    },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: ["--private-plan"],
      commandPath: "/Users/maya/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: "prepaidBalance is private",
    models: [
      { displayName: "GPT-5.5", id: "gpt-5.5" },
      { displayName: "Private model", id: "private-plan" },
    ],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [{ id: "private-company-skill" }],
    status: "ready",
    usageLimits: [
      {
        key: "codex:primary",
        label: "5-hour usage",
        observedAt,
        resetsAt: "2026-08-20T12:00:00.000Z",
        status: "available",
        usedPercent: 82,
      },
      {
        key: "codex:secondary",
        label: "Weekly usage",
        observedAt,
        resetsAt: "2026-08-27T08:00:00.000Z",
        status: "exhausted",
        usedPercent: 100,
      },
    ],
    version: "0.148.0",
  };
}
