import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import {
  formatReplyReadinessSummary,
  resolveAgentReplyReadinessStatus,
} from "../src/system/reply-readiness";

const {
  prepareProviderRuntimeMock,
  resolveAgentTargetStateMock,
  resolveAgentProfilePrimaryAgentControllerReportMock,
} = vi.hoisted(() => ({
  prepareProviderRuntimeMock: vi.fn(),
  resolveAgentTargetStateMock: vi.fn(),
  resolveAgentProfilePrimaryAgentControllerReportMock: vi.fn(),
}));

vi.mock("../src/agents/registry", () => ({
  resolveAgentTargetState: resolveAgentTargetStateMock,
}));

vi.mock("../src/provider-hosts/prepare-provider-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/provider-hosts/prepare-provider-runtime")
  >("../src/provider-hosts/prepare-provider-runtime");
  return {
    ...actual,
    prepareProviderRuntime: prepareProviderRuntimeMock,
  };
});

vi.mock("../src/system/agent-profile-primary-binding", () => ({
  resolveAgentProfilePrimaryAgentControllerReport:
    resolveAgentProfilePrimaryAgentControllerReportMock,
}));

function createReadyDeviceReplyReadiness() {
  return {
    reasonCodes: [],
    reasonText:
      "This device is ready for Space replies from local agent profiles",
    replyReadiness: "ready" as const,
    updatedAt: "2026-03-23T00:00:00.000Z",
    wakeableRouteCount: 1,
  };
}

function createAgentProfile(_controllerRef: string): OpenMeldProfile {
  return {
    openMeldProfileId: "agt_demo",
    profileName: "Demo Bot",
    profileHandle: "demo-bot",
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-demo",
    source: "cli_create",
    createdByUserId: "user-demo",
    lastUsedAt: null,
    createdAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
  };
}

function createPrimaryBinding() {
  return {
    agentProfileId: "agt_demo",
    authoritySource: "binding_truth" as const,
    bindingId: "bind_demo",
    bindingState: "enabled_primary" as const,
    dispatchEligibility: {
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      status: "routable" as const,
    },
    grantsClaimSuccess: false as const,
    reasonCodes: ["agent_profile_binding.enabled_primary"],
    resolutionSource: "binding_truth" as const,
    routable: true,
    executionTarget: {
      agentControllerRef: "builtin:openclaw",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime-opaque-openclaw",
      },
    },
  };
}

function createOpenClawPreparationResult() {
  return {
    envOverrides: {
      OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
    },
    preparationDetails: {
      bootstrap: {
        agentId: "openmeld-demo-bot",
        authStatus: "copied" as const,
        bootstrapVersion: 1,
        created: true,
        resolution: "created" as const,
      },
      kind: "openclaw" as const,
      openClawGatewayVisibility: {
        agentId: "openmeld-demo-bot",
        gatewayRestartAttempted: false,
        gatewayVisibility: "visible" as const,
      },
    },
    runtimeContext: {
      providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
    },
  };
}

function createReadyWorkspaceResolution(
  workspacePath = "/tmp/openclaw-workspace"
) {
  return {
    configPath: "/tmp/local-meta.json",
    configuredWorkspacePath: workspacePath,
    effectiveRuntimeWorkingDirectory: workspacePath,
    runtimeContext: {
      providerRuntimeWorkingDirectory: workspacePath,
    },
    status: "ready" as const,
    workspaceMode: "custom" as const,
  };
}

describe("reply readiness shared copy", () => {
  it("uses shared availability copy for an unbound profile", () => {
    expect(
      formatReplyReadinessSummary({
        reasonCodes: ["profile.unbound"],
        reasonText: "local agent connection is missing",
        replyReadiness: "blocked",
      })
    ).toBe("Blocked (Connect a local agent before this profile can reply.)");
  });
});

