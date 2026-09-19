import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceMemberRecord } from "../infrastructure/sql/space-member-repo";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorProfileId,
} from "../rules/formal-space-update";

/** Reads structured addressing only. It never assigns work or rewrites a signal. */
export function resolveSpaceInboxAgentAddressing(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  directMessage?: boolean;
  signal: SignalEnvelope;
}): {
  agentProfileIds: string[];
  explicitlyAddressedAgentProfileIds: string[];
  initiatingAgentProfileIds: string[];
} {
  if (!isFormalSpaceUpdateSignal(input.signal)) {
    return {
      agentProfileIds: [],
      explicitlyAddressedAgentProfileIds: [],
      initiatingAgentProfileIds: [],
    };
  }
  const agents = input.activeMemberRecords.filter(
    (member) =>
      member.status === "active" && member.profileKindSnapshot === "agent"
  );
  const agentIds = new Set(agents.map((member) => member.profileId));
  const actorProfileId = resolveFormalSpaceUpdateActorProfileId(input.signal);
  const activity = new Set<string>();
  if (actorProfileId && agentIds.has(actorProfileId)) {
    activity.add(actorProfileId);
  }
  if (input.signal.type !== "signal.text") {
    return {
      agentProfileIds: [...activity].sort(),
      explicitlyAddressedAgentProfileIds: [],
      initiatingAgentProfileIds: [],
    };
  }
  const envelope = input.signal.data.messageEnvelope;
  const activations = (envelope?.activationTargets ?? []).filter((id) =>
    agentIds.has(id)
  );
  const references = (envelope?.referenceTargets ?? []).filter((id) =>
    agentIds.has(id)
  );
  const explicitActivations =
    input.signal.data.meta?.threadWakeContinuation === true ? [] : activations;
  const humanDmAgents =
    input.directMessage && input.signal.profile.kind === "human"
      ? [...agentIds]
      : [];
  const dmInitiations =
    input.signal.data.meta?.threadWakeContinuation === true
      ? []
      : humanDmAgents;
  return {
    agentProfileIds: [
      ...new Set([
        ...activity,
        ...activations,
        ...references,
        ...humanDmAgents,
      ]),
    ].sort(),
    explicitlyAddressedAgentProfileIds: [
      ...new Set([...explicitActivations, ...references]),
    ].sort(),
    // A Reference alone is context. A real Human-Agent DM independently
    // establishes direct contact, without changing the message's Wake targets.
    initiatingAgentProfileIds:
      input.signal.profile.kind === "human"
        ? [...new Set([...explicitActivations, ...dmInitiations])].sort()
        : [],
  };
}
