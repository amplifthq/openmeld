import { describe, expect, it } from "vitest";
import { organizationComputersResponseSchema } from "../../src/index";

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
} as const;

const TEAM_SAFE_OPENMELD_TOOLS = {
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
  ])("rejects %s from the team-safe detail projection", (_label, privateField) => {
    expect(
      organizationComputersResponseSchema.safeParse(
        responseWithDetails({ ...TEAM_SAFE_DETAILS, ...privateField })
      ).success
    ).toBe(false);
  });
});
