import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  organizationDashboardArtifactSchema,
  organizationDashboardResponseSchema,
  organizationDashboardRpcInputSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  OrganizationDashboardArtifact,
  OrganizationDashboardMutation,
  OrganizationDashboardRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcListSpaceFileRevisions } from "../rpc/methods";

type DashboardRow = {
  id: string;
  creator_user_id: string | null;
  name: string;
  kind: string;
  repository: string | null;
  has_artifact: boolean;
  artifact: unknown;
  created_at_ms: number;
  updated_at_ms: number;
};
type DashboardActor = { organizationId: string; userId: string; role: string };

function canManageTeam(actor: DashboardActor) {
  return actor.role === "owner" || actor.role === "admin";
}

async function canReadDashboardArtifact(
  env: CoreBindings,
  db: PostgresDatabase,
  context: OpenMeldRequestContext,
  organizationId: string,
  artifact: OrganizationDashboardArtifact
) {
  const indexed = await db.query({
    text: `SELECT 1 FROM "openmeld"."space_index_spaces"
      WHERE organization_id = $1 AND space_id = $2 AND status = 'active'`,
    values: [organizationId, artifact.spaceId],
  });
  if (!indexed.rows.length) {
    return false;
  }
  try {
    const { revisions } = await rpcListSpaceFileRevisions(env, {
      context,
      fileId: artifact.fileId,
      spaceId: artifact.spaceId,
    });
    return revisions.some(
      (revision) =>
        revision.revision === artifact.revision &&
        revision.mimeType === "text/html" &&
        revision.sizeBytes <= 2 * 1024 * 1024
    );
  } catch {
    // No access or source unavailable: don't expose a private artifact pointer.
    return false;
  }
}

async function mutateDashboard(
  db: PostgresDatabase,
  actor: DashboardActor,
  input: OrganizationDashboardMutation
) {
  const now = Date.now();
  const { organizationId, userId } = actor;
  const privileged = canManageTeam(actor);
  if (input.operation === "create") {
    await db.query({
      text: `INSERT INTO "openmeld"."organization_dashboards"
        (id, organization_id, creator_user_id, name, kind, repository, artifact, created_at_ms, updated_at_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
      values: [
        crypto.randomUUID(),
        organizationId,
        userId,
        input.name,
        input.kind,
        input.repository ?? null,
        input.artifact ? JSON.stringify(input.artifact) : null,
        now,
      ],
    });
    return;
  }
  const mutation =
    input.operation === "archive"
      ? { text: "archived_at_ms = $1, artifact = NULL", values: [] }
      : {
          text: "name = $6, kind = $7, repository = $8, artifact = $9::jsonb",
          values: [
            input.name,
            input.kind,
            input.repository ?? null,
            input.artifact ? JSON.stringify(input.artifact) : null,
          ],
        };
  const result = await db.query({
    text: `UPDATE "openmeld"."organization_dashboards" SET updated_at_ms = $1, ${mutation.text}
      WHERE organization_id = $2 AND id = $3 AND archived_at_ms IS NULL
      AND (creator_user_id = $4 OR $5::boolean)
      RETURNING id`,
    values: [
      now,
      organizationId,
      input.id,
      userId,
      privileged,
      ...mutation.values,
    ],
  });
  if (!result.rows.length) {
    throw createCoreRpcHttpError({
      status: 404,
      reason: "Dashboard is unavailable or you cannot manage it.",
    });
  }
}

export async function rpcOrganizationDashboards(
  env: CoreBindings,
  payload: OrganizationDashboardRpcInput
) {
  const { context, input } = organizationDashboardRpcInputSchema.parse(payload);
  const membership = await resolveActiveOrganizationMembership({
    context,
    env,
  });
  if (!membership.ok) {
    throw createCoreRpcHttpError({
      code: membership.code,
      reason: membership.message,
      status: membership.status,
    });
  }
  if (context.actorContext.profileKind !== "human") {
    throw createCoreRpcHttpError({
      status: 403,
      reason: "Open dashboards with your human profile.",
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: membership.organizationId,
    errorCode: "dashboard.organization_mismatch",
    expectedOrganizationId: input.organizationId,
  });
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "Dashboards are temporarily unavailable.",
    });
  }
  if ("operation" in input) {
    if (
      input.operation !== "archive" &&
      input.artifact &&
      !(await canReadDashboardArtifact(
        env,
        db,
        context,
        membership.organizationId,
        input.artifact
      ))
    ) {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "Use an accessible HTML artifact revision from this workspace.",
      });
    }
    await mutateDashboard(db, membership, input);
  }
  const id = "operation" in input ? null : (input.id ?? null);
  const rows = await db.query<DashboardRow>({
    text: `SELECT id, creator_user_id, name, kind, repository, artifact IS NOT NULL AS has_artifact,
      CASE WHEN $2::text IS NOT NULL THEN artifact ELSE NULL END AS artifact, created_at_ms, updated_at_ms
      FROM "openmeld"."organization_dashboards"
      WHERE organization_id = $1 AND archived_at_ms IS NULL AND ($2::text IS NULL OR id = $2)
      ORDER BY updated_at_ms DESC,id ASC`,
    values: [membership.organizationId, id],
  });
  return organizationDashboardResponseSchema.parse({
    organizationId: membership.organizationId,
    dashboards: await Promise.all(
      rows.rows.map(async (row) => {
        const parsed = organizationDashboardArtifactSchema.safeParse(
          row.artifact
        );
        const artifact =
          parsed.success &&
          (await canReadDashboardArtifact(
            env,
            db,
            context,
            membership.organizationId,
            parsed.data
          ))
            ? parsed.data
            : null;
        return {
          id: row.id,
          name: row.name,
          kind: row.kind,
          repository: row.repository,
          hasArtifact: row.has_artifact,
          artifact,
          canManage:
            canManageTeam(membership) ||
            row.creator_user_id === membership.userId,
          createdAt: new Date(Number(row.created_at_ms)).toISOString(),
          updatedAt: new Date(Number(row.updated_at_ms)).toISOString(),
        };
      })
    ),
  });
}
