import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureOpenClawGatewayAgentVisibleMock,
  ensureOpenClawLocalBootstrapMock,
} = vi.hoisted(() => ({
  ensureOpenClawGatewayAgentVisibleMock: vi.fn(),
  ensureOpenClawLocalBootstrapMock: vi.fn(),
}));

vi.mock("../src/provider-hosts/openclaw/local-bootstrap", async () => {
  const actual = await vi.importActual<
    typeof import("../src/provider-hosts/openclaw/local-bootstrap")
  >("../src/provider-hosts/openclaw/local-bootstrap");
  return {
    ...actual,
    ensureOpenClawGatewayAgentVisible: ensureOpenClawGatewayAgentVisibleMock,
    ensureOpenClawLocalBootstrap: ensureOpenClawLocalBootstrapMock,
  };
});

import { mergeOpenClawGatewayVisibility } from "@openmeld/local-service";
import { resolveDispatchRuntimeEnvOverrides } from "../src/local-service/execution/dispatch-runtime-preparation";
import { resolveOpenClawLocalBootstrapPaths } from "../src/provider-hosts/openclaw/local-bootstrap-store";

function createDeliveryExecutionIdentity(agentControllerRef: string) {
  return {
    authority: "core_runtime_registry_binding_route" as const,
    core: {
      modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      spaceId: "space-1",
      dispatchId: "dispatch-1",
      targetProfileId: "agt_demo",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime-1",
      },
      bindingId: "binding-1",
      agentControllerRef,
    },
  };
}

