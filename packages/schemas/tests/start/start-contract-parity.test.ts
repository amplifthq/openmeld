import { describe, expect, it } from "vitest";
import { startDeviceProjectionSchema } from "../../src/index";

describe("start contract parity", () => {
  it("expresses current CLI start readiness reality without carrying local-only fields", () => {
    const currentCliStartReadinessSample = {
      auth: {
        status: "valid",
        email: "felix@openmeld.invalid",
        authBaseUrl: "https://auth.openmeld.invalid",
        gatewayUrl: "https://gateway.openmeld.invalid",
      },
      skills: {
        status: "up_to_date",
        targetCount: 2,
        summary: {
          upToDate: 2,
          outdated: 0,
          missing: 0,
          externalConflict: 0,
        },
      },
      agents: {
        status: "ok",
        totalBuiltins: 2,
        detectedSupported: 1,
        needsChoice: 0,
        needsRepair: 0,
        detectedNotSupportedYet: 0,
        notDetected: 1,
        candidates: [
          {
            agentId: "codex",
            displayName: "Codex",
            detected: true,
            enabled: true,
            launchStatus: "ready",
            selectable: true,
            selectableReason: null,
          },
          {
            agentId: "claude-code",
            displayName: "Claude Code",
            detected: false,
            enabled: false,
            launchStatus: "not_available",
            selectable: false,
            selectableReason: "not_detected",
          },
        ],
      },
      service: {
        status: "installed_current",
        installedVersion: "1.2.3",
        expectedVersion: "1.2.3",
        runtime: {
          status: "running",
          mode: "background",
          pid: 4321,
          startedAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:30.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
      },
    } as const;

    const sharedProjection = {
      deviceId: "device-1",
      runtimeLane: "dev-local",
      observedAt: "2026-04-07T00:00:30.000Z",
      backgroundHelper: {
        installStatus: currentCliStartReadinessSample.service.status,
        runtimeStatus: currentCliStartReadinessSample.service.runtime.status,
        installedVersion:
          currentCliStartReadinessSample.service.installedVersion,
        expectedVersion: currentCliStartReadinessSample.service.expectedVersion,
      },
      skillsReadiness: currentCliStartReadinessSample.skills,
      deviceAgentCatalog: {
        totalBuiltins: currentCliStartReadinessSample.agents.totalBuiltins,
        detectedSupported:
          currentCliStartReadinessSample.agents.detectedSupported,
        needsChoice: currentCliStartReadinessSample.agents.needsChoice,
        needsRepair: currentCliStartReadinessSample.agents.needsRepair,
        detectedNotSupportedYet:
          currentCliStartReadinessSample.agents.detectedNotSupportedYet,
        notDetected: currentCliStartReadinessSample.agents.notDetected,
        entries: currentCliStartReadinessSample.agents.candidates.map(
          (candidate) => ({
            ...candidate,
            targetKind: "builtin" as const,
          })
        ),
      },
      deviceReplyReadiness: {
        level: "ready",
        reasonCodes: [],
      },
    };

    expect(
      startDeviceProjectionSchema.safeParse(sharedProjection).success
    ).toBe(true);
    expect(
      startDeviceProjectionSchema.safeParse({
        ...sharedProjection,
        backgroundHelper: {
          ...sharedProjection.backgroundHelper,
          pid: currentCliStartReadinessSample.service.runtime.pid,
        },
      }).success
    ).toBe(false);
  });
});
