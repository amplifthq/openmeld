import { describe, expect, it } from "vitest";
import {
  currentDeviceTargetResponseSchema,
  forgetComputerResponseSchema,
  forgetComputerRouteParamsSchema,
  localRuntimeEnrollmentBodySchema,
  localRuntimeEnrollmentResponseSchema,
  localRuntimeLocalProjectControlSchema,
  localRuntimesResponseSchema,
  setCurrentAgentProfileWorkspaceBodySchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentAgentProfileWorkspaceRouteParamsSchema,
  setLocalRuntimeDisplayNameBodySchema,
  writeCurrentDeviceObservedMetadataBodySchema,
  writeCurrentDeviceObservedMetadataResponseSchema,
} from "../../src";

describe("current device target http schemas", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated", label: "Signed in" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [{ id: "review", displayName: "Review" }],
    status: "ready",
    version: "0.1.0",
  } as const;

  it("accepts the resolved response shape", () => {
    const result = currentDeviceTargetResponseSchema.safeParse({
      availability: "resolved",
      deviceId: "device-123",
      runtimeLane: "dev-local",
    });

    expect(result.success).toBe(true);
  });

  it("accepts the missing response shape", () => {
    const result = currentDeviceTargetResponseSchema.safeParse({
      availability: "missing",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a resolved response without a device id", () => {
    const result = currentDeviceTargetResponseSchema.safeParse({
      availability: "resolved",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid local runtime enrollment body", () => {
    const result = localRuntimeEnrollmentBodySchema.safeParse({
      runtimeLane: "dev-local",
    });

    expect(result.success).toBe(true);
  });

  it("accepts connected-computer evidence in the enrollment body", () => {
    const result = localRuntimeEnrollmentBodySchema.safeParse({
      connectedComputerId: "computer-1",
      runtimeLane: "dev-local",
    });

    expect(result.success).toBe(true);
  });

  it("round-trips the enrollment response shape", () => {
    expect(
      localRuntimeEnrollmentResponseSchema.safeParse({
        deviceId: "device-123",
        runtimeLane: "dev-local",
      }).success
    ).toBe(true);
    expect(
      localRuntimeEnrollmentResponseSchema.safeParse({
        connectedComputerId: "computer-1",
        deviceId: "device-123",
        runtimeLane: "dev-local",
      }).success
    ).toBe(true);
  });

  it("rejects unknown enrollment request keys", () => {
    const result = localRuntimeEnrollmentBodySchema.safeParse({
      runtimeLane: "dev-local",
      extra: true,
    });

    expect(result.success).toBe(false);
  });

  it("requires a runtime lane for local runtime enrollment", () => {
    const result = localRuntimeEnrollmentBodySchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("accepts a valid forget-computer route param", () => {
    const result = forgetComputerRouteParamsSchema.safeParse({
      deviceId: "device-123",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a forget-computer response with an unchanged current target", () => {
    const result = forgetComputerResponseSchema.safeParse({
      status: "forgotten",
      forgottenDeviceId: "device-other",
      currentDeviceTarget: {
        availability: "resolved",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a local runtimes response", () => {
    const result = localRuntimesResponseSchema.safeParse({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [
            {
              capabilities: [
                {
                  agentControllerRef: "builtin:codex",
                  agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
                  enabled: true,
                  reasonCodes: ["runtime.ready"],
                  status: "ready",
                },
              ],
              deviceId: "device-123",
              isCurrent: true,
              lastObservedAtMs: 1_712_966_000_000,
              localAgentControl: {
                refreshCatalog: true,
                setEnabled: true,
                setProfileWorkspace: true,
              },
              reasonCodes: ["runtime.ready"],
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
              },
              runtimeLane: "dev-local",
              status: "ready",
              userFacingCommand: "openmeld-dev",
              localAgentCatalog: {
                detectedNotSupportedYet: 0,
                detectedSupported: 1,
                entries: [
                  {
                    agentId: "codex",
                    detected: true,
                    displayName: "Codex",
                    enabled: true,
                    launchStatus: "ready",
                    selectable: true,
                    selectableReason: null,
                    targetKind: "builtin",
                  },
                ],
                needsChoice: 0,
                needsRepair: 0,
                notDetected: 0,
                totalBuiltins: 1,
              },
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects local runtimes responses without stable computer metadata", () => {
    const result = localRuntimesResponseSchema.safeParse({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts an observed named computer in the local runtimes response", () => {
    const result = localRuntimesResponseSchema.safeParse({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceDisplayNameSource: "observed",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: 1_712_966_400_000,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts an older local Project control projection without move support", () => {
    const result = localRuntimeLocalProjectControlSchema.safeParse({
      connectCandidate: true,
      connectDeclaredPath: true,
      discoverProjects: true,
      removeConnection: true,
      removeMissingConnections: true,
      setDefaultConnection: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a user named computer in the local runtimes response", () => {
    const response = {
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "Office MacBook",
          deviceDisplayNameSource: "user",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: 1_712_966_400_000,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    };

    expect(localRuntimesResponseSchema.safeParse(response).success).toBe(true);
  });

  it("rejects a local runtimes response without a display name", () => {
    const result = localRuntimesResponseSchema.safeParse({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("accepts local runtime display name writes", () => {
    const named = setLocalRuntimeDisplayNameBodySchema.safeParse({
      displayName: "  Office MacBook  ",
    });
    const cleared = setLocalRuntimeDisplayNameBodySchema.safeParse({
      displayName: null,
    });

    expect(named.success).toBe(true);
    expect(named.success ? named.data.displayName : null).toBe(
      "Office MacBook"
    );
    expect(cleared.success).toBe(true);
  });

  it("rejects blank and oversized local runtime display names", () => {
    expect(
      setLocalRuntimeDisplayNameBodySchema.safeParse({
        displayName: "",
      }).success
    ).toBe(false);
    expect(
      setLocalRuntimeDisplayNameBodySchema.safeParse({
        displayName: "   ",
      }).success
    ).toBe(false);
    expect(
      setLocalRuntimeDisplayNameBodySchema.safeParse({
        displayName: "x".repeat(81),
      }).success
    ).toBe(false);
  });

  it("accepts current Agent Profile workspace writes", () => {
    expect(
      setCurrentAgentProfileWorkspaceRouteParamsSchema.safeParse({
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }).success
    ).toBe(true);
    const customBody = setCurrentAgentProfileWorkspaceBodySchema.safeParse({
      workspaceMode: "custom",
      workspacePath: "/Users/felix/Desktop/work/openmeld",
    });
    expect(customBody.success).toBe(true);
    expect(customBody.success ? customBody.data.workspacePath : null).toBe(
      "/Users/felix/Desktop/work/openmeld"
    );
    expect(
      setCurrentAgentProfileWorkspaceBodySchema.safeParse({
        workspaceMode: "openmeld_managed",
      }).success
    ).toBe(true);
    expect(
      setCurrentAgentProfileWorkspaceResponseSchema.safeParse({
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
        status: "updated",
        workspaceMode: "custom",
        workspacePath: "/Users/felix/Desktop/work/openmeld",
      }).success
    ).toBe(true);
  });

  it("rejects invalid current Agent Profile workspace writes", () => {
    expect(
      setCurrentAgentProfileWorkspaceBodySchema.safeParse({
        workspaceMode: "custom",
      }).success
    ).toBe(false);
    expect(
      setCurrentAgentProfileWorkspaceBodySchema.safeParse({
        workspaceMode: "openmeld_managed",
        workspacePath: "/Users/felix/Desktop/work/openmeld",
      }).success
    ).toBe(false);
  });

  it("accepts current-device observed metadata writes", () => {
    const input = {
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: 1_712_966_400_000,
      },
    };

    expect(
      writeCurrentDeviceObservedMetadataBodySchema.safeParse(input).success
    ).toBe(true);
    expect(
      writeCurrentDeviceObservedMetadataResponseSchema.safeParse(input).success
    ).toBe(true);
  });

  it("rejects blank observed metadata fields", () => {
    const result = writeCurrentDeviceObservedMetadataBodySchema.safeParse({
      metadata: {
        observedDisplayName: "   ",
        platformFamily: "macOS",
        osVersion: "",
        deviceType: "laptop",
        observedAtMs: -1,
      },
    });

    expect(result.success).toBe(false);
  });
});
