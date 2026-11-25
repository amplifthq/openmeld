import { describe, expect, it } from "vitest";
import { resolveOpenClawProviderRuntimeContinuation } from "../src/provider-hosts/openclaw/continuation";

function openClawContinuation(input: {
  agentControllerConversationId: string | null;
  spaceId: string;
  spaceNameSnapshot: string;
}) {
  return resolveOpenClawProviderRuntimeContinuation({
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerRef: "builtin:openclaw",
    currentPolicy: {},
    existingContextId: null,
    executionState: null,
    runtimeContext: { providerRuntimeWorkingDirectory: "/tmp/repo-a" },
    runtimePreparationDetails: {
      bootstrap: {
        agentId: "openmeld-demo",
        authStatus: "copied",
        bootstrapVersion: 1,
        created: false,
        resolution: "reused",
      },
      kind: "openclaw",
      openClawGatewayVisibility: {
        agentId: "openmeld-demo",
        gatewayRestartAttempted: false,
        gatewayVisibility: "visible",
      },
    },
    spaceId: input.spaceId,
    spaceNameSnapshot: input.spaceNameSnapshot,
    standardAgentControllerConversationResumePlan: { status: "not_bound" },
    standardLocalRuntimeContextPlan: {
      reason: "first_local_runtime_context",
      status: "recreate",
    },
    transportMode: "local-cli",
  } as Parameters<typeof resolveOpenClawProviderRuntimeContinuation>[0]);
}

describe("openclaw continuation for a stored space session key", () => {
  it("derives the requesting Space's own key instead of reusing a prefix-era key that spells its v2 segment", () => {
    // Stored by the prefix-era builder for v2616263deadbeef (Space name
    // Ops). Its segment is also the v2 encoding of the short id abc, so
    // the segment alone cannot distinguish it from a current key.
    const result = openClawContinuation({
      agentControllerConversationId:
        "agent:openmeld-demo:openmeld-space:ops--v2616263",
      spaceId: "abc",
      spaceNameSnapshot: "Other",
    });

    expect(result.taskResultProviderFacts.openClawBinding?.classification).toBe(
      "legacy"
    );
    expect(
      result.agentControllerConversationOverride?.agentControllerConversationId
    ).toBe("agent:openmeld-demo:openmeld-space-v2:other--v2616263");
  });

  it("resumes a stored current-format key verbatim for its own Space", () => {
    const ownKey = "agent:openmeld-demo:openmeld-space-v2:other--v2616263";
    const result = openClawContinuation({
      agentControllerConversationId: ownKey,
      spaceId: "abc",
      spaceNameSnapshot: "Other",
    });

    expect(result.taskResultProviderFacts.openClawBinding?.classification).toBe(
      "canonical_owned"
    );
    expect(
      result.agentControllerConversationOverride?.agentControllerConversationId
    ).toBe(ownKey);
  });
});
