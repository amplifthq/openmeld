import {
  type AcceptOrganizationJoinLinkResponse,
  ORGANIZATION_JOIN_LINK_TOKEN_PREFIX,
  ORGANIZATION_JOIN_LINK_WEB_PATH,
  type OrganizationJoinLink,
  type PreviewOrganizationJoinLinkResponse,
} from "@openmeld/schemas";
import { canCreateOrganizationJoinLinkForRole } from "./access-control";
import type {
  ActiveOrganizationJoinLinkRecord,
  OrganizationJoinLinkOrganizationRecord,
  OrganizationJoinLinkRecord,
  OrganizationJoinLinkRepository,
} from "./join-link-repository";
import { isPersonalOrganization } from "./personal-organization";

const JOIN_LINK_RANDOM_BYTE_LENGTH = 32;

export type OrganizationJoinLinkServiceErrorCode =
  | "organization.join_link.email_verification_required"
  | "organization.join_link.forbidden"
  | "organization.join_link.inactive"
  | "organization.join_link.approval_required"
  | "organization.metadata_invalid"
  | "organization.personal_no_members";

export class OrganizationJoinLinkServiceError extends Error {
  readonly code: OrganizationJoinLinkServiceErrorCode;

  constructor(
    code: OrganizationJoinLinkServiceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OrganizationJoinLinkServiceError";
    this.code = code;
  }
}

export type AddOrganizationMember = (input: {
  organizationId: string;
  role: "member";
  userId: string;
}) => Promise<unknown>;

export type EnsuredOrganizationJoinLink = {
  joinLink: OrganizationJoinLink;
  organizationName: string;
};

export type VerifiedWorkspaceMemberEnrollment = {
  alreadyMember: boolean;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "admin" | "member" | "owner";
};

export function createOrganizationJoinLinkService(input: {
  repository: OrganizationJoinLinkRepository;
  webAppUrl: string;
}) {
  const { repository } = input;

  return {
    async getActive(
      organizationId: string,
      spaceId?: string
    ): Promise<OrganizationJoinLink | null> {
      const record = await repository.findActiveByOrganizationId(
        organizationId,
        spaceId
      );
      return record ? toOrganizationJoinLink(record, input.webAppUrl) : null;
    },

    async ensure(ensureInput: {
      actorUserId: string;
      organizationId: string;
      spaceId?: string;
    }): Promise<EnsuredOrganizationJoinLink> {
      const membership = await repository.findMembership(
        ensureInput.organizationId,
        ensureInput.actorUserId
      );
      if (
        !(membership && canCreateOrganizationJoinLinkForRole(membership.role))
      ) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.forbidden",
          "Join this organization before creating an invitation request link."
        );
      }

      const organization = await repository.findOrganizationById(
        ensureInput.organizationId
      );
      if (!organization) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.inactive",
          "Organization not found."
        );
      }
      assertOrganizationCanHaveMembers(organization);

      const record = await insertOrReadConcurrentActiveLink({
        insert: () =>
          repository.ensureActive({
            createdBy: ensureInput.actorUserId,
            id: crypto.randomUUID(),
            organizationId: ensureInput.organizationId,
            spaceId: ensureInput.spaceId,
            token: generateOrganizationJoinLinkToken(),
          }),
        organizationId: ensureInput.organizationId,
        spaceId: ensureInput.spaceId,
        repository,
      });
      return {
        joinLink: toOrganizationJoinLink(record, input.webAppUrl),
        organizationName: organization.name,
      };
    },

    async reset(resetInput: {
      createdBy: string;
      organizationId: string;
      spaceId?: string;
    }): Promise<OrganizationJoinLink> {
      const organization = await repository.findOrganizationById(
        resetInput.organizationId
      );
      if (!organization) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.inactive",
          "Organization not found."
        );
      }
      assertOrganizationCanHaveMembers(organization);

      const record = await insertOrReadConcurrentActiveLink({
        insert: () =>
          repository.resetActive({
            createdBy: resetInput.createdBy,
            id: crypto.randomUUID(),
            organizationId: resetInput.organizationId,
            spaceId: resetInput.spaceId,
            token: generateOrganizationJoinLinkToken(),
          }),
        organizationId: resetInput.organizationId,
        spaceId: resetInput.spaceId,
        repository,
      });
      return toOrganizationJoinLink(record, input.webAppUrl);
    },

    revoke(organizationId: string, spaceId?: string): Promise<boolean> {
      return repository.revokeActive(organizationId, spaceId);
    },

    async preview(token: string): Promise<PreviewOrganizationJoinLinkResponse> {
      const record = await repository.findActiveByToken(token);
      if (!(record && isJoinableOrganization(record.organization))) {
        return { active: false, ok: true };
      }
      return {
        active: true,
        ok: true,
        organizationName: record.organization.name,
        organizationSlug: record.organization.slug,
        spaceId: record.spaceId,
      };
    },

    async accept(acceptInput: {
      addMember: AddOrganizationMember;
      emailVerified: boolean;
      token: string;
      userId: string;
    }): Promise<AcceptOrganizationJoinLinkResponse> {
      const record = await repository.findActiveByToken(acceptInput.token);
      if (!record) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.inactive",
          "This organization join link is no longer active."
        );
      }
      assertOrganizationCanHaveMembers(record.organization);
      if (!acceptInput.emailVerified) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.email_verification_required",
          "Verify your email before joining this organization."
        );
      }

      const membership = await repository.findMembership(
        record.organizationId,
        acceptInput.userId
      );
      if (!membership) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.approval_required",
          "This link now requires approval. Open it in OpenMeld to request an invitation."
        );
      }
      return toAcceptResponse(record, membership.role, true);
    },

    async enrollVerifiedWorkspaceMember(enrollmentInput: {
      addMember: AddOrganizationMember;
      emailVerified: boolean;
      organizationId: string;
      userId: string;
    }): Promise<VerifiedWorkspaceMemberEnrollment> {
      if (!enrollmentInput.emailVerified) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.email_verification_required",
          "Verify your email before joining this organization."
        );
      }
      const organization = await repository.findOrganizationById(
        enrollmentInput.organizationId
      );
      if (!organization) {
        throw new OrganizationJoinLinkServiceError(
          "organization.join_link.inactive",
          "Organization not found."
        );
      }
      assertOrganizationCanHaveMembers(organization);

      const enrollment = await enrollOrganizationMember({
        addMember: enrollmentInput.addMember,
        organizationId: organization.id,
        repository,
        userId: enrollmentInput.userId,
      });
      return toVerifiedWorkspaceMemberEnrollment(
        organization,
        enrollment.role,
        enrollment.alreadyMember
      );
    },
  };
}

