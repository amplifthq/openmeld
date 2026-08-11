import { describe, expect, it } from "vitest";
import { startDeviceProjectionSchema } from "../../src/index";

function createValidDeviceProjection() {
  return {
    deviceId: "device-1",
    runtimeLane: "dev-local",
    observedAt: "2026-04-07T00:00:00.000Z",
    backgroundHelper: {
      installStatus: "installed_current",
      runtimeStatus: "running",
      installedVersion: "1.2.3",
      expectedVersion: "1.2.3",
    },
    skillsReadiness: {
      status: "action_required",
      targetCount: 3,
      summary: {
        upToDate: 1,
        outdated: 1,
        missing: 1,
        externalConflict: 0,
      },
    },
    deviceAgentCatalog: {
      totalBuiltins: 2,
      detectedSupported: 1,
      needsChoice: 0,
      needsRepair: 0,
      detectedNotSupportedYet: 1,
      notDetected: 0,
      entries: [
        {
          agentId: "codex",
          displayName: "Codex",
          targetKind: "builtin",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        },
        {
          agentId: "openclaw",
          displayName: "OpenClaw",
          targetKind: "builtin",
          detected: true,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_supported_yet",
        },
        {
          agentId: "custom-demo",
          displayName: "Custom Demo",
          targetKind: "custom",
          detected: false,
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "custom_coming_soon",
        },
      ],
    },
    deviceReplyReadiness: {
      level: "ready",
      reasonCodes: [],
    },
  } as const;
}

describe("start device projection schema", () => {
  it("accepts a normalized device projection with builtin and custom entries", () => {
    const result = startDeviceProjectionSchema.safeParse(
      createValidDeviceProjection()
    );

    expect(result.success).toBe(true);
  });

  it("rejects extra local-only backgroundHelper fields", () => {
    const result = startDeviceProjectionSchema.safeParse({
      ...createValidDeviceProjection(),
      backgroundHelper: {
        ...createValidDeviceProjection().backgroundHelper,
        pid: 1234,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects ambiguous agent catalog selectable semantics", () => {
    const result = startDeviceProjectionSchema.safeParse({
      ...createValidDeviceProjection(),
      deviceAgentCatalog: {
        totalBuiltins: 1,
        detectedSupported: 1,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 0,
        entries: [
          {
            agentId: "codex",
            displayName: "Codex",
            targetKind: "builtin",
            detected: true,
            enabled: true,
            launchStatus: "ready",
            selectable: true,
            selectableReason: "not_supported_yet",
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects contradictory skills readiness summary counts", () => {
    const result = startDeviceProjectionSchema.safeParse({
      ...createValidDeviceProjection(),
      skillsReadiness: {
        status: "action_required",
        targetCount: 3,
        summary: {
          upToDate: 1,
          outdated: 1,
          missing: 0,
          externalConflict: 0,
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
