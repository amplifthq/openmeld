import type { SignalEnvelope } from "@openmeld/protocol";
import type { RequestChain } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const feature = vi.hoisted(() => ({ enforced: false }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enforced,
  isRequestChainEnforced: () => feature.enforced,
}));

const { resolveDispatchOutboxRequestChain, withHostedReplyRequestChainBasis } =
  await import("../src/space/application/dispatch-outbox-request-chain");

const TALI = "human-tali";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

function signal(kind: "agent" | "human" | "system", profileId: string) {
  // Only the author fields the resolver reads.
  return { id: "signal-1", profile: { kind, profileId } } as SignalEnvelope;
}

const internal = {
  audience: "organization",
  relationship: "internal",
  spaceRole: "member",
} as const;

afterEach(() => {
  feature.enforced = false;
  vi.restoreAllMocks();
});

describe("Space outbox seed request chain (each producer)", () => {
  it("person's post, mention or Direct Message: rooted at that person", () => {
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: internal,
        signal: signal("human", TALI),
        targetProfileId: AGENT_A,
      })
    ).toEqual([
      { kind: "human", profileId: TALI },
      { kind: "agent", profileId: AGENT_A },
    ]);
  });

  it("plugin continuation: posted as the original requester, rooted there", () => {
    // plugin-connection-continuation.ts and plugin-channel-continuation.ts
    // publish as the verified human requester with no extra basis.
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "external" },
        signal: signal("human", TALI),
        targetProfileId: AGENT_A,
      })?.[0]
    ).toEqual({ kind: "human", profileId: TALI });
  });

  it("Routine run: creator root followed by the Routine marker", () => {
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: internal,
        signal: signal("human", TALI),
        signalContext: {
          requestChainBasis: {
            kind: "source",
            source: "routine",
            sourceId: "routine-1",
          },
        },
        targetProfileId: AGENT_A,
      })
    ).toEqual([
      { kind: "human", profileId: TALI },
      { kind: "source", source: "routine", sourceId: "routine-1" },
      { kind: "agent", profileId: AGENT_A },
    ]);
  });

  it("Agent reply inside its Wake: appends to the parent chain", () => {
    const parent: RequestChain = [
      { kind: "human", profileId: TALI },
      { kind: "agent", profileId: AGENT_A },
    ];
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "agent" },
        signal: signal("agent", AGENT_A),
        signalContext: {
          requestChainBasis: { kind: "parent", requestChain: parent },
        },
        targetProfileId: AGENT_B,
      })
    ).toEqual([...parent, { kind: "agent", profileId: AGENT_B }]);
  });

  it("Center Agent or unverified Agent post: left to Core admission", () => {
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "agent" },
        signal: signal("agent", "agent-center"),
        targetProfileId: AGENT_A,
      })
    ).toBeUndefined();
  });

  it("before enforcement, a rejected chain is not written and the Wake proceeds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "anonymous" },
        signal: signal("human", "anonymous-visitor"),
        targetProfileId: AGENT_A,
      })
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[core.space.request_chain_not_written]",
      expect.objectContaining({
        reasonCode: "request_chain.anonymous_requester",
      })
    );
  });

  it("once enforced, an anonymous author cannot Wake an Agent", () => {
    feature.enforced = true;
    expect(() =>
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "anonymous" },
        signal: signal("human", "anonymous-visitor"),
        targetProfileId: AGENT_A,
      })
    ).toThrow(
      expect.objectContaining({
        code: "request_chain.anonymous_requester",
        status: 403,
      })
    );
  });

  it("once enforced, a parent chain the author is not in blocks the Wake", () => {
    feature.enforced = true;
    expect(() =>
      resolveDispatchOutboxRequestChain({
        callerContext: { ...internal, relationship: "agent" },
        signal: signal("agent", AGENT_B),
        signalContext: {
          requestChainBasis: {
            kind: "parent",
            requestChain: [
              { kind: "human", profileId: TALI },
              { kind: "agent", profileId: AGENT_A },
            ],
          },
        },
        targetProfileId: AGENT_A,
      })
    ).toThrow(
      expect.objectContaining({ code: "request_chain.parent_mismatch" })
    );
  });
});

describe("hosted Agent reply request chain basis", () => {
  const wakeChain: RequestChain = [
    { kind: "human", profileId: TALI },
    { kind: "agent", profileId: "agent-center" },
  ];
  function reply(meta: Record<string, unknown>) {
    return {
      data: { meta },
      id: "reply-1",
      profile: { kind: "agent", profileId: "agent-center" },
      type: "signal.text",
    } as unknown as SignalEnvelope;
  }
  const readWake = (dispatchId: string) =>
    dispatchId === "dispatch-1"
      ? { requestChain: wakeChain, targetProfileId: "agent-center" }
      : null;

  it("continues the chain of the Wake the hosted Agent answers", () => {
    expect(
      withHostedReplyRequestChainBasis({
        readWake,
        signal: reply({
          dispatchId: "dispatch-1",
          targetProfileId: "agent-center",
        }),
        signalContext: {
          finalOutcomeAuthority: "remote_agent_native_delivery",
        },
      })?.requestChainBasis
    ).toEqual({ kind: "parent", requestChain: wakeChain });
  });

  it("ignores replies without the Core-set native authority or for another Wake", () => {
    for (const [meta, signalContext] of [
      [{ dispatchId: "dispatch-1", targetProfileId: "agent-center" }, {}],
      [
        { dispatchId: "dispatch-1", targetProfileId: "agent-other" },
        { finalOutcomeAuthority: "remote_agent_native_delivery" as const },
      ],
      [
        { dispatchId: "dispatch-unknown", targetProfileId: "agent-center" },
        { finalOutcomeAuthority: "remote_agent_native_delivery" as const },
      ],
    ] as const) {
      expect(
        withHostedReplyRequestChainBasis({
          readWake,
          signal: reply(meta),
          signalContext,
        })?.requestChainBasis
      ).toBeUndefined();
    }
  });

  it("resolves a personal Remote Agent's Wake to that Wake's chain", () => {
    const agentSignal = {
      data: {},
      id: "wake-1",
      profile: { kind: "agent", profileId: "agent-center" },
      type: "signal.text",
    } as unknown as SignalEnvelope;
    expect(
      withHostedReplyRequestChainBasis({
        readWake,
        signal: agentSignal,
        signalContext: {
          requestChainBasis: { kind: "wake", dispatchId: "dispatch-1" },
        },
      })?.requestChainBasis
    ).toEqual({ kind: "parent", requestChain: wakeChain });
    // A Wake this Space does not hold leaves no basis behind.
    expect(
      withHostedReplyRequestChainBasis({
        readWake,
        signal: agentSignal,
        signalContext: {
          requestChainBasis: { kind: "wake", dispatchId: "dispatch-unknown" },
        },
      })?.requestChainBasis
    ).toBeUndefined();
  });
});