async function enrollOrganizationMember(input: {
  addMember: AddOrganizationMember;
  organizationId: string;
  repository: OrganizationJoinLinkRepository;
  userId: string;
}): Promise<{ alreadyMember: boolean; role: string }> {
  const existingMembership = await input.repository.findMembership(
    input.organizationId,
    input.userId
  );
  if (existingMembership) {
    return { alreadyMember: true, role: existingMembership.role };
  }

  try {
    await input.addMember({
      organizationId: input.organizationId,
      role: "member",
      userId: input.userId,
    });
  } catch (error) {
    const racedMembership = await input.repository.findMembership(
      input.organizationId,
      input.userId
    );
    if (racedMembership) {
      return { alreadyMember: true, role: racedMembership.role };
    }
    throw error;
  }

  const createdMembership = await input.repository.findMembership(
    input.organizationId,
    input.userId
  );
  if (!createdMembership) {
    throw new Error(
      "Better Auth addMember completed without creating a membership"
    );
  }
  return { alreadyMember: false, role: createdMembership.role };
}

async function insertOrReadConcurrentActiveLink(input: {
  spaceId?: string;
  insert: () => Promise<OrganizationJoinLinkRecord>;
  organizationId: string;
  repository: OrganizationJoinLinkRepository;
}): Promise<OrganizationJoinLinkRecord> {
  try {
    return await input.insert();
  } catch (error) {
    if (!isActiveOrganizationJoinLinkUniqueConstraintError(error)) {
      throw error;
    }

    const active = await input.repository.findActiveByOrganizationId(
      input.organizationId,
      input.spaceId
    );
    if (active) {
      return active;
    }

    throw new OrganizationJoinLinkServiceError(
      "organization.join_link.inactive",
      "Concurrent organization join link creation did not leave an active link.",
      { cause: error }
    );
  }
}

function isActiveOrganizationJoinLinkUniqueConstraintError(
  error: unknown
): boolean {
  if (!(error && typeof error === "object")) {
    return false;
  }

  const message =
    error instanceof Error ? error.message : String(error ?? "").trim();
  if (
    message.includes(
      "UNIQUE constraint failed: organization_join_links.organization_id"
    )
  ) {
    return true;
  }

  const cause = "cause" in error ? error.cause : undefined;
  return cause
    ? isActiveOrganizationJoinLinkUniqueConstraintError(cause)
    : false;
}

export function generateOrganizationJoinLinkToken(): string {
  const randomBytes = new Uint8Array(JOIN_LINK_RANDOM_BYTE_LENGTH);
  crypto.getRandomValues(randomBytes);
  const entropy = Array.from(randomBytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return `${ORGANIZATION_JOIN_LINK_TOKEN_PREFIX}${entropy}`;
}

function toOrganizationJoinLink(
  record: OrganizationJoinLinkRecord,
  webAppUrl: string
): OrganizationJoinLink {
  const url = new URL(ORGANIZATION_JOIN_LINK_WEB_PATH, webAppUrl);
  url.searchParams.set("token", record.token);
  return {
    id: record.id,
    organizationId: record.organizationId,
    token: record.token,
    url: url.toString(),
    role: "member",
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    ...(record.spaceId ? { spaceId: record.spaceId } : {}),
  };
}

function toAcceptResponse(
  record: ActiveOrganizationJoinLinkRecord,
  role: string,
  alreadyMember: boolean
): AcceptOrganizationJoinLinkResponse {
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error(`Organization membership has unsupported role: ${role}`);
  }
  return {
    alreadyMember,
    ok: true,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    organizationSlug: record.organization.slug,
    role,
  };
}

function toVerifiedWorkspaceMemberEnrollment(
  organization: OrganizationJoinLinkOrganizationRecord,
  role: string,
  alreadyMember: boolean
): VerifiedWorkspaceMemberEnrollment {
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error(`Organization membership has unsupported role: ${role}`);
  }
  return {
    alreadyMember,
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    role,
  };
}

function isJoinableOrganization(
  organization: OrganizationJoinLinkOrganizationRecord
): boolean {
  const result = isPersonalOrganization(organization);
  return result.ok && !result.personal;
}

function assertOrganizationCanHaveMembers(
  organization: OrganizationJoinLinkOrganizationRecord
): void {
  const result = isPersonalOrganization(organization);
  if (!result.ok) {
    throw new OrganizationJoinLinkServiceError(
      "organization.metadata_invalid",
      "Organization metadata is invalid."
    );
  }
  if (result.personal) {
    throw new OrganizationJoinLinkServiceError(
      "organization.personal_no_members",
      "Personal organizations cannot invite members."
    );
  }
}
