import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  type AccountDeletionPlan,
  type AccountDeletionPreview,
  accountDeletionCleanupResultSchema,
  accountDeletionConnectionCleanupSchema,
  accountDeletionPendingConnectionsSchema,
  accountDeletionPlanSchema,
} from "@openmeld/schemas";
import type { AuthBindings } from "../bindings";

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  member_count: number;
  other_owner_count: number;
};

export class AccountDeletionConflict extends Error {}

async function readOrganizations(
  db: Pick<PostgresDatabase, "query">,
  userId: string
) {
  return (
    await db.query<OrganizationRow>({
      text: `SELECT o.id, o.name, o.slug, m.role,
      (SELECT count(*)::integer FROM "openmeld"."members" x WHERE x.organization_id = o.id) member_count,
      (SELECT count(*)::integer FROM "openmeld"."members" x WHERE x.organization_id = o.id AND x.user_id <> $1 AND 'owner' = ANY(string_to_array(x.role, ','))) other_owner_count
      FROM "openmeld"."organizations" o JOIN "openmeld"."members" m ON m.organization_id = o.id
      WHERE m.user_id = $1 ORDER BY o.id`,
      values: [userId],
    })
  ).rows;
}

async function confirmationToken(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value))
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function readAccountDeletionPreview(input: {
  env: AuthBindings;
  userId: string;
  sessionCreatedAt: Date;
}): Promise<AccountDeletionPreview> {
  const db = getPostgresDatabase(input.env);
  const organizations = await readOrganizations(db, input.userId);
  const deleting = organizations.filter((row) => row.member_count === 1);
  const retained = organizations.filter((row) => row.member_count > 1);
  const blockingOrganizations = retained.filter(
    (row) =>
      row.role.split(",").includes("owner") && row.other_owner_count === 0
  );
  const blockingSpaces: AccountDeletionPreview["blockingSpaces"] = [];
  if (!input.env.OPENMELD_CORE_WORKER) {
    throw new Error("Account cleanup is temporarily unavailable.");
  }
  for (const organization of retained) {
    const result =
      await input.env.OPENMELD_CORE_WORKER.checkSpaceOwnerDeparture({
        organizationId: organization.id,
        userId: input.userId,
      });
    blockingSpaces.push(...result.spaces);
  }
  const password = await db.query({
    text: `SELECT 1 FROM "openmeld"."accounts" WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL`,
    values: [input.userId],
  });
  const view = ({ id, name, slug }: OrganizationRow) => ({ id, name, slug });
  return {
    confirmationToken: await confirmationToken({
      userId: input.userId,
      organizations,
      blockingSpaces,
    }),
    deleteOrganizations: deleting.map(view),
    retainOrganizations: retained.map(view),
    blockingOrganizations: blockingOrganizations.map(view),
    blockingSpaces,
    requiresPassword: password.rows.length > 0,
    requiresSignIn:
      password.rows.length === 0 &&
      Date.now() - input.sessionCreatedAt.getTime() > 10 * 60_000,
  };
}

