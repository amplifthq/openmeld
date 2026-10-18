import type { SignalEnvelope } from "@openmeld/protocol";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { isRequestChainEnforced } from "../../member-agent/member-agents-feature";
import { planDispatchRequestChain } from "../../request-chain/dispatch-request-chain";
import type { RequestChainRejectionReason } from "../../request-chain/request-chain";
import { SpaceSignalAuthoringError } from "./space-signal-service";
import type { SignalPublishContext } from "./types";

const REQUEST_CHAIN_REJECTION_MESSAGES: Record<
  Exclude<RequestChainRejectionReason, "request_chain.root_required">,
  string
> = {
  "request_chain.anonymous_requester": "Sign in to OpenMeld to wake an Agent.",
  "request_chain.delegation_reentry":
    "This Agent already handed this work off, so it can't take it back.",
  "request_chain.depth_exceeded":
    "Too many Agents are already working on this request to wake another one.",
  "request_chain.invalid":
    "OpenMeld couldn't confirm who asked for this work. Try again.",
  "request_chain.parent_mismatch":
    "OpenMeld couldn't confirm who asked for this work. Try again.",
  "request_chain.root_unavailable":
    "The person who asked for this work is no longer in this organization.",
};
/**
 * The request chain the Space writes on one Wake seed. Without a trusted basis
 * the seed carries none and Core admission derives it. A rejected chain blocks
 * the Wake only once the request chain is enforced.
 */
export function resolveDispatchOutboxRequestChain(input: {
  callerContext: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["callerContext"];
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  targetProfileId: string;
}): OpenMeldDaemonDispatchQueueMessage["requestChain"] {
  const plan = planDispatchRequestChain({
    author: {
      kind: input.signal.profile.kind,
      profileId: input.signal.profile.profileId,
    },
    ...(input.signalContext?.requestChainBasis
      ? { basis: input.signalContext.requestChainBasis }
      : {}),
    ...(input.callerContext
      ? { relationship: input.callerContext.relationship }
      : {}),
    targetProfileId: input.targetProfileId,
  });
  if (plan.ok === true) {
    return plan.chain;
  }
  if (plan.ok === "deferred") {
    return undefined;
  }
  if (
    isRequestChainEnforced() &&
    plan.reasonCode !== "request_chain.root_required"
  ) {
    throw new SpaceSignalAuthoringError({
      code: plan.reasonCode,
      message: REQUEST_CHAIN_REJECTION_MESSAGES[plan.reasonCode],
      status:
        plan.reasonCode === "request_chain.anonymous_requester" ? 403 : 409,
      targetProfileId: input.targetProfileId,
    });
  }
  console.warn("[core.space.request_chain_not_written]", {
    reasonCode: plan.reasonCode,
    signalId: input.signal.id,
    targetProfileId: input.targetProfileId,
  });
  return undefined;
}

/**
 * Resolves the request chain basis of a hosted Agent's signal to the chain of
 * the Wake it runs in: its final reply (Core-set native publication
 * authority) or a Wake it starts through its Space tools. The chain is read
 * from this Space's own outbox record, never from the signal.
 */
export function withHostedReplyRequestChainBasis(input: {
  readWake: (
    dispatchId: string
  ) => Pick<
    OpenMeldDaemonDispatchQueueMessage,
    "requestChain" | "targetProfileId"
  > | null;
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
}): SignalPublishContext | undefined {
  const { signal, signalContext } = input;
  const dispatchId = readHostedWakeDispatchId(signal, signalContext);
  if (dispatchId === undefined) {
    return signalContext;
  }
  const wake = dispatchId ? input.readWake(dispatchId) : null;
  if (
    !wake?.requestChain ||
    wake.targetProfileId !== signal.profile.profileId
  ) {
    // No trusted basis: the seed carries no chain and admission decides.
    const { requestChainBasis: _unresolved, ...rest } = signalContext ?? {};
    return rest;
  }
  return {
    ...signalContext,
    requestChainBasis: { kind: "parent", requestChain: wake.requestChain },
  };
}

/** Undefined: not a hosted Agent signal; null: one without a usable Wake. */
function readHostedWakeDispatchId(
  signal: SignalEnvelope,
  signalContext: SignalPublishContext | undefined
): string | null | undefined {
  if (signal.profile.kind !== "agent") {
    return signalContext?.requestChainBasis?.kind === "wake" ? null : undefined;
  }
  if (signalContext?.requestChainBasis?.kind === "wake") {
    return signalContext.requestChainBasis.dispatchId;
  }
  if (
    signalContext?.requestChainBasis ||
    signalContext?.finalOutcomeAuthority !== "remote_agent_native_delivery" ||
    signal.type !== "signal.text"
  ) {
    return undefined;
  }
  const meta = signal.data.meta;
  return typeof meta?.dispatchId === "string" &&
    meta.targetProfileId === signal.profile.profileId
    ? meta.dispatchId
    : null;
}

/**
 * A message rebuilt for publication (result finalization) carries the chain
 * of the Wake it finalizes, read from that Wake's own outbox record.
 */
export function withOutboxRequestChain(
  message: OpenMeldDaemonDispatchQueueMessage,
  wake: Pick<
    OpenMeldDaemonDispatchQueueMessage,
    "requestChain" | "targetProfileId"
  > | null
): OpenMeldDaemonDispatchQueueMessage {
  return wake?.requestChain &&
    wake.targetProfileId === message.targetProfileId &&
    !message.requestChain
    ? { ...message, requestChain: wake.requestChain }
    : message;
}
