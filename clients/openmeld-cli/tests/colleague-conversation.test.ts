import { describe, expect, it } from "vitest";
import {
  resolveColleagueLedgerScopeId,
  resolveDispatchBindingConversationId,
} from "../src/local-service/dispatch/colleague-conversation";
import { resolveOpenClawProviderRuntimeContinuation } from "../src/provider-hosts/openclaw/continuation";
import { buildOpenClawWakeSessionKey } from "../src/provider-hosts/openclaw/naming";

// member-agent-program.md §4.3: Core marks a colleague's Wake on a harness
// without Execution Contexts; the Service keeps it off the shared conversation.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const task = {
  agentControllerConversationId: "owner-conversation",
  dispatchId: "dispatch-colleague",
};

describe("A colleague's Wake marked by Core", () => {
  it("never resumes the Binding conversation and gets a valid scope of its own", () => {
    const colleague = { ...task, separateRequesterConversation: true };
    expect(resolveDispatchBindingConversationId(colleague)).toBeNull();
    const scope = resolveColleagueLedgerScopeId(colleague);
    expect(scope).toMatch(UUID);
    // Every attempt of the same Wake shares one scope; other Wakes never do.
    expect(resolveColleagueLedgerScopeId(colleague)).toBe(scope);
    expect(
      resolveColleagueLedgerScopeId({
        ...colleague,
        dispatchId: "dispatch-other",
      })
    ).not.toBe(scope);
  });

  it("uses a UUID dispatch id as the scope as is", () => {
    expect(
      resolveColleagueLedgerScopeId({
        dispatchId: "0F8FAD5B-D9CB-469F-A165-70867728950E",
        separateRequesterConversation: true,
      })
    ).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("leaves every unmarked Wake unchanged", () => {
    expect(resolveDispatchBindingConversationId(task)).toBe(
      "owner-conversation"
    );
    expect(resolveColleagueLedgerScopeId(task)).toBeUndefined();
  });

  it("gives an OpenClaw colleague Wake a session apart from the Space's", () => {
    const key = buildOpenClawWakeSessionKey({
      agentId: "openmeld-pr-reviewer",
      scopeId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
    expect(key).toBe(
      "agent:openmeld-pr-reviewer:openmeld-wake:0f8fad5b-d9cb-469f-a165-70867728950e"
    );
    expect(key).not.toContain("openmeld-space");
  });
});

describe("OpenClaw continuation for a colleague's Wake", () => {
  const openClawRequest = (separateConversationScopeId?: string) =>
    resolveOpenClawProviderRuntimeContinuation({
      agentControllerConversationId: null,
      agentControllerRef: "builtin:openclaw",
      currentPolicy: {},
      existingContextId: null,
      executionState: null,
      runtimeContext: { providerRuntimeWorkingDirectory: "/tmp/repo-a" },
      runtimePreparationDetails: {
        bootstrap: {
          agentId: "openmeld-openclaw-demo",
          authStatus: "copied",
          bootstrapVersion: 1,
          created: false,
          resolution: "reused",
        },
        kind: "openclaw",
        openClawGatewayVisibility: {
          agentId: "openmeld-openclaw-demo",
          gatewayRestartAttempted: false,
          gatewayVisibility: "visible",
        },
      },
      ...(separateConversationScopeId ? { separateConversationScopeId } : {}),
      spaceId: "space-1",
      spaceNameSnapshot: "Ops Room",
      standardAgentControllerConversationResumePlan: { status: "not_bound" },
      standardLocalRuntimeContextPlan: {
        reason: "first_local_runtime_context",
        status: "recreate",
      },
      transportMode: "local-cli",
    } as Parameters<typeof resolveOpenClawProviderRuntimeContinuation>[0])
      .agentControllerConversationOverride?.agentControllerConversationId;

  it("never rebuilds the Space's shared session for a colleague", () => {
    expect(openClawRequest()).toContain("openmeld-space");
    expect(openClawRequest("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "agent:openmeld-openclaw-demo:openmeld-wake:0f8fad5b-d9cb-469f-a165-70867728950e"
    );
  });
});