function createParsedDispatchTask(agentControllerRef: string) {
  return {
    attemptId: "attempt-1",
    contextIdMappingSpec: {
      mappingVersion: 1,
      sourceField: "OPENCLAW_SESSION_ID",
    },
    agentControllerRef,
    continuitySnapshot: null,
    agentControllerConversationId: null,
    deliveryRecoveryReason: null,
    dispatchId: "dispatch-1",
    runtimeCoordinatorExecutionId: "rce_space-1_dispatch-1_agt_demo",
    mentionSourceProfileId: null,
    executionIdentity: createDeliveryExecutionIdentity(agentControllerRef),
    executionTokenEcho: {
      executionToken:
        "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run-1",
      runtimeCoordinatorExecutionId: "rce_space-1_dispatch-1_agt_demo",
      tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    mentionSourceProfileKind: null,
    mentionSourceProfileMentionLabel: null,
    prompt: "hello",
    replyToSnapshot: null,
    sequence: 1,
    sourceEventId: "signal-1",
    sourceMessageEnvelope: null,
    dispatchTriggerSource: "activation_targets",
    recipientExplicitlyAddressedByActivationTargets: false,
    spaceContractSnapshot: null,
    spaceId: "space-1",
    spaceNameSnapshot: "Ops Room",
    spacePassword: null,
    streamingMode: "final",
    targetProfileId: "agt_demo",
    targetProfileMentionLabel: "demo-bot",
    targetProfileName: null,
    taskId: "task-1",
    threadContext: null,
    transportMode: "local-cli",
    triggerMode: "mention_only",
  } as const;
}

describe("dispatch OpenClaw bootstrap preflight", () => {
  beforeEach(() => {
    ensureOpenClawGatewayAgentVisibleMock.mockReset();
    ensureOpenClawLocalBootstrapMock.mockReset();
    ensureOpenClawGatewayAgentVisibleMock.mockResolvedValue({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: false,
      gatewayVisibility: "visible",
    });
  });

  it("injects the bootstrapped OpenClaw agent id into runtime env", async () => {
    ensureOpenClawLocalBootstrapMock.mockResolvedValue({
      agentId: "openmeld-demo-bot",
      authStatus: "copied",
      bootstrapVersion: 1,
      created: true,
      resolution: "created",
    });
    const expectedWorkspaceDir = resolveOpenClawLocalBootstrapPaths({
      openMeldProfileId: "agt_demo",
    }).workspaceDir;

    const envOverrides = await resolveDispatchRuntimeEnvOverrides({
      daemonWorkingDirectory: "/tmp/daemon-workdir",
      parsedTask: createParsedDispatchTask("builtin:openclaw"),
      profileName: "Demo Bot",
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });

    expect(envOverrides).toEqual({
      OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
    });
    expect(ensureOpenClawLocalBootstrapMock).toHaveBeenCalledWith({
      openClawBin: undefined,
      profile: {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      },
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });
    expect(ensureOpenClawGatewayAgentVisibleMock).toHaveBeenCalledWith({
      agentId: "openmeld-demo-bot",
      openClawBin: undefined,
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });
  });

  it("fails clearly when the target profile name is missing", async () => {
    await expect(
      resolveDispatchRuntimeEnvOverrides({
        daemonWorkingDirectory: "/tmp/daemon-workdir",
        parsedTask: createParsedDispatchTask("builtin:openclaw"),
        profileName: null,
        providerRuntimeWorkingDirectory: resolveOpenClawLocalBootstrapPaths({
          openMeldProfileId: "agt_demo",
        }).workspaceDir,
      })
    ).rejects.toMatchObject({
      code: "controller.bootstrap.failed",
    });
  });

  it("preserves bootstrap version mismatch details in the wrapped dispatch error", async () => {
    ensureOpenClawLocalBootstrapMock.mockRejectedValue(
      new Error(
        "OpenClaw bootstrap state version mismatch at '/tmp/bootstrap.json': expected v1, found v2"
      )
    );

    await expect(
      resolveDispatchRuntimeEnvOverrides({
        daemonWorkingDirectory: "/tmp/daemon-workdir",
        parsedTask: createParsedDispatchTask("builtin:openclaw"),
        profileName: "Demo Bot",
        providerRuntimeWorkingDirectory: resolveOpenClawLocalBootstrapPaths({
          openMeldProfileId: "agt_demo",
        }).workspaceDir,
      })
    ).rejects.toMatchObject({
      code: "controller.bootstrap.failed",
      message: expect.stringContaining("expected v1, found v2"),
    });
  });

  it("fails fast when the dispatch runtime context is invalid", async () => {
    ensureOpenClawLocalBootstrapMock.mockRejectedValue(
      Object.assign(
        new Error("invalid OpenClaw providerRuntimeWorkingDirectory"),
        {
          code: "openclaw.bootstrap.invalid_working_directory",
        }
      )
    );

    await expect(
      resolveDispatchRuntimeEnvOverrides({
        daemonWorkingDirectory: "",
        parsedTask: createParsedDispatchTask("builtin:openclaw"),
        profileName: "Demo Bot",
        providerRuntimeWorkingDirectory: "",
      })
    ).rejects.toMatchObject({
      code: "controller.runtime_context.invalid",
    });
    expect(ensureOpenClawLocalBootstrapMock).not.toHaveBeenCalled();
  });

  it("skips shared runtime preparation for non-OpenClaw controllers", async () => {
    const envOverrides = await resolveDispatchRuntimeEnvOverrides({
      daemonWorkingDirectory: "/tmp/daemon-workdir",
      parsedTask: createParsedDispatchTask("builtin:codex"),
      profileName: "Demo Bot",
    });

    expect(envOverrides).toBeUndefined();
    expect(ensureOpenClawLocalBootstrapMock).not.toHaveBeenCalled();
    expect(ensureOpenClawGatewayAgentVisibleMock).not.toHaveBeenCalled();
  });

  it("wraps gateway visibility errors as controller gateway failures", async () => {
    ensureOpenClawLocalBootstrapMock.mockResolvedValue({
      agentId: "openmeld-demo-bot",
      authStatus: "present",
      bootstrapVersion: 1,
      created: false,
      resolution: "reused",
    });
    ensureOpenClawGatewayAgentVisibleMock.mockRejectedValue(
      Object.assign(
        new Error(
          "OpenClaw gateway is running but agent 'openmeld-demo-bot' is still not visible after a gateway restart"
        ),
        {
          code: "openclaw.gateway.agent_not_visible",
          diagnostics: {
            agentId: "openmeld-demo-bot",
            gatewayRestartAttempted: true,
            gatewayVisibility: "missing_after_restart",
          },
        }
      )
    );

    await expect(
      resolveDispatchRuntimeEnvOverrides({
        daemonWorkingDirectory: "/tmp/daemon-workdir",
        parsedTask: createParsedDispatchTask("builtin:openclaw"),
        profileName: "Demo Bot",
        providerRuntimeWorkingDirectory: resolveOpenClawLocalBootstrapPaths({
          openMeldProfileId: "agt_demo",
        }).workspaceDir,
      })
    ).rejects.toMatchObject({
      code: "controller.gateway.unhealthy",
      openClawGatewayVisibility: {
        agentId: "openmeld-demo-bot",
        gatewayRestartAttempted: true,
        gatewayVisibility: "missing_after_restart",
      },
    });
  });

  it("drops malformed gateway visibility diagnostics when the enum value is unknown", async () => {
    ensureOpenClawLocalBootstrapMock.mockResolvedValue({
      agentId: "openmeld-demo-bot",
      authStatus: "present",
      bootstrapVersion: 1,
      created: false,
      resolution: "reused",
    });
    ensureOpenClawGatewayAgentVisibleMock.mockRejectedValue(
      Object.assign(
        new Error("gateway returned malformed visibility diagnostics"),
        {
          code: "openclaw.gateway.agent_not_visible",
          diagnostics: {
            agentId: "openmeld-demo-bot",
            gatewayRestartAttempted: true,
            gatewayVisibility: "visible-after-restart",
          },
        }
      )
    );

    let thrownError: unknown;
    try {
      await resolveDispatchRuntimeEnvOverrides({
        daemonWorkingDirectory: "/tmp/daemon-workdir",
        parsedTask: createParsedDispatchTask("builtin:openclaw"),
        profileName: "Demo Bot",
        providerRuntimeWorkingDirectory: resolveOpenClawLocalBootstrapPaths({
          openMeldProfileId: "agt_demo",
        }).workspaceDir,
      });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toMatchObject({
      code: "controller.gateway.unhealthy",
    });
    expect(
      (thrownError as { openClawGatewayVisibility?: unknown })
        .openClawGatewayVisibility
    ).toBeUndefined();
  });

  it("preserves earlier OpenClaw gateway visibility diagnostics on later failures", () => {
    expect(
      mergeOpenClawGatewayVisibility({
        primary: undefined,
        fallback: {
          agentId: "openmeld-demo-bot",
          gatewayRestartAttempted: false,
          gatewayVisibility: "visible",
        },
      })
    ).toEqual({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: false,
      gatewayVisibility: "visible",
    });
    expect(
      mergeOpenClawGatewayVisibility({
        primary: {
          agentId: "openmeld-demo-bot",
          gatewayRestartAttempted: true,
          gatewayVisibility: "missing_after_restart",
        },
        fallback: {
          agentId: "openmeld-demo-bot",
          gatewayRestartAttempted: false,
          gatewayVisibility: "visible",
        },
      })
    ).toEqual({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: true,
      gatewayVisibility: "missing_after_restart",
    });
  });
});
