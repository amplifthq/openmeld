import type {
  AssignAgentProfileMemberAgentOutcome,
  HarnessKind,
} from "@openmeld/schemas";
import type { OpenMeldProfileRecord } from "../profiles/profile-repository";
import type { MemberAgentRepository } from "./member-agent-repository";

export type AssignAgentProfileMemberAgentResult = {
  outcome: AssignAgentProfileMemberAgentOutcome;
  memberAgentId: string | null;
};

/**
 * Put a bound Agent Profile under its owner's MemberAgent for the Harness of
 * its Binding (developing/product/agent-profiles.md, MemberAgent Layer). The
 * caller derives `harnessKind` from the Binding it accepted.
 *
 * Only an existing MemberAgent is used: catalog sync is the single creation
 * trigger. An assigned Profile is never moved to another MemberAgent; the
 * repository write is conditional on the Profile being unassigned or already
 * under this MemberAgent, so a concurrent writer cannot be overwritten.
 */
export async function assignAgentProfileToMemberAgent(input: {
  findProfile: (profileId: string) => Promise<OpenMeldProfileRecord | null>;
  harnessKind: HarnessKind;
  ownerUserId: string;
  profileId: string;
  repository: MemberAgentRepository;
}): Promise<AssignAgentProfileMemberAgentResult> {
  const profile = await input.findProfile(input.profileId);
  const organizationId = profile?.organizationId ?? null;
  if (
    !(profile && organizationId) ||
    profile.profileKind !== "agent" ||
    profile.status !== "active" ||
    profile.managedRole !== null ||
    profile.ownerUserId !== input.ownerUserId ||
    !(await input.repository.isCurrentMember({
      organizationId,
      userId: input.ownerUserId,
    }))
  ) {
    return { outcome: "not_eligible", memberAgentId: null };
  }
  const memberAgent = await input.repository.findByOwnerHarness({
    harnessKind: input.harnessKind,
    organizationId,
    ownerUserId: input.ownerUserId,
  });
  if (profile.memberAgentId) {
    return profile.memberAgentId === memberAgent?.id
      ? { outcome: "unchanged", memberAgentId: memberAgent.id }
      : { outcome: "assigned_elsewhere", memberAgentId: profile.memberAgentId };
  }
  if (!memberAgent) {
    return { outcome: "no_member_agent", memberAgentId: null };
  }
  await input.repository.assignProfile({
    memberAgentId: memberAgent.id,
    profileId: profile.profileId,
  });
  const assigned = await input.findProfile(profile.profileId);
  if (assigned?.memberAgentId === memberAgent.id) {
    return { outcome: "assigned", memberAgentId: memberAgent.id };
  }
  // A concurrent writer assigned it first.
  return {
    outcome: "assigned_elsewhere",
    memberAgentId: assigned?.memberAgentId ?? null,
  };
}
