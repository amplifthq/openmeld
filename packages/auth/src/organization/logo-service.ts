import {
  buildOrganizationLogoPublicPath,
  parseOrganizationLogoReferenceFromUrl,
} from "@openmeld/schemas";
import type {
  OrganizationLogoCommitRpcInput,
  OrganizationLogoCommitRpcResponse,
  OrganizationLogoPrepareRpcInput,
  OrganizationLogoPrepareRpcResponse,
} from "@openmeld/schemas/types";
import { canUpdateOrganizationLogoForRole } from "./access-control";
import { isPersonalOrganization } from "./personal-organization";

export type OrganizationLogoMutationRecord = {
  logo: string | null;
  metadata: string | null;
  organizationId: string;
  role: string;
  slug: string;
};

export type OrganizationLogoMutationRepository = {
  compareAndSetLogo(input: {
    actorUserId: string;
    expectedLogo: string | null;
    expectedMetadata: string | null;
    expectedRole: string;
    expectedSlug: string;
    nextLogo: string | null;
    organizationId: string;
  }): Promise<boolean>;
  readForActor(input: {
    actorUserId: string;
    organizationId: string;
  }): Promise<OrganizationLogoMutationRecord | null>;
};

export function createD1OrganizationLogoMutationRepository(
  db: D1Database
): OrganizationLogoMutationRepository {
  return {
    compareAndSetLogo: async (input) => {
      const result = await db
        .prepare(
          `
            UPDATE organizations
            SET logo = ?
            WHERE id = ?
              AND (
                (logo IS NULL AND ? IS NULL)
                OR logo = ?
              )
              AND (
                (metadata IS NULL AND ? IS NULL)
                OR metadata = ?
              )
              AND slug = ?
              AND EXISTS (
                SELECT 1
                FROM members
                WHERE members.organization_id = organizations.id
                  AND members.user_id = ?
                  AND members.role = ?
              )
          `
        )
        .bind(
          input.nextLogo,
          input.organizationId,
          input.expectedLogo,
          input.expectedLogo,
          input.expectedMetadata,
          input.expectedMetadata,
          input.expectedSlug,
          input.actorUserId,
          input.expectedRole
        )
        .run();
      return Number(result.meta.changes ?? 0) === 1;
    },
    readForActor: async (input) =>
      await db
        .prepare(
          `
            SELECT
              organizations.id AS organization_id,
              organizations.logo AS logo,
              organizations.metadata AS metadata,
              organizations.slug AS slug,
              members.role AS role
            FROM organizations
            INNER JOIN members
              ON members.organization_id = organizations.id
            WHERE organizations.id = ?
              AND members.user_id = ?
            LIMIT 1
          `
        )
        .bind(input.organizationId, input.actorUserId)
        .first<{
          logo: string | null;
          metadata: string | null;
          organization_id: string;
          role: string;
          slug: string;
        }>()
        .then((row) =>
          row
            ? {
                logo: row.logo,
                metadata: row.metadata,
                organizationId: row.organization_id,
                role: row.role,
                slug: row.slug,
              }
            : null
        ),
  };
}

export function createOrganizationLogoService(input: {
  repository: OrganizationLogoMutationRepository;
}) {
  const readAuthorizedRecord = async (request: {
    actorUserId: string;
    organizationId: string;
  }): Promise<
    | { ok: true; record: OrganizationLogoMutationRecord }
    | {
        ok: false;
        response: Extract<OrganizationLogoPrepareRpcResponse, { ok: false }>;
      }
  > => {
    const record = await input.repository.readForActor(request);
    if (!record) {
      return {
        ok: false,
        response: mutationFailure(
          "organization.logo.not_found",
          "Organization not found."
        ),
      };
    }
    if (!canUpdateOrganizationLogoForRole(record.role)) {
      return {
        ok: false,
        response: mutationFailure(
          "organization.logo.forbidden",
          "Only the organization owner can change the logo."
        ),
      };
    }

    const personal = isPersonalOrganization({
      metadata: record.metadata,
      slug: record.slug,
    });
    if (!personal.ok) {
      return {
        ok: false,
        response: mutationFailure(
          "organization.logo.metadata_invalid",
          "Organization metadata is invalid."
        ),
      };
    }
    if (personal.personal) {
      return {
        ok: false,
        response: mutationFailure(
          "organization.logo.personal_unsupported",
          "Personal workspaces use your account avatar."
        ),
      };
    }
    return { ok: true, record };
  };

  return {
    prepare: async (
      request: OrganizationLogoPrepareRpcInput
    ): Promise<OrganizationLogoPrepareRpcResponse> => {
      const authorized = await readAuthorizedRecord(request);
      if (!authorized.ok) {
        return authorized.response;
      }
      return { currentLogo: authorized.record.logo, ok: true };
    },
    commit: async (
      request: OrganizationLogoCommitRpcInput
    ): Promise<OrganizationLogoCommitRpcResponse> => {
      const authorized = await readAuthorizedRecord(request);
      if (!authorized.ok) {
        return authorized.response;
      }
      if (authorized.record.logo !== request.expectedLogo) {
        return mutationFailure(
          "organization.logo.conflict",
          "The organization logo changed before this update completed."
        );
      }

      const nextLogoUrl = request.nextLogo?.url ?? null;
      if (
        request.nextLogo &&
        !isExpectedManagedLogoReference({
          assetId: request.nextLogo.assetId,
          organizationId: request.organizationId,
          url: request.nextLogo.url,
        })
      ) {
        return mutationFailure(
          "organization.logo.invalid_reference",
          "The organization logo reference is invalid."
        );
      }

      const updated = await input.repository.compareAndSetLogo({
        actorUserId: request.actorUserId,
        expectedLogo: request.expectedLogo,
        expectedMetadata: authorized.record.metadata,
        expectedRole: authorized.record.role,
        expectedSlug: authorized.record.slug,
        nextLogo: nextLogoUrl,
        organizationId: request.organizationId,
      });
      if (!updated) {
        return mutationFailure(
          "organization.logo.conflict",
          "The organization logo changed before this update completed."
        );
      }
      return { logo: nextLogoUrl, ok: true };
    },
  };
}

function isExpectedManagedLogoReference(input: {
  assetId: string;
  organizationId: string;
  url: string;
}): boolean {
  const parsed = parseOrganizationLogoReferenceFromUrl(input.url);
  return (
    parsed?.assetId === input.assetId &&
    parsed.organizationId === input.organizationId &&
    new URL(input.url).pathname ===
      buildOrganizationLogoPublicPath({
        assetId: input.assetId,
        organizationId: input.organizationId,
      })
  );
}

function mutationFailure(
  code: Extract<OrganizationLogoPrepareRpcResponse, { ok: false }>["code"],
  message: string
): Extract<OrganizationLogoPrepareRpcResponse, { ok: false }> {
  return { code, message, ok: false };
}
