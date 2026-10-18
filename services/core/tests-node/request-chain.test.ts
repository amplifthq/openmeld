import {
  REQUEST_CHAIN_MAX_AGENTS,
  requestChainSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  RequestChain,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  planDispatchRequestChain,
  type ResolveAdmittedRequestChainDeps,
  resolveAdmittedRequestChain,
} from "../src/request-chain/dispatch-request-chain";
import {
  appendRequestChainAgent,
  readRequestChainRootProfileId,
  startRequestChain,
} from "../src/request-chain/request-chain";

const TALI = "human-tali";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const CENTER = "agent-center";

function chainOf(...agents: string[]): RequestChain {
  return [
    { kind: "human", profileId: TALI },
    ...agents.map((profileId) => ({ kind: "agent" as const, profileId })),
  ];
}

function deps(
  overrides: Partial<ResolveAdmittedRequestChainDeps> = {}
): ResolveAdmittedRequestChainDeps {
  return {
    isActiveMemberProfile: vi.fn(() => Promise.resolve(true)),
    readCenterAgentWakeAttribution: vi.fn(() => Promise.resolve(null)),
    readNativeDeliveryRoot: vi.fn(() =>
      Promise.resolve({
        onBehalfOfProfileId: TALI,
        onBehalfOfUserId: "user-tali",
        organizationId: "org-1",
        profileId: CENTER,
      })
    ),
    ...overrides,
  };
}

function message(
  fields: Partial<OpenMeldDaemonDispatchQueueMessage>
): OpenMeldDaemonDispatchQueueMessage {
  // Only the fields the resolver reads.
  return {
    organizationId: "org-1",
    spaceId: "space-1",
    targetProfileId: AGENT_B,
    ...fields,
  } as OpenMeldDaemonDispatchQueueMessage;
}

describe("request chain", () => {
  it("starts at the human root and keeps an optional Routine marker next", () => {
    expect(
      startRequestChain({
        rootProfileId: TALI,
        source: { source: "routine", sourceId: "routine-1" },
      })
    ).toEqual([
      { kind: "human", profileId: TALI },
      { kind: "source", source: "routine", sourceId: "routine-1" },
    ]);
  });

  it("rejects chains without a human root, with two roots, or a repeated Agent", () => {
    for (const chain of [
      [{ kind: "agent", profileId: AGENT_A }],
      [
        { kind: "human", profileId: TALI },
        { kind: "human", profileId: "human-felix" },
      ],
      [...chainOf(AGENT_A), { kind: "agent", profileId: AGENT_A }],
      [
        ...chainOf(AGENT_A),
        { kind: "source", source: "routine", sourceId: "routine-1" },
      ],
    ]) {
      expect(requestChainSchema.safeParse(chain).success).toBe(false);
    }
  });

  it("never blocks a conversational loop: A → B → A keeps the chain", () => {
    const toB = appendRequestChainAgent({
      agentProfileId: AGENT_B,
      chain: chainOf(AGENT_A),
      hop: "conversational",
    });
    expect(toB).toEqual({ ok: true, chain: chainOf(AGENT_A, AGENT_B) });
    let chain = chainOf(AGENT_A, AGENT_B);
    for (let round = 0; round < 1000; round += 1) {
      const next = appendRequestChainAgent({
        agentProfileId: round % 2 === 0 ? AGENT_A : AGENT_B,
        chain,
        hop: "conversational",
      });
      if (!next.ok) {
        throw new Error(next.reasonCode);
      }
      chain = next.chain;
    }
    expect(chain).toEqual(chainOf(AGENT_A, AGENT_B));
  });

  it("rejects delegated work back to an Agent that delegated it", () => {
    expect(
      appendRequestChainAgent({
        agentProfileId: AGENT_A,
        chain: chainOf(AGENT_A, AGENT_B),
        hop: "delegated",
      })
    ).toEqual({ ok: false, reasonCode: "request_chain.delegation_reentry" });
    expect(
      appendRequestChainAgent({
        agentProfileId: "agent-c",
        chain: chainOf(AGENT_A, AGENT_B),
        hop: "delegated",
      })
    ).toMatchObject({ ok: true });
  });

  it("caps depth at the visited-list ceiling, never below it", () => {
    const agents = Array.from(
      { length: REQUEST_CHAIN_MAX_AGENTS - 1 },
      (_, index) => `agent-${index}`
    );
    const last = appendRequestChainAgent({
      agentProfileId: "agent-last",
      chain: chainOf(...agents),
      hop: "conversational",
    });
    expect(last.ok).toBe(true);
    if (!last.ok) {
      return;
    }
    expect(requestChainSchema.safeParse(last.chain).success).toBe(true);
    expect(
      appendRequestChainAgent({
        agentProfileId: "agent-one-too-many",
        chain: last.chain,
        hop: "conversational",
      })
    ).toEqual({ ok: false, reasonCode: "request_chain.depth_exceeded" });
    // A revisit at the cap is still a conversational loop, not a new Agent.
    expect(
      appendRequestChainAgent({
        agentProfileId: "agent-0",
        chain: last.chain,
        hop: "conversational",
      })
    ).toEqual({ ok: true, chain: last.chain });
  });
});

