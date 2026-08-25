import { describe, expect, it } from "vitest";
import {
  type AgentProfileBindingLookupStore,
  lookupPrimaryAgentProfileBinding,
} from "../src/agent-profile-binding/application/agent-profile-binding-lookup-service";

describe("Agent Profile Binding lookup service", () => {
  it("returns an explicit missing projection when no primary Binding exists", async () => {
    await expect(
      lookupPrimaryAgentProfileBinding({
        agentProfileId: "agent-profile-1",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
        store: createLookupStore(null),
      })
    ).resolves.toMatchObject({
      bindingState: "missing",
      dispatchReadableFacts: null,
      routable: false,
      status: "not_routable",
    });
  });

  it("maps an enabled primary Binding to dispatch-readable facts without granting claim success", async () => {
    await expect(
      lookupPrimaryAgentProfileBinding({
        agentProfileId: "agent-profile-1",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
        store: createLookupStore({
          agentProfileId: "agent-profile-1",
          bindingId: "binding_opaque_1",
          bindingState: "enabled_primary",
          agentControllerConversationId: "codex-thread-1",
          agentControllerCollaborationMode: "codex:plan",
          agentControllerRef: "builtin:codex",
          createdAtMs: 1000,
          createdByProfileId: "profile-1",
          disabledAtMs: null,
          owner: {
            id: "owner-1",
            kind: "owner_account",
          },
          reasonCode: "agent_profile_binding.command_eligible",
          openMeldServiceRuntimeId: "runtime_opaque_1",
          updatedAtMs: 1000,
        }),
      })
    ).resolves.toMatchObject({
      bindingState: "enabled_primary",
      dispatchReadableFacts: {
        bindingId: "binding_opaque_1",
        agentControllerConversationId: "codex-thread-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime_opaque_1",
        routable: true,
      },
      agentControllerConversationId: "codex-thread-1",
      agentControllerCollaborationMode: "codex:plan",
      displayProjection: {
        agentControllerCollaborationMode: "codex:plan",
      },
      grantsClaimSuccess: false,
      routable: true,
      status: "routable",
    });
  });

  it("preserves saved OpenCode permissions in the owner and dispatch projections", async () => {
    const openCodePermission = {
      bash: {
        "*": "ask" as const,
        "git status *": "allow" as const,
      },
      edit: "allow" as const,
    };

    await expect(
      lookupPrimaryAgentProfileBinding({
        agentProfileId: "agent-profile-1",
        owner: {
          id: "owner-1",
          kind: "owner_account",
        },
        store: createLookupStore({
          agentProfileId: "agent-profile-1",
          bindingId: "binding_opaque_1",
          bindingState: "enabled_primary",
          agentControllerRef: "builtin:opencode",
          createdAtMs: 1000,
          createdByProfileId: "profile-1",
          disabledAtMs: null,
          owner: {
            id: "owner-1",
            kind: "owner_account",
          },
          reasonCode: "agent_profile_binding.command_eligible",
          openCodePermission,
          openMeldServiceRuntimeId: "runtime_opaque_1",
          updatedAtMs: 1000,
        }),
      })
    ).resolves.toMatchObject({
      openCodePermission,
      displayProjection: {
        openCodePermission,
        dispatchReadableFacts: {
          openCodePermission,
        },
      },
      dispatchReadableFacts: {
        openCodePermission,
      },
    });
  });
});

function createLookupStore(
  binding: Awaited<
    ReturnType<AgentProfileBindingLookupStore["readPrimaryBinding"]>
  >
): AgentProfileBindingLookupStore {
  return {
    readPrimaryBinding: async () => binding,
  };
}
