import {
  isPersonalOrganization,
  memberRoleHasOrganizationPermission,
} from "@openmeld/auth/organization-policy";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { authRpcResolveOrganizationAccountIdentityResultSchema } from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
export type ActiveOrganizationMembership =
  | {
      ok: true;
      memberId: string;
      organizationId: string;
      role: string;
      userId: string;
    }
  | {
      code:
        | "organization.context_required"
        | "organization.context_unavailable"
        | "organization.membership_required"
        | "organization.role_required";
      message: string;
      ok: false;
      status: 403 | 503;
    };
export async function readOrganizationAccountIdentityProjection(input: {
  account?: AuthRpcResolveOrganizationAccountIdentityInput["account"];
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
  requestId?: string | null;
}): Promise<AuthRpcResolveOrganizationAccountIdentityResult | null> {
  const resolveIdentity = input.authWorker?.resolveOrganizationAccountIdentity;
  if (!resolveIdentity) {
    console.warn(
      "[core.organization_context.identity_projection_unavailable]",
      {
        organizationId: input.organizationId,
        requestId: input.requestId ?? null,
      }
    );
    return null;
  }
  try {
    const result = await resolveIdentity({
      ...(input.account ? { account: input.account } : {}),
      organizationId: input.organizationId,
    });
    const parsed =
      authRpcResolveOrganizationAccountIdentityResultSchema.safeParse(result);
    if (!parsed.success) {
      console.warn("[core.organization_context.identity_projection_invalid]", {
        organizationId: input.organizationId,
        requestId: input.requestId ?? null,
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    console.warn("[core.organization_context.identity_projection_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
    });
    return null;
  }
}
export async function resolveActiveOrganizationMembership(input: {
  context: {
    activeOrganizationId?: string | null;
    actorContext: {
      callerPrincipalId?: string | null;
      requestId?: string | null;
    };
  };
  env: CoreBindings;
}): Promise<ActiveOrganizationMembership> {
  const activeOrganizationId = normalizeOptionalText(
    input.context.activeOrganizationId
  );
  const userId = normalizeOptionalText(
    input.context.actorContext.callerPrincipalId
  );
  if (!(activeOrganizationId && userId)) {
    return {
      ok: false,
      code: "organization.context_required",
      message: "Active organization context is required.",
      status: 403,
    };
  }
  return await resolveOrganizationMembership({
    env: input.env,
    organizationId: activeOrganizationId,
    requestId: input.context.actorContext.requestId,
    userId,
  });
}
export async function resolveOrganizationOwnerOrAdminMembership(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<ActiveOrganizationMembership> {
  const membership = await resolveOrganizationMembership(input);
  if (!membership.ok) {
    return membership;
  }
  if (
    !memberRoleHasOrganizationPermission(membership.role, {
      channel: ["connect"],
    })
  ) {
    return {
      code: "organization.role_required",
      message:
        "Only an Organization owner or admin can manage this connection.",
      ok: false,
      status: 403,
    };
  }
  return membership;
}
export async function resolveOrganizationMembershipById(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<ActiveOrganizationMembership> {
  return await resolveOrganizationMembership(input);
}
// Share in-flight reads only within one PostgreSQL request scope. A Durable
// Object gate must not join I/O started outside it, whose completion it blocks.
// Nothing is kept after settlement, so later reads see current membership.
// getPostgresDatabase returns a stable facade inside withPostgresRequest;
// unscoped calls receive new facades and intentionally do not coalesce.
export class ConcurrentOrganizationMembershipReads {
  private readonly inFlightByDatabase = new WeakMap<
    PostgresDatabase,
    Map<string, Promise<ActiveOrganizationMembership>>
  >();

  read(input: {
    env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
    organizationId: string;
    userId: string;
  }): Promise<ActiveOrganizationMembership> {
    if (!input.env.OPENMELD_POSTGRESQL) {
      // Leave context validation and asynchronous binding errors to the resolver.
      return resolveOrganizationMembershipById(input);
    }
    const db = getPostgresDatabase(input.env);
    let inFlightByKey = this.inFlightByDatabase.get(db);
    if (!inFlightByKey) {
      inFlightByKey = new Map();
      this.inFlightByDatabase.set(db, inFlightByKey);
    }
    const key = JSON.stringify([input.organizationId, input.userId]);
    const inFlight = inFlightByKey.get(key);
    if (inFlight) {
      return inFlight;
    }
    const read = resolveOrganizationMembershipById(input).finally(() => {
      inFlightByKey.delete(key);
    });
    inFlightByKey.set(key, read);
    return read;
  }
}
export type OrganizationMembershipWithRouteSlug =
  | {
      ok: true;
      membership: Extract<ActiveOrganizationMembership, { ok: true }>;
      organizationSlug: string | null;
    }
  | Extract<ActiveOrganizationMembership, { ok: false }>;
// One PostgreSQL round trip for callers that need both the caller's
// membership and the Organization route slug. Membership semantics match
// resolveOrganizationMembershipById: a read failure is
// organization.context_unavailable, and a missing Organization or member row
// is organization.membership_required.
export async function resolveOrganizationMembershipWithRouteSlug(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<OrganizationMembershipWithRouteSlug> {
  const organizationId = normalizeOptionalText(input.organizationId);
  const userId = normalizeOptionalText(input.userId);
  if (!(organizationId && userId)) {
    return {
      code: "organization.context_required",
      message: "Active organization context is required.",
      ok: false,
      status: 403,
    };
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return {
      ok: false,
      code: "organization.context_unavailable",
      message: "Organization context could not be verified.",
      status: 503,
    };
  }
  let row: {
    member_id: string | null;
    member_role: string | null;
    slug: string | null;
  } | null;
  try {
    row = await db
      .query<{
        member_id: string | null;
        member_role: string | null;
        slug: string | null;
      }>({
        text: `
          SELECT o.slug, m.id AS member_id, m.role AS member_role
          FROM "openmeld"."organizations" o
          LEFT JOIN "openmeld"."members" m
            ON m.organization_id = o.id
            AND m.user_id = $2
          WHERE o.id = $1
          LIMIT 1
        `,
        values: [organizationId, userId],
      })
      .then((result) => result.rows[0] ?? null);
  } catch (error) {
    console.warn("[core.organization_context.membership_lookup_failed]", {
      activeOrganizationId: organizationId,
      error: error instanceof Error ? error.message : String(error),
      requestId: input.requestId ?? null,
      userId,
    });
    return {
      ok: false,
      code: "organization.context_unavailable",
      message: "Organization context could not be verified.",
      status: 503,
    };
  }
  if (!(row?.member_id && row.member_role)) {
    return {
      ok: false,
      code: "organization.membership_required",
      message: "You are not a member of the active organization.",
      status: 403,
    };
  }
  return {
    ok: true,
    membership: {
      ok: true,
      memberId: row.member_id,
      organizationId,
      role: row.member_role,
      userId,
    },
    organizationSlug: normalizeOptionalText(row.slug),
  };
}
export async function readOrganizationRouteSlug(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
}): Promise<string | null> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return null;
  }
  try {
    const organization = await db
      .query<{
        slug: string;
      }>({
        text: `
          SELECT slug
          FROM "openmeld"."organizations"
          WHERE id = $1
          LIMIT 1
        `,
        values: [input.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    return normalizeOptionalText(organization?.slug);
  } catch (error) {
    console.warn("[core.organization_context.route_slug_lookup_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.organizationId,
      requestId: input.requestId ?? null,
    });
    return null;
  }
}
export async function readOrganizationPersonalClassification(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
}): Promise<
  | {
      ok: true;
      personal: boolean;
    }
  | {
      ok: false;
    }
> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return { ok: false };
  }
  try {
    const organization = await db
      .query<{
        metadata: string | null;
        slug: string;
      }>({
        text: `
          SELECT slug, metadata
          FROM "openmeld"."organizations"
          WHERE id = $1
          LIMIT 1
        `,
        values: [input.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!organization) {
      return { ok: false };
    }
    const classification = isPersonalOrganization(organization);
    if (!classification.ok) {
      console.warn(
        "[core.organization_context.personal_classification_invalid]",
        {
          organizationId: input.organizationId,
          reason: classification.reason,
          requestId: input.requestId ?? null,
        }
      );
      return { ok: false };
    }
    return classification;
  } catch (error) {
    console.warn(
      "[core.organization_context.personal_classification_lookup_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.organizationId,
        requestId: input.requestId ?? null,
      }
    );
    return { ok: false };
  }
}
export async function readOrganizationCreatorUserId(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
}): Promise<string | null> {
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return null;
  }
  const organization = await db
    .query<{
      created_by_user_id: string | null;
    }>({
      text: `
        SELECT created_by_user_id
        FROM "openmeld"."organizations"
        WHERE id = $1
        LIMIT 1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return normalizeOptionalText(organization?.created_by_user_id);
}
async function resolveOrganizationMembership(input: {
  env: Pick<CoreBindings, "OPENMELD_POSTGRESQL">;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<ActiveOrganizationMembership> {
  const activeOrganizationId = normalizeOptionalText(input.organizationId);
  const userId = normalizeOptionalText(input.userId);
  if (!(activeOrganizationId && userId)) {
    return {
      code: "organization.context_required",
      message: "Active organization context is required.",
      ok: false,
      status: 403,
    };
  }
  const db = getPostgresDatabase(input.env);
  if (!db) {
    return {
      ok: false,
      code: "organization.context_unavailable",
      message: "Organization context could not be verified.",
      status: 503,
    };
  }
  try {
    const membership = await db
      .query<{
        id: string;
        role: string;
      }>({
        text: `
          SELECT id, role
          FROM "openmeld"."members"
          WHERE organization_id = $1
            AND user_id = $2
          LIMIT 1
        `,
        values: [activeOrganizationId, userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (membership?.id && membership.role) {
      return {
        ok: true,
        memberId: membership.id,
        organizationId: activeOrganizationId,
        role: membership.role,
        userId,
      };
    }
  } catch (error) {
    console.warn("[core.organization_context.membership_lookup_failed]", {
      activeOrganizationId,
      error: error instanceof Error ? error.message : String(error),
      requestId: input.requestId ?? null,
      userId,
    });
    return {
      ok: false,
      code: "organization.context_unavailable",
      message: "Organization context could not be verified.",
      status: 503,
    };
  }
  return {
    ok: false,
    code: "organization.membership_required",
    message: "You are not a member of the active organization.",
    status: 403,
  };
}
function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
