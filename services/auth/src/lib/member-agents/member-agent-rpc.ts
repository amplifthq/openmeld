import {
  assignAgentProfileToMemberAgent,
  createAuthDatabase,
  createDrizzleMemberAgentRepository,
  createDrizzleOpenMeldProfileRepository,
  ensureDetectedMemberAgent,
  type MemberAgentRepository,
  type MemberAgentRowRecord,
  type OpenMeldProfileService,
} from "@openmeld/auth/server";
import {
  type AssignAgentProfileMemberAgentRpcResult,
  assignAgentProfileMemberAgentRpcInputSchema,
  assignAgentProfileMemberAgentRpcResultSchema,
  type EnsureDetectedMemberAgentRpcResult,
  ensureDetectedMemberAgentRpcInputSchema,
  ensureDetectedMemberAgentRpcResultSchema,
  type ListMemberAgentOrganizationIdsRpcResult,
  type ListMemberAgentsResponse,
  listMemberAgentOrganizationIdsRpcResultSchema,
  listMemberAgentsResponseSchema,
  MEMBER_AGENTS_DISABLED_CODE,
  MEMBER_AGENTS_DISABLED_MESSAGE,
} from "@openmeld/schemas";
import { toProfileHttpErrorResponse } from "../profiles/profile-error-response";
import { logError } from "../utils/loggers";
import { toListMemberAgentsResponse } from "./member-agent-listing";

type RpcFailure = { ok: false; code: string; message: string };

// Core -> Auth service-binding RPCs for MemberAgent catalog sync. The caller
// is trusted to name the owner, but Auth still requires current membership
// before it reads or writes an Organization's MemberAgents.

export type MemberAgentRpcDeps = {
  createMemberAgentId?: () => string;
  enabled: boolean;
  profileService: Pick<OpenMeldProfileService, "createAgentProfile">;
  repository?: MemberAgentRepository;
};

const DISABLED: RpcFailure = {
  ok: false,
  code: MEMBER_AGENTS_DISABLED_CODE,
  message: MEMBER_AGENTS_DISABLED_MESSAGE,
};
const MEMBERSHIP_REQUIRED: RpcFailure = {
  ok: false,
  code: "organization.membership_required",
  message: "The owner is not a member of this organization.",
};

export async function ensureDetectedMemberAgentRpc(
  input: unknown,
  deps: MemberAgentRpcDeps
): Promise<EnsureDetectedMemberAgentRpcResult> {
  if (!deps.enabled) {
    return DISABLED;
  }
  const parsed = ensureDetectedMemberAgentRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "member_agents.invalid_input",
      message: parsed.error.issues[0]?.message ?? "Invalid MemberAgent input.",
    };
  }
  const db = createAuthDatabase();
  const profileRepository = createDrizzleOpenMeldProfileRepository(db);
  try {
    const result = await ensureDetectedMemberAgent({
      createAgentProfile: deps.profileService.createAgentProfile,
      createMemberAgentId:
        deps.createMemberAgentId ?? (() => crypto.randomUUID()),
      findAgentProfileByCreationKey: ({
        creationIdempotencyKey,
        ownerUserId,
      }) =>
        profileRepository.findAgentByOwnerAndCreationIdempotencyKey(
          ownerUserId,
          creationIdempotencyKey
        ),
      harnessKind: parsed.data.harnessKind,
      organizationId: parsed.data.organizationId,
      ownerUserId: parsed.data.ownerUserId,
      repository: deps.repository ?? createDrizzleMemberAgentRepository(db),
    });
    if (result.status === "membership_required") {
      return MEMBERSHIP_REQUIRED;
    }
    return ensureDetectedMemberAgentRpcResultSchema.parse({
      ok: true,
      created: result.created,
      memberAgent: toMemberAgentProjection(result.memberAgent),
      defaultProfileCandidateId: result.defaultProfileCandidateId,
    });
  } catch (error) {
    const { body, status } = toProfileHttpErrorResponse(error);
    if (status >= 500) {
      logError({
        event: "auth.member_agents.ensure_failed",
        error,
        harnessKind: parsed.data.harnessKind,
        organizationId: parsed.data.organizationId,
      });
    }
    return { ok: false, code: body.code, message: body.message };
  }
}