describe("planDispatchRequestChain (Space outbox seed)", () => {
  it("roots a person's message at that person, internal or identified external", () => {
    for (const relationship of ["internal", "external"] as const) {
      expect(
        planDispatchRequestChain({
          author: { kind: "human", profileId: TALI },
          relationship,
          targetProfileId: AGENT_A,
        })
      ).toEqual({ ok: true, chain: chainOf(AGENT_A) });
    }
  });

  it("rejects an anonymous author at the entrance", () => {
    expect(
      planDispatchRequestChain({
        author: { kind: "human", profileId: "anon" },
        relationship: "anonymous",
        targetProfileId: AGENT_A,
      })
    ).toEqual({ ok: false, reasonCode: "request_chain.anonymous_requester" });
  });

  it("marks a Routine run after its creator", () => {
    expect(
      planDispatchRequestChain({
        author: { kind: "human", profileId: TALI },
        basis: { kind: "source", source: "routine", sourceId: "routine-1" },
        relationship: "internal",
        targetProfileId: AGENT_A,
      })
    ).toEqual({
      ok: true,
      chain: [
        { kind: "human", profileId: TALI },
        { kind: "source", source: "routine", sourceId: "routine-1" },
        { kind: "agent", profileId: AGENT_A },
      ],
    });
  });

  it("appends to the server-held chain of the Wake an Agent replies in", () => {
    expect(
      planDispatchRequestChain({
        author: { kind: "agent", profileId: AGENT_A },
        basis: { kind: "parent", requestChain: chainOf(AGENT_A) },
        targetProfileId: AGENT_B,
      })
    ).toEqual({ ok: true, chain: chainOf(AGENT_A, AGENT_B) });
    expect(
      planDispatchRequestChain({
        author: { kind: "agent", profileId: AGENT_B },
        basis: { kind: "parent", requestChain: chainOf(AGENT_A, AGENT_B) },
        targetProfileId: AGENT_A,
      })
    ).toEqual({ ok: true, chain: chainOf(AGENT_A, AGENT_B) });
  });

  it("refuses a parent chain the authoring Agent is not part of", () => {
    expect(
      planDispatchRequestChain({
        author: { kind: "agent", profileId: AGENT_B },
        basis: { kind: "parent", requestChain: chainOf(AGENT_A) },
        targetProfileId: AGENT_A,
      })
    ).toEqual({ ok: false, reasonCode: "request_chain.parent_mismatch" });
  });

  it("defers an Agent or system author without a trusted basis to admission", () => {
    for (const kind of ["agent", "system"] as const) {
      expect(
        planDispatchRequestChain({
          author: { kind, profileId: CENTER },
          targetProfileId: AGENT_A,
        })
      ).toEqual({ ok: "deferred" });
    }
  });
});

