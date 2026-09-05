import { describe, expect, it } from "vitest";
import {
  buildExpectedRoutesProjection,
  buildUnresolvedExpectedRoutesResponse,
  type ExpectedRouteProfileFact,
} from "../agent-profile-binding/application/expected-routes-projection";
import type { AgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";

const RUNTIME_ID = "runtime-this-device";

function createBinding(
  input: Partial<AgentProfileBindingRecord> & { agentProfileId: string }
): AgentProfileBindingRecord {
  return {
    agentControllerConversationId: null,
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: RUNTIME_ID,
    bindingId: `bind-${input.agentProfileId}`,
    bindingState: "enabled_primary",
    createdAtMs: 1,
    createdByProfileId: null,
    disabledAtMs: null,
    owner: { id: "owner-1", kind: "owner_account" },
    reasonCode: null,
    agentControllerCollaborationMode: null,
    agentControllerPermissionMode: null,
    updatedAtMs: 1,
    ...input,
    configurationRevision: input.configurationRevision ?? 1,
  };
}

const activeAgentFact: ExpectedRouteProfileFact = {
  defaultProjectId: null,
  profileKind: "agent",
  profileName: "Codex Agent",
  status: "active",
};

describe("expected routes projection", () => {
  it("includes only active agent profiles bound to this runtime", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({ agentProfileId: "agt-here" }),
        createBinding({
          agentProfileId: "agt-elsewhere",
          openMeldServiceRuntimeId: "runtime-other-device",
        }),
        createBinding({ agentProfileId: "agt-disabled-profile" }),
        createBinding({ agentProfileId: "agt-unresolvable" }),
      ],
      profileFactByProfileId: new Map([
        ["agt-here", activeAgentFact],
        ["agt-disabled-profile", { ...activeAgentFact, status: "disabled" }],
        ["agt-unresolvable", null],
      ]),
    });

    expect(projection.expectedRoutes).toEqual([
      {
        agentProfileId: "agt-here",
        bindingId: "bind-agt-here",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: RUNTIME_ID,
        },
        agentControllerPermissionMode: "codex:askForApproval",
        profileName: "Codex Agent",
        reasonCodes: [],
        routable: true,
      },
    ]);
    expect(projection.excludedProfiles).toEqual([
      {
        agentProfileId: "agt-disabled-profile",
        reasonCode: "profile.inactive",
      },
      {
        agentProfileId: "agt-elsewhere",
        reasonCode: "binding.other_runtime",
      },
      {
        agentProfileId: "agt-unresolvable",
        reasonCode: "profile.inactive",
      },
    ]);
  });

  it("keeps the execution conversation id when present", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-conv",
          agentControllerConversationId: "conv-1",
        }),
      ],
      profileFactByProfileId: new Map([["agt-conv", activeAgentFact]]),
    });

    expect(
      projection.expectedRoutes[0]?.executionTarget
        .agentControllerConversationId
    ).toBe("conv-1");
  });

  it("carries the binding configuration revision to the local route", () => {
    const binding = {
      ...createBinding({
        agentProfileId: "agt-versioned",
      }),
      configurationRevision: 7,
    } as AgentProfileBindingRecord;
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [binding],
      includeConfigurationRevision: true,
      profileFactByProfileId: new Map([["agt-versioned", activeAgentFact]]),
    });

    expect(projection.expectedRoutes[0]).toMatchObject({
      agentProfileId: "agt-versioned",
      configurationRevision: 7,
    });
  });

  it("carries the current Default Project identity only for v4 consumers", () => {
    const profileFact = {
      ...activeAgentFact,
      defaultProjectId: "project-1",
    };
    const current = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [createBinding({ agentProfileId: "agt-project" })],
      includeConfigurationRevision: true,
      includeDefaultProjectId: true,
      profileFactByProfileId: new Map([["agt-project", profileFact]]),
    });
    const legacy = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [createBinding({ agentProfileId: "agt-project" })],
      includeConfigurationRevision: true,
      profileFactByProfileId: new Map([["agt-project", profileFact]]),
    });

    expect(current.expectedRoutes[0]).toMatchObject({
      configurationRevision: 1,
      defaultProjectId: "project-1",
    });
    expect(legacy.expectedRoutes[0]).not.toHaveProperty("defaultProjectId");
  });

  it("omits invalid stored Agent Controller Permission Mode", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-invalid-policy",
          agentControllerPermissionMode: "auto-edit",
        }),
      ],
      profileFactByProfileId: new Map([
        ["agt-invalid-policy", activeAgentFact],
      ]),
    });

    expect(projection.expectedRoutes[0]).not.toHaveProperty(
      "agentControllerPermissionMode"
    );
  });

  it("carries explicit Agent Controller Permission Mode for expected routes", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-trusted",
          agentControllerPermissionMode: "codex:approveForMe",
        }),
      ],
      profileFactByProfileId: new Map([["agt-trusted", activeAgentFact]]),
    });

    expect(projection.expectedRoutes[0]?.agentControllerPermissionMode).toBe(
      "codex:approveForMe"
    );
  });

  it("carries explicit Codex Collaboration Mode for expected routes", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-plan",
          agentControllerCollaborationMode: "codex:plan",
        }),
      ],
      includeAgentControllerCollaborationMode: true,
      profileFactByProfileId: new Map([["agt-plan", activeAgentFact]]),
    });

    expect(projection.expectedRoutes[0]?.agentControllerCollaborationMode).toBe(
      "codex:plan"
    );
  });

  it("keeps the v1 expected-routes shape stable for older local services", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-plan",
          agentControllerCollaborationMode: "codex:plan",
        }),
      ],
      profileFactByProfileId: new Map([["agt-plan", activeAgentFact]]),
    });

    expect(projection.expectedRoutes[0]).not.toHaveProperty(
      "agentControllerCollaborationMode"
    );
  });

  it("carries OpenCode permissions only for OpenCode expected routes", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [
        createBinding({
          agentProfileId: "agt-opencode",
          agentControllerRef: "builtin:opencode",
          openCodePermission: {
            bash: {
              "*": "deny",
              "git status *": "allow",
            },
            edit: "ask",
          },
        }),
        createBinding({
          agentProfileId: "agt-codex",
          openCodePermission: {
            edit: "ask",
          },
        }),
      ],
      profileFactByProfileId: new Map([
        ["agt-opencode", activeAgentFact],
        ["agt-codex", activeAgentFact],
      ]),
    });

    expect(projection.expectedRoutes).toHaveLength(2);
    expect(projection.expectedRoutes[0]).not.toHaveProperty(
      "openCodePermission"
    );
    expect(projection.expectedRoutes[1]?.openCodePermission).toEqual({
      bash: {
        "*": "deny",
        "git status *": "allow",
      },
      edit: "ask",
    });
  });

  it("expresses missing/conflict runtime resolution as empty device-level responses", () => {
    for (const runtimeResolution of ["missing", "conflict"] as const) {
      const response = buildUnresolvedExpectedRoutesResponse({
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution,
      });
      expect(response).toEqual({
        openMeldServiceRuntimeId: null,
        excludedProfiles: [],
        expectedRoutes: [],
        generatedAt: "2026-06-12T00:00:00.000Z",
        runtimeResolution,
      });
    }
  });

  it("excludes non-agent profile kinds even when active", () => {
    const projection = buildExpectedRoutesProjection({
      openMeldServiceRuntimeId: RUNTIME_ID,
      bindings: [createBinding({ agentProfileId: "hum-owner" })],
      profileFactByProfileId: new Map([
        ["hum-owner", { ...activeAgentFact, profileKind: "human" }],
      ]),
    });

    expect(projection.expectedRoutes).toEqual([]);
    expect(projection.excludedProfiles).toEqual([
      { agentProfileId: "hum-owner", reasonCode: "profile.inactive" },
    ]);
  });
});
