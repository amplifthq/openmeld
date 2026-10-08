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
  const directMessageRecipients = input.directMessage
    ? [...agentIds].filter((id) => id !== actorProfileId)
    : [];
  const dmInitiations =
    input.signal.data.meta?.threadWakeContinuation === true
      ? []
      : directMessageRecipients;
  return {
    agentProfileIds: [
      ...new Set([
        ...activity,
        ...activations,
        ...references,
        ...directMessageRecipients,
      ]),
    ].sort(),
    explicitlyAddressedAgentProfileIds: [
      ...new Set([...explicitActivations, ...references]),
    ].sort(),
    // DM contact is independent of Wake. Owners observe both sides, including
    // Agent-authored requests; owner activity is never a Human-directed DM.
    initiatingAgentProfileIds: [
      ...new Set([
        ...(input.signal.profile.kind === "human" ? explicitActivations : []),
        ...dmInitiations,
      ]),
    ].sort(),
  };
}
