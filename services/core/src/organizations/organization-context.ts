import { memberRoleHasOrganizationPermission } from "@openmeld/auth";
import { isPersonalOrganization } from "@openmeld/auth/server";
import { authRpcResolveOrganizationAccountIdentityResultSchema } from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
} from "@openmeld/schemas/types";

import { type CoreBindings, identityDb } from "../lib/bindings";

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
  env: Pick<CoreBindings, "OPENMELD_DB">;
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
  env: Pick<CoreBindings, "OPENMELD_DB">;
  organizationId: string;
  requestId?: string | null;
  userId: string;
}): Promise<ActiveOrganizationMembership> {
  return await resolveOrganizationMembership(input);
}

export async function readOrganizationRouteSlug(input: {
  env: Pick<CoreBindings, "OPENMELD_DB">;
  organizationId: string;
  requestId?: string | null;
}): Promise<string | null> {
  const db = identityDb(input.env);
  if (!db) {
    return null;
  }
  try {
    const organization = await db
      .prepare(
        `
          SELECT slug
          FROM organizations
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId)
      .first<{ slug: string }>();
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
  env: Pick<CoreBindings, "OPENMELD_DB">;
  organizationId: string;
  requestId?: string | null;
}): Promise<{ ok: true; personal: boolean } | { ok: false }> {
  const db = identityDb(input.env);
  if (!db) {
    return { ok: false };
  }
  try {
    const organization = await db
      .prepare(
        `
          SELECT slug, metadata
          FROM organizations
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId)
      .first<{ metadata: string | null; slug: string }>();
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
  env: Pick<CoreBindings, "OPENMELD_DB">;
  organizationId: string;
}): Promise<string | null> {
  const db = identityDb(input.env);
  if (!db) {
    return null;
  }
  const organization = await db
    .prepare(
      `
        SELECT created_by_user_id
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{ created_by_user_id: string | null }>();
  return normalizeOptionalText(organization?.created_by_user_id);
}

async function resolveOrganizationMembership(input: {
  env: Pick<CoreBindings, "OPENMELD_DB">;
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

  const db = identityDb(input.env);
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
      .prepare(
        `
          SELECT id, role
          FROM members
          WHERE organization_id = ?
            AND user_id = ?
          LIMIT 1
        `
      )
      .bind(activeOrganizationId, userId)
      .first<{ id: string; role: string }>();
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