export async function acceptAccountDeletion(input: {
  env: AuthBindings;
  userId: string;
  expected: AccountDeletionPreview;
}): Promise<void> {
  const db = getPostgresDatabase(input.env);
  await db.transaction(async (client) => {
    const user = (
      await client.query<{ email: string; deleted_at: number | null }>({
        text: 'SELECT email, deleted_at FROM "openmeld"."users" WHERE id = $1 FOR UPDATE',
        values: [input.userId],
      })
    ).rows[0];
    if (!user || user.deleted_at !== null) {
      throw new AccountDeletionConflict("This account is no longer available.");
    }
    // Serialize concurrent last-owner departures and membership admission.
    await client.query({
      text: `SELECT o.id FROM "openmeld"."organizations" o JOIN "openmeld"."members" m ON m.organization_id = o.id WHERE m.user_id = $1 ORDER BY o.id FOR UPDATE OF o`,
      values: [input.userId],
    });
    const organizations = await readOrganizations(client, input.userId);
    const ownerReferences = (
      await client.query<{ space_id: string }>({
        text: `SELECT r.space_id FROM "openmeld"."space_owner_member_references" r JOIN "openmeld"."members" m ON m.id = r.member_id WHERE m.user_id = $1 AND NOT (m.organization_id = ANY($2::text[]))`,
        values: [
          input.userId,
          input.expected.deleteOrganizations.map((row) => row.id),
        ],
      })
    ).rows;
    const token = await confirmationToken({
      userId: input.userId,
      organizations,
      blockingSpaces: [],
    });
    if (
      token !== input.expected.confirmationToken ||
      ownerReferences.length ||
      input.expected.blockingOrganizations.length
    ) {
      throw new AccountDeletionConflict(
        "Your workspace or Space ownership changed. Review the list again."
      );
    }
    const profiles = (
      await client.query<{
        profile_id: string;
        profile_kind: string;
        is_default: number;
      }>({
        text: 'SELECT profile_id, profile_kind, is_default FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 OR organization_id = ANY($2::text[]) ORDER BY profile_id',
        values: [
          input.userId,
          input.expected.deleteOrganizations.map((row) => row.id),
        ],
      })
    ).rows;
    // Old member-private roots are deterministic but predate a root catalog.
    // Include all existing tenants, not only current memberships.
    const privateOrganizations = (
      await client.query<{ id: string }>({
        text: 'SELECT id FROM "openmeld"."organizations" ORDER BY id',
      })
    ).rows;
    const plan: AccountDeletionPlan = {
      deleteOrganizationIds: input.expected.deleteOrganizations.map(
        (row) => row.id
      ),
      privateOrganizationIds: privateOrganizations.map((row) => row.id),
      profileIds: profiles.map((row) => row.profile_id),
      connections: (
        await client.query<{ connection_name: string; service: string }>({
          text: `SELECT connection_name, service FROM "openmeld"."connector_connections" WHERE (user_id = $1 AND scope = 'member') OR organization_id = ANY($2::text[])`,
          values: [
            input.userId,
            input.expected.deleteOrganizations.map((row) => row.id),
          ],
        })
      ).rows.map((row) => ({
        connectionName: row.connection_name,
        service: row.service,
      })),
    };
    const now = Date.now();
    await client.query({
      text: 'INSERT INTO "openmeld"."account_deletion_requests" (user_id, plan_json, created_at_ms, next_attempt_at_ms, pending_connections_json) VALUES ($1, $2, $3, $3, $4)',
      values: [
        input.userId,
        JSON.stringify(plan),
        now,
        JSON.stringify(
          plan.connections.map((connection) => ({
            ...connection,
            cleanupId: crypto.randomUUID(),
          }))
        ),
      ],
    });
    await client.query({
      text: 'UPDATE "openmeld"."organizations" SET deletion_requested_at = $2 WHERE id = ANY($1::text[])',
      values: [plan.deleteOrganizationIds, now],
    });
    await client.query({
      text: `UPDATE "openmeld"."routines" SET status = 'paused', next_due_at = NULL, updated_at_ms = $2 WHERE organization_id = ANY($1::text[])`,
      values: [plan.deleteOrganizationIds, now],
    });
    await client.query({
      text: `UPDATE "openmeld"."users" SET deleted_at = $2, name = 'Deleted account', email = $3, normalized_email = NULL, email_verified = 0, image = NULL, username = NULL, display_username = NULL, last_selected_organization_id = NULL, updated_at = $2 WHERE id = $1`,
      values: [
        input.userId,
        now,
        `deleted-${crypto.randomUUID()}@account.invalid`,
      ],
    });
    for (const table of [
      "sessions",
      "accounts",
      "passkeys",
      "device_codes",
      "user_time_contexts",
    ]) {
      await client.query({
        text: `DELETE FROM "openmeld"."${table}" WHERE user_id = $1`,
        values: [input.userId],
      });
    }
    await client.query({
      text: `DELETE FROM "openmeld"."verifications" WHERE identifier = $1 OR value = $2 OR CASE WHEN value IS JSON THEN value::jsonb ->> 'email' = $1 ELSE false END`,
      values: [user.email, input.userId],
    });
    await client.query({
      text: 'DELETE FROM "openmeld"."invitations" WHERE inviter_id = $1 OR lower(email) = lower($2)',
      values: [input.userId, user.email],
    });
    await client.query({
      text: 'DELETE FROM "openmeld"."members" WHERE user_id = $1 AND NOT (organization_id = ANY($2::text[]))',
      values: [input.userId, plan.deleteOrganizationIds],
    });
    // The canonical deletion trigger queues cancellation and Space reconciliation.
    await client.query({
      text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 OR organization_id = ANY($2::text[])',
      values: [input.userId, plan.deleteOrganizationIds],
    });
    // MemberAgents group the Profiles deleted above; none outlives its owner.
    await client.query({
      text: 'DELETE FROM "openmeld"."member_agents" WHERE owner_user_id = $1 OR organization_id = ANY($2::text[])',
      values: [input.userId, plan.deleteOrganizationIds],
    });
  });
  console.info("[auth.account.deletion_accepted]", {
    event: "auth.account.deletion_accepted",
    userId: input.userId,
  });
}

