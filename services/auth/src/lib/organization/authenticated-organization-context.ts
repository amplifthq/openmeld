import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
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
          .query<{
            organization_id: string;
          }>({
            text: `
            SELECT
              organizations.id AS organization_id
            FROM "openmeld"."members"
            INNER JOIN "openmeld"."organizations"
              ON organizations.id = members.organization_id
            WHERE members.user_id = $1
              AND organizations.id = $2
            LIMIT 1
          `,
            values: [input.userId, input.requestedOrganization.organizationId],
          })
          .then((result) => result.rows[0] ?? null)
      : await input.db
          .query<{
            organization_id: string;
          }>({
            text: `
            SELECT
              organizations.id AS organization_id
            FROM "openmeld"."members"
            INNER JOIN "openmeld"."organizations"
              ON organizations.id = members.organization_id
            WHERE members.user_id = $1
              AND organizations.slug = $2
            LIMIT 1
          `,
            values: [
              input.userId,
              input.requestedOrganization.organizationSlug,
            ],
          })
          .then((result) => result.rows[0] ?? null);
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
