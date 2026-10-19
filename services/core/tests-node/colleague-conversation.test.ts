import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";

const feature = vi.hoisted(() => ({ enforced: true }));
vi.mock("../src/member-agent/member-agents-feature", async (original) => ({
  ...(await original<
    typeof import("../src/member-agent/member-agents-feature")
  >()),
  isRequestChainEnforced: () => feature.enforced,
}));
const owner = vi.hoisted(() => ({ rooted: false }));
vi.mock("../src/dispatch/application/accepted-dispatch-snapshot", () => ({
  isDispatchRequestedByAgentOwner: async () => owner.rooted,
}));

const { usesSeparateColleagueConversation } = await import(
  "../src/dispatch/application/colleague-conversation"
);

const message = {} as OpenMeldDaemonDispatchQueueMessage;
const decide = (overrides: {
  agentControllerRef?: string;
  message?: OpenMeldDaemonDispatchQueueMessage;
  requesterIsAgentOwner?: boolean;
}) =>
  usesSeparateColleagueConversation({
    agentControllerRef: "builtin:opencode",
    env: {} as never,
    message,
    targetOwnerUserId: "felix",
    ...overrides,
  });

describe("A colleague's conversation on a harness without Sessions (§4.3)", () => {
  it("keeps a colleague-rooted Wake off the Binding conversation", async () => {
    await expect(decide({ requesterIsAgentOwner: false })).resolves.toBe(true);
    // Without delivery context the root is read from the request chain.
    owner.rooted = false;
    await expect(decide({})).resolves.toBe(true);
  });

  it("leaves owner-rooted Wakes on the Binding conversation", async () => {
    await expect(decide({ requesterIsAgentOwner: true })).resolves.toBe(false);
    owner.rooted = true;
    await expect(decide({})).resolves.toBe(false);
    owner.rooted = false;
  });

  it("leaves harnesses with Sessions and assigned Sessions alone", async () => {
    await expect(
      decide({
        agentControllerRef: "builtin:codex",
        requesterIsAgentOwner: false,
      })
    ).resolves.toBe(false);
    await expect(
      decide({
        message: {
          executionContext: { id: "ctx" },
        } as unknown as OpenMeldDaemonDispatchQueueMessage,
        requesterIsAgentOwner: false,
      })
    ).resolves.toBe(false);
  });

  it("changes nothing until the request chain is enforced", async () => {
    feature.enforced = false;
    try {
      await expect(decide({ requesterIsAgentOwner: false })).resolves.toBe(
        false
      );
    } finally {
      feature.enforced = true;
    }
  });
});