export async function requestAccountConnectionCleanup(
  env: AuthBindings,
  raw: unknown
): Promise<boolean> {
  const input = accountDeletionConnectionCleanupSchema.parse(raw);
  const db = getPostgresDatabase(env);
  return await db.transaction(async (client) => {
    const row = (
      await client.query<{
        plan_json: string;
        pending_connections_json: string;
      }>({
        text: 'SELECT plan_json,pending_connections_json FROM "openmeld"."account_deletion_requests" WHERE user_id = $1 FOR UPDATE',
        values: [input.userId],
      })
    ).rows[0];
    if (!row) {
      return false;
    }
    const plan = accountDeletionPlanSchema.parse(JSON.parse(row.plan_json));
    if (
      !plan.connections.some(
        (target) =>
          target.connectionName === input.connectionName &&
          target.service === input.service
      )
    ) {
      return false;
    }
    const targets = accountDeletionPendingConnectionsSchema.parse(
      JSON.parse(row.pending_connections_json)
    );
    targets.push({
      connectionName: input.connectionName,
      service: input.service,
      cleanupId: crypto.randomUUID(),
    });
    await client.query({
      text: 'UPDATE "openmeld"."account_deletion_requests" SET pending_connections_json = $2,next_attempt_at_ms = $3 WHERE user_id = $1',
      values: [input.userId, JSON.stringify(targets), Date.now()],
    });
    return true;
  });
}

export async function runAccountDeletionCleanup(
  env: AuthBindings
): Promise<void> {
  if (!env.OPENMELD_CORE_WORKER) {
    return;
  }
  const db = getPostgresDatabase(env);
  const requests = (
    await db.query<{
      user_id: string;
      private_root_index: number;
      completed_at_ms: number | null;
      pending_connections_json: string;
    }>({
      text: `SELECT user_id, private_root_index,completed_at_ms,pending_connections_json FROM "openmeld"."account_deletion_requests" WHERE (completed_at_ms IS NULL OR pending_connections_json <> '[]') AND next_attempt_at_ms <= $1 ORDER BY created_at_ms LIMIT 10`,
      values: [Date.now()],
    })
  ).rows;
  for (const request of requests) {
    try {
      for (const target of accountDeletionPendingConnectionsSchema.parse(
        JSON.parse(request.pending_connections_json)
      )) {
        await env.OPENMELD_CORE_WORKER.cleanupDeletedAccountConnection({
          userId: request.user_id,
          connectionName: target.connectionName,
          service: target.service,
        });
        // Remove this attempt only. A concurrent late configuration may have
        // registered another attempt for the same connection name.
        await db.query({
          text: `UPDATE "openmeld"."account_deletion_requests" SET pending_connections_json = (SELECT COALESCE(jsonb_agg(value),'[]'::jsonb)::text FROM jsonb_array_elements(pending_connections_json::jsonb) WHERE value ->> 'cleanupId' <> $2) WHERE user_id = $1`,
          values: [request.user_id, target.cleanupId],
        });
      }
      if (request.completed_at_ms !== null) {
        continue;
      }
      const result = accountDeletionCleanupResultSchema.parse(
        await env.OPENMELD_CORE_WORKER.cleanupDeletedAccount({
          userId: request.user_id,
          privateRootIndex: Number(request.private_root_index),
        })
      );
      if (result.complete) {
        await db.transaction(async (client) => {
          // Only tenants explicitly closed in this accepted request are removed.
          await client.query({
            text: `DELETE FROM "openmeld"."organizations" WHERE deletion_requested_at IS NOT NULL AND id IN (
              SELECT jsonb_array_elements_text(plan_json::jsonb -> 'deleteOrganizationIds') FROM "openmeld"."account_deletion_requests" WHERE user_id = $1)`,
            values: [request.user_id],
          });
          await client.query({
            text: 'DELETE FROM "openmeld"."members" WHERE user_id = $1',
            values: [request.user_id],
          });
          await client.query({
            text: 'UPDATE "openmeld"."account_deletion_requests" SET completed_at_ms = $2, attempt_count = attempt_count + 1, last_error = NULL WHERE user_id = $1',
            values: [request.user_id, Date.now()],
          });
        });
        console.info("[auth.account.deletion_completed]", {
          event: "auth.account.deletion_completed",
          userId: request.user_id,
        });
        continue;
      }
      await db.query({
        text: 'UPDATE "openmeld"."account_deletion_requests" SET completed_at_ms = COALESCE(completed_at_ms, $2), next_attempt_at_ms = $3, private_root_index = GREATEST(private_root_index, $4), attempt_count = attempt_count + 1, last_error = NULL WHERE user_id = $1',
        values: [
          request.user_id,
          result.complete ? Date.now() : null,
          Date.now() + 60_000,
          result.privateRootIndex,
        ],
      });
      console.info("[auth.account.deletion_cleanup]", {
        event: "auth.account.deletion_cleanup",
        userId: request.user_id,
        complete: result.complete,
      });
    } catch (error) {
      // Keep the durable request; never mark external erasure complete on failure.
      await db.query({
        text: 'UPDATE "openmeld"."account_deletion_requests" SET next_attempt_at_ms = $2, attempt_count = attempt_count + 1, last_error = $3 WHERE user_id = $1',
        values: [
          request.user_id,
          Date.now() + 60_000,
          (error instanceof Error ? error.message : "Cleanup failed").slice(
            0,
            500
          ),
        ],
      });
      console.warn("[auth.account.deletion_cleanup_failed]", {
        event: "auth.account.deletion_cleanup_failed",
        userId: request.user_id,
      });
    }
  }
}