describe("reply readiness runtime preparation integration", () => {
  beforeEach(() => {
    prepareProviderRuntimeMock.mockReset();
    resolveAgentTargetStateMock.mockReset();
    resolveAgentProfilePrimaryAgentControllerReportMock
      .mockReset()
      .mockResolvedValue({
        bindingState: "enabled_primary",
        capabilityId: "openclaw",
        capabilityKind: "builtin",
        agentControllerRef: "builtin:openclaw",
        localAgentId: "openclaw",
        primaryBinding: createPrimaryBinding(),
        reasonCodes: ["agent_profile_binding.enabled_primary"],
        routable: true,
      });

    prepareProviderRuntimeMock.mockResolvedValue(
      createOpenClawPreparationResult()
    );
    resolveAgentTargetStateMock.mockResolvedValue({
      enabled: true,
      registered: true,
      registration: {
        transportMode: "local-cli",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses shared runtime preparation before making an OpenClaw profile available", async () => {
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness?.replyReadiness).toBe("ready");
    expect(prepareProviderRuntimeMock).toHaveBeenCalledWith({
      agentControllerRef: "builtin:openclaw",
      daemonWorkingDirectory: "/tmp/daemon-workdir",
      mode: "reply_readiness",
      profileName: "Demo Bot",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
      },
      targetProfileId: "agt_demo",
    });
  });

  it("does not run daemon route diagnostics inside agent reply readiness", async () => {
    const primaryBinding = createPrimaryBinding();
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      capabilityId: "openclaw",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:openclaw",
      localAgentId: "openclaw",
      primaryBinding,
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });

    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness?.replyReadiness).toBe("ready");
    expect(
      resolveAgentProfilePrimaryAgentControllerReportMock
    ).toHaveBeenCalled();
  });

  it("surfaces bootstrap failures as a blocked readiness reason", async () => {
    prepareProviderRuntimeMock.mockRejectedValueOnce(
      Object.assign(new Error('Agent "openmeld-demo-bot" already exists.'), {
        code: "controller.bootstrap.failed",
      })
    );

    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["controller.bootstrap.failed"],
      replyReadiness: "blocked",
    });
    expect(readiness?.reasonText).toContain(
      'Agent "openmeld-demo-bot" already exists.'
    );
  });

  it("surfaces invalid providerRuntimeWorkingDirectory failures as blocked readiness", async () => {
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: {
        configPath: "/tmp/local-meta.json",
        reasonCode: "workspace.invalid",
        reasonText: "Profile workspace config is invalid.",
        status: "invalid",
      },
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["workspace.invalid"],
      replyReadiness: "blocked",
    });
    expect(readiness?.reasonText).toContain("workspace");
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });

  it("skips heavy runtime preparation for providers whose contract says none", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:codex"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness?.replyReadiness).toBe("ready");
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });

  it("surfaces gateway failures as a blocked readiness reason", async () => {
    prepareProviderRuntimeMock.mockRejectedValueOnce(
      Object.assign(new Error("Gateway is offline"), {
        code: "controller.gateway.unhealthy",
      })
    );

    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["controller.gateway.unhealthy"],
      replyReadiness: "blocked",
    });
    expect(readiness?.reasonText).toContain("Gateway is offline");
  });

  it("does not fall back to runtime preparation when diagnostics already failed", async () => {
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: createReadyDeviceReplyReadiness(),
      openClawLocalDiagnostics: {
        errorCode: "openclaw.gateway.probe_failed",
        kind: "failed",
        message: "OpenClaw diagnostics probe failed",
      },
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["controller.gateway.unhealthy"],
      replyReadiness: "blocked",
      reasonText: "OpenClaw diagnostics probe failed",
    });
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });

  it("short-circuits runtime preparation when workspace config is missing", async () => {
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: {
        ...createReadyDeviceReplyReadiness(),
        reasonCodes: ["workspace.missing"],
        reasonText:
          "This profile is missing its local workspace on this device.",
        replyReadiness: "blocked",
      },
      profile: createAgentProfile("builtin:openclaw"),
      profileWorkspaceRuntimeResolution: {
        configPath: "/tmp/local-meta.json",
        reasonCode: "workspace.missing",
        reasonText: "Profile workspace config is missing.",
        status: "missing",
      },
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["workspace.missing"],
      replyReadiness: "blocked",
    });
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });

  it("does not let stale local service diagnostics block an online Core Wake route", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });
    const readiness = await resolveAgentReplyReadinessStatus({
      coreWakeRouteOnline: true,
      deviceReplyReadiness: {
        ...createReadyDeviceReplyReadiness(),
        reasonCodes: ["service.not_running"],
        reasonText: "OpenMeld Service is reconnecting on this device",
        replyReadiness: "degraded",
        wakeableRouteCount: 0,
      },
      profile: createAgentProfile("builtin:codex"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness).toMatchObject({
      reasonCodes: [],
      reasonText: "This profile can reply from Space when mentioned",
      replyReadiness: "ready",
    });
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });

  it("keeps local service diagnostics blocking when Core has no online Wake route", async () => {
    resolveAgentProfilePrimaryAgentControllerReportMock.mockResolvedValueOnce({
      bindingState: "enabled_primary",
      capabilityId: "codex",
      capabilityKind: "builtin",
      agentControllerRef: "builtin:codex",
      localAgentId: "codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
    });
    const readiness = await resolveAgentReplyReadinessStatus({
      deviceReplyReadiness: {
        ...createReadyDeviceReplyReadiness(),
        reasonCodes: ["service.not_running"],
        reasonText: "OpenMeld Service is reconnecting on this device",
        replyReadiness: "degraded",
        wakeableRouteCount: 0,
      },
      profile: createAgentProfile("builtin:codex"),
      profileWorkspaceRuntimeResolution: createReadyWorkspaceResolution(
        "/tmp/daemon-workdir"
      ),
    });

    expect(readiness).toMatchObject({
      reasonCodes: ["service.not_running"],
      reasonText:
        "Connect OpenMeld Service on this device before this agent can reply.",
      replyReadiness: "degraded",
    });
    expect(prepareProviderRuntimeMock).not.toHaveBeenCalled();
  });
});
