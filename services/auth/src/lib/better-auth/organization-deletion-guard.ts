import { isPersonalOrganization } from "@openmeld/auth/server";
import {
  APIError,
  type AuthMiddleware,
  createAuthMiddleware,
} from "better-auth/api";
import { logError } from "../utils/loggers";

const ORGANIZATION_DELETE_PATH = "/organization/delete";

const PERSONAL_ORGANIZATION_UNDELETABLE_RESPONSE = {
  code: "organization.personal_undeletable",
  message: "Personal organizations can’t be deleted.",
} as const;

const ORGANIZATION_DELETION_GUARD_FAILED_RESPONSE = {
  code: "organization.deletion_guard_failed",
  message:
    "OpenMeld couldn’t verify that this organization can be deleted. The organization was not deleted.",
} as const;

type OrganizationDeletionClassification =
  | { status: "deletable" }
  | { status: "indeterminate"; reason: string }
  | { status: "personal" };

type OrganizationMetadataRow = {
  metadata: unknown;
  slug: string;
};

export function createOrganizationDeletionGuard(
  db: D1Database
): AuthMiddleware {
  return createAuthMiddleware(async (context) => {
    if (context.path !== ORGANIZATION_DELETE_PATH) {
      return;
    }

    const organizationId = readOrganizationId(context.body);
    if (!organizationId) {
      return;
    }

    let organization: OrganizationMetadataRow | null;
    try {
      organization = await db
        .prepare("select metadata, slug from organizations where id = ?")
        .bind(organizationId)
        .first<OrganizationMetadataRow>();
    } catch (error) {
      logDeletionGuardFailure({
        error,
        organizationId,
        reason: "organization_metadata_query_failed",
      });
      throw new APIError(
        "SERVICE_UNAVAILABLE",
        ORGANIZATION_DELETION_GUARD_FAILED_RESPONSE
      );
    }

    if (!organization) {
      logDeletionGuardFailure({
        organizationId,
        reason: "organization_not_found",
      });
      throw new APIError(
        "CONFLICT",
        ORGANIZATION_DELETION_GUARD_FAILED_RESPONSE
      );
    }

    const classification = classifyOrganizationDeletion(organization);
    if (classification.status === "personal") {
      throw new APIError(
        "BAD_REQUEST",
        PERSONAL_ORGANIZATION_UNDELETABLE_RESPONSE
      );
    }
    if (classification.status === "indeterminate") {
      logDeletionGuardFailure({
        organizationId,
        reason: classification.reason,
      });
      throw new APIError(
        "CONFLICT",
        ORGANIZATION_DELETION_GUARD_FAILED_RESPONSE
      );
    }
  });
}

function classifyOrganizationDeletion(
  organization: OrganizationMetadataRow
): OrganizationDeletionClassification {
  const personal = isPersonalOrganization(organization);
  if (!personal.ok) {
    return { reason: personal.reason, status: "indeterminate" };
  }
  if (personal.personal) {
    return { status: "personal" };
  }
  return { status: "deletable" };
}

function readOrganizationId(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const organizationId = (body as Record<string, unknown>).organizationId;
  if (typeof organizationId !== "string") {
    return null;
  }

  const normalized = organizationId.trim();
  return normalized.length > 0 ? normalized : null;
}

function logDeletionGuardFailure(input: {
  error?: unknown;
  organizationId: string;
  reason: string;
}): void {
  logError("[auth.organization.deletion_guard_failed]", {
    event: "auth.organization.deletion_guard_failed",
    organizationId: input.organizationId,
    reason: input.reason,
    ...(input.error === undefined
      ? {}
      : {
          error:
            input.error instanceof Error
              ? {
                  message: input.error.message,
                  name: input.error.name,
                }
              : String(input.error),
        }),
  });
}
