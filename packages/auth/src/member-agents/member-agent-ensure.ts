import {
  buildDetectedMemberAgentIdempotencyKey,
  type DetectedHarnessKind,
  formatHarnessDisplayName,
} from "@openmeld/schemas";
import type { OpenMeldProfileRecord } from "../profiles/profile-repository";
import type { CreateAgentProfileInput } from "../profiles/profile-service";
import type {
  MemberAgentRepository,
  MemberAgentRowRecord,
} from "./member-agent-repository";

export type EnsureDetectedMemberAgentResult =
  | {
      status: "ensured";
      created: boolean;
      memberAgent: MemberAgentRowRecord;
      defaultProfileCandidateId: string | null;
    }
  | { status: "membership_required" };

/**
 * Ensure the detected MemberAgent of one (organization, owner, harness) and
 * its keyed default Agent Profile (design-plans/member-agent-program.md §4.5).
 *
 * Every step is a conditional write keyed by a unique constraint, so a retry
 * resumes an interrupted creation and two concurrent callers converge on one
 * MemberAgent and one default Profile:
 *
 * 1. The default Profile is written first, with the deterministic per-owner
 *    creation key `auto:{organizationId}:{harnessKind}`; a replay returns the
 *    same row.
 * 2. The MemberAgent insert is conditional on the unique
 *    (organization, owner, harness) key; the winner's row is read back.
 * 3. Auth never assigns the Profile here. It returns it as
 *    `defaultProfileCandidateId`; Core binds it and assigns it through the
 *    Profile's assignment lock, which re-reads the Binding, so a Profile the
 *    owner moved to another harness meanwhile is never grouped here.
 * 4. A later call sets the default once the Profile belongs to this
 *    MemberAgent, which keeps invariant 3 (the default Profile belongs to its
 *    own MemberAgent).
 *
 * Because the Profile precedes the MemberAgent, a detected MemberAgent with
 * no default is resumed only while its keyed Profile still exists and is
 * active. Once the owner deletes that Profile it is never recreated here. An
 * existing migrated, manual, or complete MemberAgent is returned unchanged.
 */
export async function ensureDetectedMemberAgent(input: {
  createAgentProfile: (
    input: CreateAgentProfileInput
  ) => Promise<OpenMeldProfileRecord>;
  createMemberAgentId: () => string;
  findAgentProfileByCreationKey: (input: {
    creationIdempotencyKey: string;
    ownerUserId: string;
  }) => Promise<OpenMeldProfileRecord | null>;
  harnessKind: DetectedHarnessKind;
  organizationId: string;
  ownerUserId: string;
  repository: MemberAgentRepository;
}): Promise<EnsureDetectedMemberAgentResult> {
  const key = {
    harnessKind: input.harnessKind,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  };
  if (
    !(await input.repository.isCurrentMember({
      organizationId: input.organizationId,
      userId: input.ownerUserId,
    }))
  ) {
    return { status: "membership_required" };
  }
  const creationIdempotencyKey = buildDetectedMemberAgentIdempotencyKey(key);
  const existing = await input.repository.findByOwnerHarness(key);
  if (existing && !isInterruptedDetectedCreation(existing)) {
    return {
      status: "ensured",
      created: false,
      memberAgent: existing,
      defaultProfileCandidateId: null,
    };
  }

  let created = false;
  let profile: OpenMeldProfileRecord | null;
  if (existing) {
    profile = await input.findAgentProfileByCreationKey({
      creationIdempotencyKey,
      ownerUserId: input.ownerUserId,
    });
  } else {
    profile = await input.createAgentProfile({
      createdByUserId: input.ownerUserId,
      idempotencyKey: creationIdempotencyKey,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      profileName: formatHarnessDisplayName(input.harnessKind),
      source: "auto_detected",
    });
    const candidateId = input.createMemberAgentId();
    await input.repository.insertDetectedIfAbsent({ ...key, id: candidateId });
    const winner = await input.repository.findByOwnerHarness(key);
    created = winner?.id === candidateId;
  }
  const memberAgent = await input.repository.findByOwnerHarness(key);
  if (!memberAgent) {
    // The conditional insert found no current membership: the owner was
    // removed after the first check.
    return { status: "membership_required" };
  }
  let defaultProfileCandidateId: string | null = null;
  if (
    profile?.status === "active" &&
    profile.organizationId === input.organizationId &&
    isInterruptedDetectedCreation(memberAgent)
  ) {
    if (profile.memberAgentId === memberAgent.id) {
      await input.repository.setDefaultProfileIfUnset({
        memberAgentId: memberAgent.id,
        profileId: profile.profileId,
      });
    } else if (profile.memberAgentId === null) {
      defaultProfileCandidateId = profile.profileId;
    }
  }
  return {
    status: "ensured",
    created,
    memberAgent: await requireMemberAgent(input.repository, key),
    defaultProfileCandidateId,
  };
}

async function requireMemberAgent(
  repository: MemberAgentRepository,
  key: Parameters<MemberAgentRepository["findByOwnerHarness"]>[0]
): Promise<MemberAgentRowRecord> {
  const memberAgent = await repository.findByOwnerHarness(key);
  if (!memberAgent) {
    throw new Error(
      "member agent is not readable after its conditional insert"
    );
  }
  return memberAgent;
}

function isInterruptedDetectedCreation(memberAgent: MemberAgentRowRecord) {
  return (
    memberAgent.source === "detected" &&
    memberAgent.defaultProfileId === null &&
    memberAgent.archivedAt === null
  );
}
