import {
  REQUEST_CHAIN_MAX_AGENTS,
  requestChainSchema,
} from "@openmeld/schemas";
import type { RequestChain } from "@openmeld/schemas/types";

// Contract: developing/architecture/agent-transport-contract.md (Request Chain).
// Core is the only writer. Propagation appends; nothing edits an entry.

export type RequestChainRejectionReason =
  | "request_chain.anonymous_requester"
  | "request_chain.delegation_reentry"
  | "request_chain.depth_exceeded"
  | "request_chain.invalid"
  | "request_chain.parent_mismatch"
  | "request_chain.root_required"
  | "request_chain.root_unavailable";

export type RequestChainResult =
  | { ok: true; chain: RequestChain }
  | { ok: false; reasonCode: RequestChainRejectionReason };

/**
 * How the Wake reaches its target. Conversational auto-relay is never
 * hard-blocked (Auto-Relay Loop Policy); only delegated work rejects an Agent
 * that already delegated to it.
 */
export type RequestChainHop = "conversational" | "delegated";

export function startRequestChain(input: {
  rootProfileId: string;
  source?: { source: "routine"; sourceId: string };
}): RequestChain {
  return requestChainSchema.parse([
    { kind: "human", profileId: input.rootProfileId },
    ...(input.source ? [{ kind: "source" as const, ...input.source }] : []),
  ]);
}

/**
 * Appends the Agent this Wake targets. A conversational revisit keeps the
 * chain unchanged, so a loop of any length never grows it.
 */
export function appendRequestChainAgent(input: {
  agentProfileId: string;
  chain: RequestChain;
  hop: RequestChainHop;
}): RequestChainResult {
  const present = input.chain.some(
    (entry) =>
      entry.kind === "agent" && entry.profileId === input.agentProfileId
  );
  if (present) {
    return input.hop === "delegated"
      ? { ok: false, reasonCode: "request_chain.delegation_reentry" }
      : { ok: true, chain: input.chain };
  }
  if (countRequestChainAgents(input.chain) >= REQUEST_CHAIN_MAX_AGENTS) {
    return { ok: false, reasonCode: "request_chain.depth_exceeded" };
  }
  return {
    ok: true,
    chain: [...input.chain, { kind: "agent", profileId: input.agentProfileId }],
  };
}

export function readRequestChainRootProfileId(chain: RequestChain): string {
  const root = chain[0];
  if (root?.kind !== "human") {
    throw new Error("request_chain.invalid");
  }
  return root.profileId;
}

/** The parsed chain, or null for anything that is not a valid chain. */
export function parseRequestChain(value: unknown): RequestChain | null {
  const parsed = requestChainSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether `agentProfileId` is in the chain. A Wake's chain always includes its
 * target; after a conversational revisit the target may not be the last entry.
 */
export function requestChainIncludesAgent(
  chain: RequestChain,
  agentProfileId: string
): boolean {
  return chain.some(
    (entry) => entry.kind === "agent" && entry.profileId === agentProfileId
  );
}

function countRequestChainAgents(chain: RequestChain): number {
  return chain.filter((entry) => entry.kind === "agent").length;
}
