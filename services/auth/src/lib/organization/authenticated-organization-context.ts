import type {
  AuthOrganizationContextSource,
  OpenMeldRequestedOrganizationSelector,
} from "@openmeld/schemas/types";

export type AuthenticatedOrganizationContext =
  | {
      ok: true;
      activeOrganizationId: string | null;
      source: AuthOrganizationContextSource | null;
    }
  | {
      ok: false;
      code: "organization.membership_required";
      message: string;
    };

export async function resolveAuthenticatedOrganizationContext(input: {
  db: D1Database;
  requestedOrganization?: OpenMeldRequestedOrganizationSelector | null;
  sessionActiveOrganizationId: unknown;
  userId: string;
}): Promise<AuthenticatedOrganizationContext> {
  if (!input.requestedOrganization) {
    const activeOrganizationId = normalizeOptionalText(
      input.sessionActiveOrganizationId
    );
    return {
      ok: true,
      activeOrganizationId,
      source: activeOrganizationId ? "session" : null,
    };
  }

  const row =
    "organizationId" in input.requestedOrganization
      ? await input.db
          .prepare(
            `
            SELECT
              organizations.id AS organization_id
            FROM members
            INNER JOIN organizations
              ON organizations.id = members.organization_id
            WHERE members.user_id = ?
              AND organizations.id = ?
            LIMIT 1
          `
          )
          .bind(input.userId, input.requestedOrganization.organizationId)
          .first<{ organization_id: string }>()
      : await input.db
          .prepare(
            `
            SELECT
              organizations.id AS organization_id
            FROM members
            INNER JOIN organizations
              ON organizations.id = members.organization_id
            WHERE members.user_id = ?
              AND organizations.slug = ?
            LIMIT 1
          `
          )
          .bind(input.userId, input.requestedOrganization.organizationSlug)
          .first<{ organization_id: string }>();
  const activeOrganizationId = normalizeOptionalText(row?.organization_id);
  if (!activeOrganizationId) {
    return {
      ok: false,
      code: "organization.membership_required",
      message: "You do not have access to this organization.",
    };
  }
  return {
    ok: true,
    activeOrganizationId,
    source: "request",
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
