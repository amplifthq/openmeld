import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { collectLocalAgentControllerInventoryMock } = vi.hoisted(() => ({
  collectLocalAgentControllerInventoryMock: vi.fn(),
}));

vi.mock(
  "../src/local-service/inventory/agent-controller-inventory",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/inventory/agent-controller-inventory")
      >();
    return {
      ...actual,
      collectLocalAgentControllerInventory:
        collectLocalAgentControllerInventoryMock,
    };
  }
);

describe("local Agent Controller report resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses builtin controller ACI to avoid reporting signed-out controllers as ready", async () => {
    const agentControllerInterface = agentControllerInterfaceSnapshot({
      authStatus: "unauthenticated",
      status: "error",
    });
    collectLocalAgentControllerInventoryMock.mockResolvedValue({
      capabilities: [
        {
          agentControllerInterface,
          agentControllerRef: "builtin:codex",
          agentId: "codex",
          blockerReasonCodes: [],
          enabled: true,
          launchability: "launchable",
          selectable: true,
          selectableReason: null,
        },
      ],
    });
    const { resolveLocalAgentControllerReportInput } = await import(
      "../src/local-service/reporting/local-agent-controller-report-resolution"
    );

    await expect(
      resolveLocalAgentControllerReportInput({
        agentControllerRef: "builtin:codex",
        diagnosticProfileId: "agt-codex",
        requireEnabled: true,
      })
    ).resolves.toEqual({
      agentControllerInterface,
      agentControllerRef: "builtin:codex",
      diagnosticProfileId: "agt-codex",
      localParticipationState: "needs_agent_prepare",
      reasonCodes: [
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ],
    });
    expect(collectLocalAgentControllerInventoryMock).toHaveBeenCalledWith({
      includeControllerInterface: true,
    });
  });

  it("does not apply builtin inventory to custom controller refs", async () => {
    const { resolveLocalAgentControllerReportInput } = await import(
      "../src/local-service/reporting/local-agent-controller-report-resolution"
    );

    await expect(
      resolveLocalAgentControllerReportInput({
        agentControllerRef: "custom:research-bot",
        requireEnabled: true,
      })
    ).resolves.toEqual({
      agentControllerRef: "custom:research-bot",
      localParticipationState: "ready",
      reasonCodes: [],
    });
    expect(collectLocalAgentControllerInventoryMock).not.toHaveBeenCalled();
  });
});

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
