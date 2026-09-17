import type {
  CenterAgentContextHandling,
  CenterAgentContextScopePlan,
  CenterAgentRequesterIdentity,
  CenterAgentResultAudience,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";

export type CenterAgentInteractionEnvironment = NonNullable<
  RemoteAgentTurnEnvelope["interactionEnvironment"]
>;

export const CENTER_AGENT_CONTEXT_SCOPE_PLAN_VERSION = 1 as const;

export function resolveCenterAgentContextScopePlan(
  envelope: RemoteAgentTurnEnvelope
): CenterAgentContextScopePlan {
  const expectedPlan = deriveCenterAgentContextScopePlan(envelope);
  const frozenPlan = envelope.contextScopePlan;
  if (!frozenPlan) {
    return expectedPlan;
  }
  if (!areCenterAgentContextScopePlansEqual(frozenPlan, expectedPlan)) {
    throw new Error(
      "Center Agent Context Scope Plan no longer matches this turn."
    );
  }
  return frozenPlan;
}

export function freezeCenterAgentContextScopePlan(
  envelope: RemoteAgentTurnEnvelope
): RemoteAgentTurnEnvelope {
  return {
    ...envelope,
    contextScopePlan: resolveCenterAgentContextScopePlan(envelope),
  };
}

export function canMaterializeCenterAgentOrganizationDocuments(
  plan: CenterAgentContextScopePlan
): boolean {
  return plan.organizationDocuments !== "never_available";
}

export function canMaterializeCenterAgentOrganizationSkills(
  plan: CenterAgentContextScopePlan
): boolean {
  return plan.organizationSkills !== "never_available";
}

export function canRecallCenterAgentMemberMemory(
  plan: CenterAgentContextScopePlan
): boolean {
  return plan.memberMemory !== "never_available";
}

export function canRecallCenterAgentOrganizationMemory(
  plan: CenterAgentContextScopePlan
): boolean {
  return plan.organizationMemory !== "never_available";
}

function deriveCenterAgentContextScopePlan(
  envelope: RemoteAgentTurnEnvelope
): CenterAgentContextScopePlan {
  const requesterIdentity = resolveRequesterIdentity(envelope);
  const interactionEnvironment =
    envelope.interactionEnvironment ??
    deriveLegacyInteractionEnvironment(envelope);
  const resultAudience = resolveResultAudience(interactionEnvironment);

  if (requesterIdentity === "external_participant") {
    return {
      authenticationSecrets: "never_available",
      interactionEnvironment,
      memberMemory: "never_available",
      organizationDocuments: "never_available",
      organizationMemory: "never_available",
      organizationSkills: "never_available",
      protectedInformation: "never_available",
      requesterIdentity,
      resultAudience,
      v: CENTER_AGENT_CONTEXT_SCOPE_PLAN_VERSION,
    };
  }

  const organizationContext = resolveOrganizationContextHandling(
    interactionEnvironment
  );
  return {
    authenticationSecrets: "never_available",
    interactionEnvironment,
    memberMemory: resolveMemberMemoryHandling({
      interactionEnvironment,
      requesterIdentity,
    }),
    organizationDocuments: organizationContext,
    organizationMemory: organizationContext,
    organizationSkills: organizationContext,
    protectedInformation:
      interactionEnvironment === "requester_private"
        ? "share_when_authorized"
        : "use_privately",
    requesterIdentity,
    resultAudience,
    v: CENTER_AGENT_CONTEXT_SCOPE_PLAN_VERSION,
  };
}

function resolveRequesterIdentity(
  envelope: RemoteAgentTurnEnvelope
): CenterAgentRequesterIdentity {
  if (envelope.sender.kind === "routine") {
    return "organization_routine";
  }
  if (
    envelope.sender.callerContext?.relationship === "external" ||
    envelope.sender.callerContext?.relationship === "anonymous"
  ) {
    return "external_participant";
  }
  if (envelope.sender.kind === "agent_profile") {
    return "agent_profile";
  }
  if (envelope.sender.verified) {
    return "verified_member";
  }
  return envelope.sender.messageChannelIdentity
    ? "connected_organization_member"
    : "external_participant";
}

function deriveLegacyInteractionEnvironment(
  envelope: RemoteAgentTurnEnvelope
): CenterAgentInteractionEnvironment {
  if (envelope.space.kind === "dm" || envelope.space.isCenterAgentDm) {
    return "requester_private";
  }
  if (
    envelope.trigger.source === "slack" ||
    envelope.trigger.source === "message_channel" ||
    envelope.trigger.source === "task_continuation" ||
    envelope.trigger.source === "task_watch_continuation" ||
    (envelope.trigger.source === "routine" &&
      envelope.trigger.destination?.kind === "slack_thread")
  ) {
    return "externally_shared";
  }
  return "organization_shared";
}

function resolveResultAudience(
  interactionEnvironment: CenterAgentInteractionEnvironment
): CenterAgentResultAudience {
  if (interactionEnvironment === "requester_private") {
    return "requester_only";
  }
  return interactionEnvironment === "organization_shared"
    ? "organization_members"
    : "external_conversation";
}

function resolveMemberMemoryHandling(input: {
  interactionEnvironment: CenterAgentInteractionEnvironment;
  requesterIdentity: CenterAgentRequesterIdentity;
}): CenterAgentContextHandling {
  if (input.requesterIdentity !== "verified_member") {
    return "never_available";
  }
  return input.interactionEnvironment === "requester_private"
    ? "use_and_share"
    : "use_privately";
}

function resolveOrganizationContextHandling(
  interactionEnvironment: CenterAgentInteractionEnvironment
): CenterAgentContextHandling {
  return interactionEnvironment === "externally_shared"
    ? "use_privately"
    : "share_when_authorized";
}

function areCenterAgentContextScopePlansEqual(
  left: CenterAgentContextScopePlan,
  right: CenterAgentContextScopePlan
): boolean {
  return (
    left.v === right.v &&
    left.authenticationSecrets === right.authenticationSecrets &&
    left.interactionEnvironment === right.interactionEnvironment &&
    left.memberMemory === right.memberMemory &&
    left.organizationDocuments === right.organizationDocuments &&
    left.organizationMemory === right.organizationMemory &&
    left.organizationSkills === right.organizationSkills &&
    left.protectedInformation === right.protectedInformation &&
    left.requesterIdentity === right.requesterIdentity &&
    left.resultAudience === right.resultAudience
  );
}
