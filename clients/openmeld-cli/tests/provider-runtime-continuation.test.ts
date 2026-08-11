import type { ConversationExecutionState } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  listRegisteredProviderSpecificContinuationAdapterIds,
  listRegistryProviderSpecificContinuationAdapterIds,
  resolveProviderRuntimeDispatchContinuation,
} from "../src/local-service/continuation/provider-runtime-continuation";

const BASE_RUNTIME_CONTEXT = {
  providerRuntimeWorkingDirectory: "/tmp/repo-a",
} as const;

const BASE_EXECUTION_STATE: ConversationExecutionState = {
  activeContextId: "ctx-1",
  agentContextLookupKey:
    "space-1|agt_demo|builtin:codex|local-cli|sha256%3Aworkspace-a",
  bootstrapLastActivatedAt: "2026-04-01T00:00:00.000Z",
  bootstrapLastAppliedAt: "2026-04-01T00:00:00.000Z",
  dispatchesSinceBootstrapApplied: 0,
  lastAppliedContentFingerprint: "sha256:abc",
  lastAppliedTemplateVersion: "template-v1",
  lastRuntimeWorkspacePath:
    BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
  runtimeWorkspaceFingerprint: "sha256:workspace-a",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const BASE_REQUEST = {
  agentControllerConversationId: "ctx-1",
  agentControllerRef: "builtin:codex",
  currentPolicy: {},
  existingContextId: "ctx-1",
  executionState: BASE_EXECUTION_STATE,
  latestKnownRuntimeWorkspaceFingerprint: "sha256:workspace-a",
  runtimeContext: BASE_RUNTIME_CONTEXT,
  runtimePreparationDetails: {
    kind: "none" as const,
  },
  spaceId: "space-1",
  spaceNameSnapshot: "Ops Room",
  transportMode: "local-cli" as const,
};

describe("provider runtime continuation", () => {
  it("returns the shared standard continuation result for standard adapters", () => {
    const result = resolveProviderRuntimeDispatchContinuation(BASE_REQUEST);

    expect(result).toEqual({
      localRuntimeContextPlan: {
        reason: null,
        status: "reuse",
      },
      taskResultProviderFacts: {},
      agentControllerConversationResumePlan: {
        status: "continue_existing",
      },
      agentControllerConversationOverride: null,
    });
  });

  it("keeps the agent controller conversation but recreates the local runtime context when the runtime workspace changed", () => {
    const result = resolveProviderRuntimeDispatchContinuation({
      ...BASE_REQUEST,
      existingContextId: null,
      executionState: null,
      latestKnownRuntimeWorkspaceFingerprint: "sha256:workspace-a",
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/repo-b",
      },
    });

    expect(result).toEqual({
      localRuntimeContextPlan: {
        reason: "workspace_changed",
        status: "recreate",
      },
      taskResultProviderFacts: {},
      agentControllerConversationResumePlan: {
        status: "continue_existing",
      },
      agentControllerConversationOverride: null,
    });
  });

  it("dispatches to the registered provider-specific continuation policy", () => {
    const openClawPolicy = vi.fn().mockReturnValue({
      localRuntimeContextPlan: {
        reason: "first_local_runtime_context",
        status: "recreate",
      },
      taskResultProviderFacts: {
        openClawBinding: {
          classification: "legacy",
        },
      },
      agentControllerConversationResumePlan: {
        status: "continue_existing",
      },
      agentControllerConversationOverride: {
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationKind: "session",
        agentControllerConversationId:
          "agent:openmeld-openclaw:openmeld-space:ops-room--abc12345",
      },
    });

    const result = resolveProviderRuntimeDispatchContinuation(
      {
        ...BASE_REQUEST,
        agentControllerConversationId: "session-legacy-openclaw-1",
        agentControllerRef: "builtin:openclaw",
        executionState: {
          ...BASE_EXECUTION_STATE,
          activeContextId: "session-legacy-openclaw-1",
        },
        runtimePreparationDetails: {
          bootstrap: {
            agentId: "openmeld-openclaw-demo",
            authStatus: "copied",
            bootstrapVersion: 1,
            created: false,
            resolution: "reused",
          },
          kind: "openclaw" as const,
          openClawGatewayVisibility: {
            agentId: "openmeld-openclaw-demo",
            gatewayRestartAttempted: false,
            gatewayVisibility: "visible",
          },
        },
      },
      {
        policies: {
          openclaw: openClawPolicy,
        },
      }
    );

    expect(openClawPolicy).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      localRuntimeContextPlan: {
        reason: "first_local_runtime_context",
        status: "recreate",
      },
      taskResultProviderFacts: {
        openClawBinding: {
          classification: "legacy",
        },
      },
      agentControllerConversationResumePlan: {
        status: "continue_existing",
      },
    });
  });

  it("fails fast when a provider-specific adapter has no registered continuation policy", () => {
    expect(() =>
      resolveProviderRuntimeDispatchContinuation(
        {
          ...BASE_REQUEST,
          agentControllerRef: "builtin:openclaw",
          runtimePreparationDetails: {
            bootstrap: {
              agentId: "openmeld-openclaw-demo",
              authStatus: "copied",
              bootstrapVersion: 1,
              created: false,
              resolution: "reused",
            },
            kind: "openclaw" as const,
            openClawGatewayVisibility: {
              agentId: "openmeld-openclaw-demo",
              gatewayRestartAttempted: false,
              gatewayVisibility: "visible",
            },
          },
        },
        {
          policies: {},
        }
      )
    ).toThrow(
      "No runtime continuation implementation is registered for adapter 'openclaw'"
    );
  });

  it("keeps provider-specific continuation policies aligned with the registry contract", () => {
    expect(listRegisteredProviderSpecificContinuationAdapterIds()).toEqual(
      listRegistryProviderSpecificContinuationAdapterIds()
    );
  });
});
