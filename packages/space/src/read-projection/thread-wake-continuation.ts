import type { SignalEnvelope } from "@openmeld/protocol";
import { isOneHumanAgentConversation } from "../presentation/agent-direct-conversation-space";

/** Include the sender: a second person's first reply is already a group conversation. */
export function resolveThreadAutomaticWakeTarget(input: {
  participants: readonly { profileId: string; kind: string }[];
  senderProfileId: string;
}): string | null {
  const humans = new Set([input.senderProfileId]);
  const agents = new Set<string>();
  for (const participant of input.participants) {
    if (participant.kind === "human") {
      humans.add(participant.profileId);
    }
    if (participant.kind === "agent") {
      agents.add(participant.profileId);
    }
  }
  return isOneHumanAgentConversation({
    activeMemberCount: humans.size + agents.size,
    humanMemberCount: humans.size,
    agentMemberCount: agents.size,
  })
    ? ([...agents][0] ?? null)
    : null;
}

/** Last explicit human Wake wins. Automated replies and continuation do not retarget. */
export function resolveThreadWakeContinuation(input: {
  root: SignalEnvelope | null;
  latestExplicitWake: SignalEnvelope | null;
}): string | null {
  const signal = input.latestExplicitWake;
  if (signal?.type === "signal.text" && signal.profile.kind === "human") {
    const targets = signal.data.messageEnvelope?.activationTargets ?? [];
    return targets.length === 1 ? (targets[0] ?? null) : null;
  }
  return input.root?.profile.kind === "agent"
    ? (input.root.profile.profileId ?? null)
    : null;
}