describe("resolveAdmittedRequestChain (Core admission)", () => {
  it("keeps the chain the Space wrote", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps(),
        message: message({ requestChain: chainOf(AGENT_A, AGENT_B) }),
      })
    ).resolves.toEqual({ ok: true, chain: chainOf(AGENT_A, AGENT_B) });
  });

  it("rejects a written chain that does not include the target", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps(),
        message: message({ requestChain: chainOf(AGENT_A) }),
      })
    ).resolves.toEqual({ ok: false, reasonCode: "request_chain.invalid" });
  });

  it("derives a person-rooted chain for a seed from before the Space wrote one", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps(),
        message: message({
          sourceSignalSnapshot: {
            profileId: TALI,
            profileKind: "human",
            text: "hi",
          },
        }),
      })
    ).resolves.toEqual({ ok: true, chain: chainOf(AGENT_B) });
  });

  it("roots a Center Agent delegation at the member it acted for", async () => {
    const readCenterAgentWakeAttribution = vi.fn(() =>
      Promise.resolve({
        actorProfileId: CENTER,
        onBehalfOfProfileId: TALI,
        organizationId: "org-1",
        resourceId: "space-1",
        resourceType: "space",
        sourceNativeDeliveryId: "delivery-1",
      })
    );
    await expect(
      resolveAdmittedRequestChain({
        deps: deps({ readCenterAgentWakeAttribution }),
        message: message({
          sourceClientMessageId: "ca-wake:abc",
          sourceSignalSnapshot: {
            profileId: CENTER,
            profileKind: "agent",
            text: "hi",
          },
        }),
      })
    ).resolves.toEqual({ ok: true, chain: chainOf(CENTER, AGENT_B) });
    expect(readCenterAgentWakeAttribution).toHaveBeenCalledWith({
      clientMessageId: "ca-wake:abc",
    });
  });

  it("finds no root for a Center Agent Wake whose attribution does not match", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps({
          readCenterAgentWakeAttribution: () =>
            Promise.resolve({
              actorProfileId: CENTER,
              onBehalfOfProfileId: TALI,
              organizationId: "org-1",
              resourceId: "another-space",
              resourceType: "space",
              sourceNativeDeliveryId: "delivery-1",
            }),
        }),
        message: message({
          sourceClientMessageId: "ca-wake:abc",
          sourceSignalSnapshot: {
            profileId: CENTER,
            profileKind: "agent",
            text: "hi",
          },
        }),
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "request_chain.root_required",
    });
  });

  it("finds no root when the attribution names someone other than the turn's member", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps({
          readCenterAgentWakeAttribution: () =>
            Promise.resolve({
              actorProfileId: CENTER,
              onBehalfOfProfileId: "human-felix",
              organizationId: "org-1",
              resourceId: "space-1",
              resourceType: "space",
              sourceNativeDeliveryId: "delivery-1",
            }),
        }),
        message: message({
          sourceClientMessageId: "ca-wake:abc",
          sourceSignalSnapshot: {
            profileId: CENTER,
            profileKind: "agent",
            text: "hi",
          },
        }),
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "request_chain.root_required",
    });
  });

  it("finds no root for an Agent message without a server-held chain", async () => {
    await expect(
      resolveAdmittedRequestChain({
        deps: deps(),
        message: message({
          sourceClientMessageId: "client-1",
          sourceSignalSnapshot: {
            profileId: AGENT_A,
            profileKind: "agent",
            text: "hi",
          },
        }),
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "request_chain.root_required",
    });
  });

  it("stops a Routine Wake whose creator left the Organization", async () => {
    const routineChain: RequestChain = [
      { kind: "human", profileId: TALI },
      { kind: "source", source: "routine", sourceId: "routine-1" },
      { kind: "agent", profileId: AGENT_B },
    ];
    const isActiveMemberProfile = vi.fn(() => Promise.resolve(false));
    await expect(
      resolveAdmittedRequestChain({
        deps: deps({ isActiveMemberProfile }),
        message: message({ requestChain: routineChain }),
      })
    ).resolves.toEqual({
      ok: false,
      reasonCode: "request_chain.root_unavailable",
    });
    expect(isActiveMemberProfile).toHaveBeenCalledWith({
      organizationId: "org-1",
      profileId: TALI,
    });
    await expect(
      resolveAdmittedRequestChain({
        deps: deps(),
        message: message({ requestChain: routineChain }),
      })
    ).resolves.toEqual({ ok: true, chain: routineChain });
  });

  it("reads the root as the first entry", () => {
    expect(readRequestChainRootProfileId(chainOf(AGENT_A))).toBe(TALI);
  });
});