export async function assignAgentProfileMemberAgentRpc(
  input: unknown,
  deps: Pick<MemberAgentRpcDeps, "enabled" | "repository">
): Promise<AssignAgentProfileMemberAgentRpcResult> {
  if (!deps.enabled) {
    return DISABLED;
  }
  const parsed = assignAgentProfileMemberAgentRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "member_agents.invalid_input",
      message: parsed.error.issues[0]?.message ?? "Invalid MemberAgent input.",
    };
  }
  const db = createAuthDatabase();
  const profileRepository = createDrizzleOpenMeldProfileRepository(db);
  try {
    const result = await assignAgentProfileToMemberAgent({
      findProfile: (profileId) => profileRepository.findByProfileId(profileId),
      harnessKind: parsed.data.harnessKind,
      ownerUserId: parsed.data.ownerUserId,
      profileId: parsed.data.profileId,
      repository: deps.repository ?? createDrizzleMemberAgentRepository(db),
    });
    return assignAgentProfileMemberAgentRpcResultSchema.parse({
      ok: true,
      ...result,
    });
  } catch (error) {
    const { body, status } = toProfileHttpErrorResponse(error);
    if (status >= 500) {
      logError({
        event: "auth.member_agents.assign_failed",
        error,
        harnessKind: parsed.data.harnessKind,
        profileId: parsed.data.profileId,
      });
    }
    return { ok: false, code: body.code, message: body.message };
  }
}

export async function listOwnerMemberAgentsRpc(
  input: { organizationId?: string | null; ownerUserId?: string | null },
  deps: Pick<MemberAgentRpcDeps, "enabled" | "repository">
): Promise<ListMemberAgentsResponse | RpcFailure> {
  if (!deps.enabled) {
    return DISABLED;
  }
  const organizationId = input.organizationId?.trim();
  const ownerUserId = input.ownerUserId?.trim();
  if (!(organizationId && ownerUserId)) {
    return {
      ok: false,
      code: "organization.context_required",
      message: "organizationId and ownerUserId are required.",
    };
  }
  const repository =
    deps.repository ?? createDrizzleMemberAgentRepository(createAuthDatabase());
  if (
    !(await repository.isCurrentMember({ organizationId, userId: ownerUserId }))
  ) {
    return MEMBERSHIP_REQUIRED;
  }
  const listing = await repository.listForOwnerInOrganization({
    organizationId,
    ownerUserId,
  });
  return listMemberAgentsResponseSchema.parse(
    toListMemberAgentsResponse(organizationId, listing)
  );
}

export async function listMemberAgentOrganizationIdsRpc(
  input: { ownerUserId?: string | null },
  deps: Pick<MemberAgentRpcDeps, "enabled" | "repository">
): Promise<ListMemberAgentOrganizationIdsRpcResult> {
  if (!deps.enabled) {
    return DISABLED;
  }
  const ownerUserId = input.ownerUserId?.trim();
  if (!ownerUserId) {
    return {
      ok: false,
      code: "member_agents.owner_required",
      message: "ownerUserId is required.",
    };
  }
  const repository =
    deps.repository ?? createDrizzleMemberAgentRepository(createAuthDatabase());
  const organizationIds =
    await repository.listOrganizationIdsForOwner(ownerUserId);
  // Membership is the authority: an Organization the owner left keeps its
  // rows (departure rules) but must not be reconciled.
  const current: string[] = [];
  for (const organizationId of organizationIds) {
    if (
      await repository.isCurrentMember({ organizationId, userId: ownerUserId })
    ) {
      current.push(organizationId);
    }
  }
  return listMemberAgentOrganizationIdsRpcResultSchema.parse({
    ok: true,
    organizationIds: current,
  });
}

function toMemberAgentProjection(memberAgent: MemberAgentRowRecord) {
  return {
    id: memberAgent.id,
    organizationId: memberAgent.organizationId,
    ownerUserId: memberAgent.ownerUserId,
    harnessKind: memberAgent.harnessKind,
    defaultProfileId: memberAgent.defaultProfileId,
    source: memberAgent.source,
    archivedAt: memberAgent.archivedAt?.toISOString() ?? null,
  };
}
