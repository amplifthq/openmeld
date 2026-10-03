import { describe, expect, it } from "vitest";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const ROUTINE_RUN_INDEX_PATTERN = /CREATE INDEX.*\(routine_run_id\)/;

const profileId = "agt_11111111-1111-4111-8111-111111111111";

describe("PostgreSQL migration contracts", () => {
  it("preserves JSON text while rejecting malformed and non-object installation observations", async () => {
    const harness = await createIdentityHarness();
    try {
      const observation = '{"detail":"\\u0000","value":1,"value":2}';
      await harness.db.query({
        text: `INSERT INTO "openmeld"."desktop_update_installations"
          (owner_user_id, installation_id, lane, sequence, observation_json, updated_at_ms)
          VALUES ('owner', 'installation', 'dev-local', 1, $1, 1000)`,
        values: [observation],
      });
      expect(
        await harness.queryFirst({
          text: `SELECT observation_json FROM "openmeld"."desktop_update_installations"
          WHERE installation_id = 'installation'`,
        })
      ).toEqual({ observation_json: observation });
      for (const invalid of ["{", "[]", "null", '"text"']) {
        await expect(
          harness.db.query({
            text: `UPDATE "openmeld"."desktop_update_installations"
            SET observation_json = $1 WHERE installation_id = 'installation'`,
            values: [invalid],
          })
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "desktop_update_installations_json_check",
        });
      }
    } finally {
      await harness.close();
    }
  });

  it("keeps repository scheme matching case insensitive and blocks account deletion with a retained application", async () => {
    const harness = await createIdentityHarness();
    try {
      await harness.db.query(`INSERT INTO "openmeld"."projects"
        (id, organization_id, slug, name, created_by_user_id, repository_url, created_at_ms, updated_at_ms)
        VALUES ('project', 'org', 'project', 'Project', 'owner', 'HTTPS://github.com/example/repository', 1000, 1000)`);
      await harness.db.query(`INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
        VALUES ('applicant', 'Applicant', 'applicant@example.test', 1000, 1000)`);
      await harness.db.query(`INSERT INTO "openmeld"."organization_join_requests"
        (id, organization_id, requested_by_user_id, email, applicant_user_id, status, created_at)
        VALUES ('request', 'org', 'owner', 'applicant@example.test', 'applicant', 'pending', 1000)`);
      await expect(
        harness.db.query(
          `DELETE FROM "openmeld"."users" WHERE id = 'applicant'`
        )
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "organization_join_requests_applicant_user_id_users_id_fk",
      });
      expect(
        await harness.queryFirst({
          text: `SELECT applicant_user_id FROM "openmeld"."organization_join_requests" WHERE id = 'request'`,
        })
      ).toEqual({ applicant_user_id: "applicant" });
    } finally {
      await harness.close();
    }
  });

  it("allows multiple native deliveries for a routine run while retaining its read index", async () => {
    const harness = await createPostgresHarness();
    try {
      const indexes = await harness.queryAll<{
        indexname: string;
        indexdef: string;
      }>({
        text: `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'openmeld'
            AND tablename = 'openMeldRemoteAgent_native_delivery_ledger'`,
      });
      expect(
        indexes.find(
          (index) =>
            index.indexname ===
            "openMeldRemoteAgent_native_delivery_routine_run_unique"
        )
      ).toBeUndefined();
      expect(
        indexes.find(
          (index) =>
            index.indexname ===
            "idx_openMeldRemoteAgent_native_delivery_routine_run"
        )?.indexdef
      ).toMatch(ROUTINE_RUN_INDEX_PATTERN);
    } finally {
      await harness.close();
    }
  });

  it("rejects a Binding owner mismatch and a Profile with a missing owner through the runtime role", async () => {
    const harness = await createIdentityHarness();
    try {
      await harness.db.query({
        text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
          (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
            agent_controller_ref, binding_state, created_at_ms, updated_at_ms)
          VALUES ('binding', 'owner_account', 'owner', $1, 'runtime', 'builtin:codex', 'enabled_primary', 1000, 1000)`,
        values: [profileId],
      });
      await expect(
        harness.db.query({
          text: `UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
          SET owner_id = 'another-owner' WHERE binding_id = 'binding'`,
        })
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "agent_profile_binding_canonical_enabled_check",
      });
      await expect(
        harness.db.query({
          text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
          (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
            agent_controller_ref, binding_state, created_at_ms, updated_at_ms)
          VALUES ('wrong-owner', 'owner_account', 'another-owner', $1, 'runtime', 'builtin:codex', 'enabled_primary', 1000, 1000)`,
          values: [profileId],
        })
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "agent_profile_binding_canonical_enabled_check",
      });
      await expect(
        harness.db.query({
          text: `UPDATE "openmeld"."openmeld_profiles" SET owner_user_id = 'missing-user' WHERE profile_id = $1`,
          values: [profileId],
        })
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "openmeld_profiles_owner_user_id_users_id_fk",
      });
    } finally {
      await harness.close();
    }
  });

  it("durably enqueues profile cleanup when a user deletion cascades to its Profile", async () => {
    const harness = await createIdentityHarness();
    try {
      await expect(
        harness.db.transaction(async (client) => {
          await client.query(
            `DELETE FROM "openmeld"."users" WHERE id = 'owner'`
          );
          expect(
            (
              await client.query(
                `SELECT profile_id FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = $1`,
                [profileId]
              )
            ).rows
          ).toEqual([{ profile_id: profileId }]);
          throw new Error("roll back user deletion");
        })
      ).rejects.toThrow("roll back user deletion");
      expect(
        await harness.queryFirst({
          text: `SELECT id FROM "openmeld"."users" WHERE id = 'owner'`,
        })
      ).toEqual({ id: "owner" });
      expect(
        await harness.queryFirst({
          text: `SELECT profile_id FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = $1`,
          values: [profileId],
        })
      ).toBeNull();
      await harness.db.query(
        `DELETE FROM "openmeld"."users" WHERE id = 'owner'`
      );
      expect(
        await harness.queryFirst({
          text: `SELECT profile_id, owner_user_id, organization_id, profile_kind, attempt_count
          FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = $1`,
          values: [profileId],
        })
      ).toEqual({
        profile_id: profileId,
        owner_user_id: "owner",
        organization_id: "org",
        profile_kind: "agent",
        attempt_count: 0,
      });
      await harness.db.query({
        text: `UPDATE "openmeld"."openmeld_profile_deletion_outbox" SET attempt_count = 3, last_error = 'previous attempt', last_attempt_at_ms = 1000 WHERE profile_id = $1`,
        values: [profileId],
      });
      await seedIdentity(harness);
      await harness.db.query(
        `DELETE FROM "openmeld"."users" WHERE id = 'owner'`
      );
      expect(
        await harness.queryFirst({
          text: `SELECT attempt_count, last_error, last_attempt_at_ms FROM "openmeld"."openmeld_profile_deletion_outbox" WHERE profile_id = $1`,
          values: [profileId],
        })
      ).toEqual({
        attempt_count: 0,
        last_error: null,
        last_attempt_at_ms: null,
      });
    } finally {
      await harness.close();
    }
  });
});

async function createIdentityHarness() {
  const harness = await createPostgresHarness();
  await harness.query(`INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
    VALUES ('org', 'Organization', 'organization', 1000)`);
  await seedIdentity(harness);
  return harness;
}

async function seedIdentity(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await harness.query(`INSERT INTO "openmeld"."users" (id, name, email, created_at, updated_at)
    VALUES ('owner', 'Owner', 'owner@example.test', 1000, 1000)`);
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles"
      (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source)
      VALUES ($1, 'Agent', 'agent', 'agent', 'org', 'owner', 'cli_create')`,
    values: [profileId],
  });
}
