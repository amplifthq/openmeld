import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAgentTargetStatesMock } = vi.hoisted(() => ({
  listAgentTargetStatesMock: vi.fn(),
}));

const { resolveAgentControllerInterfaceSnapshotMock } = vi.hoisted(() => ({
  resolveAgentControllerInterfaceSnapshotMock: vi.fn(),
}));

vi.mock("../src/agents/registry", () => ({
  listAgentTargetStates: listAgentTargetStatesMock,
}));

vi.mock("../src/local-service/inventory/agent-controller-interface", () => ({
  resolveAgentControllerInterfaceSnapshot:
    resolveAgentControllerInterfaceSnapshotMock,
}));

describe("LocalAgentControllerInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects builtin local runtime launchability without owning Profile or Space truth", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        detected: true,
        displayName: "Codex",
        enabled: true,
        launchStatus: "ready",
        registered: true,
        runtimeSupported: true,
        selectable: true,
        selectableReason: null,
        targetKind: "builtin",
      },
      {
        agentId: "claude-code",
        detected: true,
        displayName: "Claude Code",
        enabled: false,
        launchStatus: "needs_choice",
        registered: false,
        runtimeSupported: true,
        selectable: true,
        selectableReason: null,
        targetKind: "builtin",
      },
      {
        agentId: "openclaw",
        detected: true,
        displayName: "OpenClaw",
        enabled: false,
        launchStatus: "not_available",
        registered: false,
        runtimeSupported: false,
        selectable: false,
        selectableReason: "not_supported_yet",
        targetKind: "builtin",
      },
      {
        agentId: "custom-agent",
        detected: true,
        displayName: "Custom Agent",
        enabled: true,
        launchStatus: "ready",
        registered: true,
        runtimeSupported: true,
        selectable: true,
        selectableReason: null,
        targetKind: "custom",
      },
    ]);

    const { collectLocalAgentControllerInventory } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    await expect(collectLocalAgentControllerInventory()).resolves.toEqual({
      capabilities: [
        expect.objectContaining({
          agentId: "codex",
          blockerReasonCodes: [],
          agentControllerRef: "builtin:codex",
          launchability: "launchable",
        }),
        expect.objectContaining({
          agentId: "claude-code",
          blockerReasonCodes: ["controller.launch.choice_required"],
          agentControllerRef: "builtin:claude-code",
          launchability: "needs_choice",
        }),
        expect.objectContaining({
          agentId: "openclaw",
          blockerReasonCodes: ["local_agent_preparation.not_supported_yet"],
          agentControllerRef: "builtin:openclaw",
          launchability: "not_supported",
        }),
      ],
    });
    expect(resolveAgentControllerInterfaceSnapshotMock).not.toHaveBeenCalled();
  });

  it("collects ACI snapshots only when explicitly requested", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      {
        agentId: "codex",
        detected: true,
        displayName: "Codex",
        enabled: true,
        installChoices: [],
        launchContract: {
          commandPath: process.execPath,
          kind: "executable",
        },
        launchStatus: "ready",
        registered: true,
        runtimeSupported: true,
        selectable: true,
        selectableReason: null,
        targetKind: "builtin",
      },
    ]);
    resolveAgentControllerInterfaceSnapshotMock.mockResolvedValue({
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
        commandPath: process.execPath,
        installChoiceCount: 0,
        status: "ready",
      },
      message: null,
      models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
      nativeInterface: "codex-app-server",
      schemaVersion: 1,
      skills: [],
      status: "ready",
      version: "0.1.0",
    });

    const { collectLocalAgentControllerInventory } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    await expect(
      collectLocalAgentControllerInventory({
        includeControllerInterface: true,
      })
    ).resolves.toEqual({
      capabilities: [
        expect.objectContaining({
          agentControllerInterface: expect.objectContaining({
            agentControllerRef: "builtin:codex",
            models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
            nativeInterface: "codex-app-server",
          }),
          agentControllerRef: "builtin:codex",
          agentId: "codex",
        }),
      ],
    });
    expect(resolveAgentControllerInterfaceSnapshotMock).toHaveBeenCalledTimes(
      1
    );
  });

  it("never starts a disabled or unregistered controller while collecting ACI snapshots", async () => {
    listAgentTargetStatesMock.mockResolvedValue([
      buildAgentTargetState({
        agentId: "codex",
        displayName: "Codex",
        enabled: true,
        registered: true,
      }),
      buildAgentTargetState({
        agentId: "claude-code",
        displayName: "Claude Code",
        enabled: false,
        registered: true,
      }),
      buildAgentTargetState({
        agentId: "opencode",
        displayName: "OpenCode",
        enabled: true,
        registered: false,
      }),
    ]);
    resolveAgentControllerInterfaceSnapshotMock.mockResolvedValue(
      agentControllerInterfaceSnapshot({
        authStatus: "authenticated",
        status: "ready",
      })
    );
    const { collectLocalAgentControllerInventory } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    const result = await collectLocalAgentControllerInventory({
      includeControllerInterface: true,
      probePolicy: "background",
    });

    expect(result.capabilities).toHaveLength(3);
    expect(result.capabilities[0]).toHaveProperty("agentControllerInterface");
    expect(result.capabilities[1]).not.toHaveProperty(
      "agentControllerInterface"
    );
    expect(result.capabilities[2]).not.toHaveProperty(
      "agentControllerInterface"
    );
    expect(resolveAgentControllerInterfaceSnapshotMock).toHaveBeenCalledTimes(
      1
    );
    expect(resolveAgentControllerInterfaceSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        probePolicy: "background",
      })
    );
  });

  it("keeps enabled-controller policy outside launchability detection", async () => {
    const { resolveLocalAgentControllerReportDecision } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );
    const launchableButDisabled = {
      blockerReasonCodes: [],
      enabled: false,
      launchability: "launchable" as const,
      selectable: true,
      selectableReason: null,
    };

    expect(
      resolveLocalAgentControllerReportDecision(launchableButDisabled, {
        requireEnabled: false,
      })
    ).toEqual({
      localParticipationState: "ready",
      reasonCodes: [],
    });
    expect(
      resolveLocalAgentControllerReportDecision(launchableButDisabled, {
        requireEnabled: true,
      })
    ).toEqual({
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["local_agent_preparation.not_enabled"],
    });
  });

  it("fails closed when ACI proves the controller account is not signed in", async () => {
    const { resolveLocalAgentControllerReportDecision } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    expect(
      resolveLocalAgentControllerReportDecision(
        {
          agentControllerInterface: agentControllerInterfaceSnapshot({
            authStatus: "unauthenticated",
            status: "error",
          }),
          blockerReasonCodes: [],
          enabled: true,
          launchability: "launchable",
          selectable: true,
          selectableReason: null,
        },
        { requireEnabled: true }
      )
    ).toEqual({
      localParticipationState: "needs_agent_prepare",
      reasonCodes: [
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ],
    });
  });

  it("keeps non-auth ACI errors separate from provider account blockers", async () => {
    const { resolveLocalAgentControllerReportDecision } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    expect(
      resolveLocalAgentControllerReportDecision(
        {
          agentControllerInterface: agentControllerInterfaceSnapshot({
            authStatus: "unknown",
            status: "error",
          }),
          blockerReasonCodes: [],
          enabled: true,
          launchability: "launchable",
          selectable: true,
          selectableReason: null,
        },
        { requireEnabled: true }
      )
    ).toEqual({
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["controller.interface.error"],
    });
  });

  it("fails closed when the current ACI check did not complete", async () => {
    const { resolveLocalAgentControllerReportDecision } = await import(
      "../src/local-service/inventory/agent-controller-inventory"
    );

    expect(
      resolveLocalAgentControllerReportDecision(
        {
          agentControllerInterface: {
            ...agentControllerInterfaceSnapshot({
              authStatus: "unknown",
              status: "unknown",
            }),
            check: {
              lastSucceededAt: "2026-06-28T00:00:00.000Z",
              status: "failed",
            },
          },
          blockerReasonCodes: [],
          enabled: true,
          launchability: "launchable",
          selectable: true,
          selectableReason: null,
        },
        { requireEnabled: true }
      )
    ).toEqual({
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["controller.interface.check_failed"],
    });
  });
});

function buildAgentTargetState(input: {
  agentId: string;
  displayName: string;
  enabled: boolean;
  registered: boolean;
}) {
  return {
    ...input,
    detected: true,
    lifecycleStatus: "active",
    launchStatus: "ready",
    runtimeSupported: true,
    selectable: true,
    selectableReason: null,
    targetKind: "builtin",
  };
}

function agentControllerInterfaceSnapshot(input: {
  authStatus: AgentControllerInterfaceSnapshot["auth"]["status"];
  status: AgentControllerInterfaceSnapshot["status"];
}): AgentControllerInterfaceSnapshot {
  return {
    agentControllerRef: "builtin:codex",
    auth: { status: input.authStatus },
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
    models: [],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: input.status,
    version: "0.1.0",
  };
}
