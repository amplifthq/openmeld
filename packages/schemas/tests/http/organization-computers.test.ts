import { describe, expect, it } from "vitest";
import {
  organizationComputersResponseSchema,
  projectOrganizationComputerLocalAgentDetails,
} from "../../src/index";

const TEAM_SAFE_DETAILS = {
  capabilities: {
    approvals: true,
    cancel: false,
    interrupt: true,
    modelSelection: true,
    nativeEventStream: true,
    permissionModes: true,
    structuredUserInput: false,
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
  models: [{ displayName: "Claude Sonnet", id: "claude-sonnet" }],
  nativeInterface: "claude-cli",
  status: "ready",
  usageLimits: [
    {
      key: "codex:primary",
      label: "5-hour usage",
      observedAt: "2026-08-18T05:00:00.000Z",
      resetsAt: "2026-08-18T08:00:00.000Z",
      status: "available",
      usedPercent: 42,
    },
    {
      key: "codex:secondary",
      label: "Weekly usage",
      observedAt: "2026-08-18T05:00:00.000Z",
      resetsAt: null,
      status: "stale",
      usedPercent: 88,
    },
  ],
  version: "2.1.234",
  versionAdvisory: {
    checkedAt: "2026-08-18T05:00:00.000Z",
    currentVersion: "2.1.234",
    latestVersion: "2.1.234",
    status: "current",
  },
} as const;

const TEAM_SAFE_OPENMELD_TOOLS = {
  maintenance: {
    automaticUpdatesEnabled: true,
    status: "ready",
  },
  updateOperation: {
    operationId: "update-1",
    phase: "waiting_for_work",
    requestSource: "automatic",
    requestedAt: "2026-08-18T05:00:00.000Z",
    targetVersion: "0.3.66",
    updatedAt: "2026-08-18T05:01:00.000Z",
    urgency: "available",
  },
  cli: {
    installedPackageVersion: "0.3.66",
    latestPackageVersion: "0.3.66",
    reasonCodes: [],
    status: "current",
    updatePolicy: "ok",
    wakeBlocked: false,
  },
  service: {
    installedVersion: "0.3.65",
    latestVersion: "0.3.66",
    reasonCodes: ["service.update_available"],
    requiredVersion: "0.3.65",
    status: "update_available",
    updatePolicy: "available",
    wakeBlocked: false,
  },
  skills: {
    reasonCodes: [],
    status: "current",
    targetCount: 2,
    updatePolicy: "ok",
    wakeBlocked: false,
  },
} as const;

function responseWithDetails(details: unknown) {
  return {
    computers: [
      {
        computerId: "computer-1",
        deviceDisplayName: "Design Mac",
        deviceType: "laptop",
        lastSeenAtMs: 1,
        localAgents: [
          {
            agentControllerRef: "builtin:claude-code",
            details,
            enabled: true,
            status: "ready",
          },
        ],
        openMeldTools: TEAM_SAFE_OPENMELD_TOOLS,
        osVersion: "15.5",
        ownerUserId: "user-1",
        platformFamily: "macOS",
        serviceState: "connected",
      },
    ],
    generatedAt: "2026-08-18T05:00:00.000Z",
    organizationId: "organization-1",
  };
}

describe("Organization Computers contracts", () => {
  it.each([
    ["builtin:codex", "by_ref_id"],
    ["builtin:cursor", "unsupported"],
  ] as const)("projects the truthful fork capability for %s", (agentControllerRef, expectedForkCapability) => {
    expect(
      projectOrganizationComputerLocalAgentDetails({
        agentControllerRef,
        auth: { status: "authenticated" },
        capabilities: TEAM_SAFE_DETAILS.capabilities,
        checkedAt: "2026-08-18T05:00:00.000Z",
        controllerId: agentControllerRef.slice("builtin:".length),
        displayName: "Local Agent",
        launch: {
          argsPrefix: [],
          commandPath: "/usr/local/bin/local-agent",
          installChoiceCount: 1,
          status: "ready",
        },
        message: null,
        models: [],
        nativeInterface: "local-cli",
        schemaVersion: 1,
        skills: [],
        status: "ready",
        version: "1.0.0",
      }).conversationCapabilities?.fork
    ).toBe(expectedForkCapability);
  });

  it("projects model identifiers needed to prevent incompatible teammate selections", () => {
    expect(
      projectOrganizationComputerLocalAgentDetails({
        agentControllerRef: "builtin:codex",
        auth: { status: "authenticated" },
        capabilities: TEAM_SAFE_DETAILS.capabilities,
        checkedAt: "2026-08-18T05:00:00.000Z",
        controllerId: "codex",
        displayName: "Codex",
        launch: {
          argsPrefix: [],
          commandPath: "/usr/local/bin/codex",
          installChoiceCount: 1,
          status: "ready",
        },
        message: null,
        models: [{ displayName: "GPT-5.6 Sol", id: "gpt-5.6-sol" }],
        nativeInterface: "codex-app-server",
        schemaVersion: 1,
        skills: [],
        status: "ready",
        version: "0.149.1",
      }).models
    ).toEqual([{ displayName: "GPT-5.6 Sol", id: "gpt-5.6-sol" }]);
  });

  it("continues to accept older team projections without model identifiers", () => {
    expect(
      organizationComputersResponseSchema.safeParse(
        responseWithDetails({
          ...TEAM_SAFE_DETAILS,
          models: [{ displayName: "Claude Sonnet" }],
        })
      ).success
    ).toBe(true);
  });

  it("accepts useful team-safe local-agent operational details", () => {
    expect(
      organizationComputersResponseSchema.parse(
        responseWithDetails(TEAM_SAFE_DETAILS)
      ).computers[0]?.localAgents[0]?.details
    ).toEqual(TEAM_SAFE_DETAILS);
  });

  it("accepts team-safe OpenMeld Tools versions without setup commands", () => {
    const parsed = organizationComputersResponseSchema.parse(
      responseWithDetails(TEAM_SAFE_DETAILS)
    );
    expect(parsed.computers[0]?.openMeldTools).toEqual(
      TEAM_SAFE_OPENMELD_TOOLS
    );
    expect(
      organizationComputersResponseSchema.safeParse({
        ...responseWithDetails(TEAM_SAFE_DETAILS),
        computers: [
          {
            ...responseWithDetails(TEAM_SAFE_DETAILS).computers[0],
            openMeldTools: {
              ...TEAM_SAFE_OPENMELD_TOOLS,
              humanSetupCommand: "curl private | sh",
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it.each([
    ["account identity", { account: "private@example.com" }],
    ["launch path", { commandPath: "/Users/private/.local/bin/claude" }],
    ["update command", { updateCommand: "npm install -g private" }],
    ["private skill", { skills: [{ displayName: "Private skill" }] }],
    ["subscription tier", { subscriptionTier: "private-plan" }],
    ["provider balance", { prepaidBalance: 99 }],
  ])("rejects %s from the team-safe detail projection", (_label, privateField) => {
    expect(
      organizationComputersResponseSchema.safeParse(
        responseWithDetails({ ...TEAM_SAFE_DETAILS, ...privateField })
      ).success
    ).toBe(false);
  });

  it("rejects sensitive provider fields nested inside usage limits", () => {
    const usageLimit = TEAM_SAFE_DETAILS.usageLimits[0];
    expect(
      organizationComputersResponseSchema.safeParse(
        responseWithDetails({
          ...TEAM_SAFE_DETAILS,
          usageLimits: [{ ...usageLimit, accountEmail: "private@example.com" }],
        })
      ).success
    ).toBe(false);
  });
});
