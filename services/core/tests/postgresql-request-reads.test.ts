import {
  getPostgresDatabase,
  getPostgresRequestPool,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { env } from "../test-support/worker-env";

describe("PostgreSQL request reads", () => {
  it("preserves Binding owner scope, conflict ordering, exclusion, and fresh reads", async () => {
    const suffix = crypto.randomUUID();
    const owner = { kind: "owner_account" as const, id: `owner-${suffix}` };
    const db = getPostgresDatabase(env);
    const current = `current-${suffix}`;
    const currentProfileId = `agt_${crypto.randomUUID()}`;
    const profiles = new Map<string, string>();
    const organizationId = `org-${suffix}`;
    await db.query({
      ...{
        text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Read test\', $2, 1)',
        values: [],
      },
      values: [organizationId, organizationId],
    });
    for (const ownerId of [owner.id, `other-${suffix}`]) {
      await db.query({
        ...{
          text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, \'Read test\', $2)',
          values: [],
        },
        values: [ownerId, `${ownerId}@example.test`],
      });
    }
    for (const [name, ownerId, controller, state, updated] of [
      [current, owner.id, "builtin:codex", "enabled_primary", 1],
      [`older-${suffix}`, owner.id, "builtin:codex", "enabled_primary", 2],
      [`newer-${suffix}`, owner.id, "builtin:codex", "enabled_primary", 3],
      [
        `disabled-${suffix}`,
        owner.id,
        "builtin:codex",
        "disabled_historical",
        9,
      ],
      [
        `other-owner-${suffix}`,
        `other-${suffix}`,
        "builtin:codex",
        "enabled_primary",
        9,
      ],
      [
        `other-controller-${suffix}`,
        owner.id,
        "builtin:claude-code",
        "enabled_primary",
        9,
      ],
    ] as const) {
      const profileId =
        name === current ? currentProfileId : `agt_${crypto.randomUUID()}`;
      profiles.set(name, profileId);
      await db.query({
        ...{
          text: `INSERT INTO "openmeld"."openmeld_profiles"
        (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, organization_id, source)
        VALUES ($1, 'Read Agent', $2, 'agent', $3, $4, 'cli_create')`,
          values: [],
        },
        values: [profileId, name, ownerId, organizationId],
      });
      await db.query({
        ...{
          text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings"
        (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state, created_at_ms, updated_at_ms, disabled_at_ms)
        VALUES ($1, 'owner_account', $2, $3, 'runtime-test', $4, 'thread-test', $5, 1, $6, $7)`,
          values: [],
        },
        values: [
          `binding-${name}`,
          ownerId,
          profileId,
          controller,
          state,
          updated,
          state === "disabled_historical" ? updated : null,
        ],
      });
    }
    const conflict = {
      db,
      owner,
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "thread-test",
      excludeAgentProfileId: currentProfileId,
    };
    const scalarConflict =
      await readPrimaryAgentProfileBindingRecordByControllerConversation(
        conflict
      );
    expect(scalarConflict?.agentProfileId).toBe(
      profiles.get(`newer-${suffix}`)
    );
    const [binding, wrongOwner, concurrentConflict, blankConversation] =
      await Promise.all([
        readPrimaryAgentProfileBindingRecord({
          db,
          owner,
          agentProfileId: currentProfileId,
        }),
        readPrimaryAgentProfileBindingRecord({
          db,
          owner: { ...owner, id: `other-${suffix}` },
          agentProfileId: currentProfileId,
        }),
        readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
        }),
        readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
          agentControllerConversationId: " ",
        }),
      ]);
    expect(binding).toEqual(
      await readPrimaryAgentProfileBindingRecord({
        db,
        owner,
        agentProfileId: currentProfileId,
      })
    );
    expect(wrongOwner).toBeNull();
    expect(concurrentConflict).toEqual(scalarConflict);
    expect(blankConversation).toBeNull();
    await db.query({
      ...{
        text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET binding_state = \'disabled_historical\', disabled_at_ms = updated_at_ms WHERE binding_id = $1',
        values: [],
      },
      values: [`binding-newer-${suffix}`],
    });
    expect(
      (
        await readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
        })
      )?.agentProfileId
    ).toBe(profiles.get(`older-${suffix}`));
  });
  it("keeps concurrent native query failures distinct from absent rows", async () => {
    const db = getPostgresDatabase(env);
    const outcomes = await withPostgresRequest(env.OPENMELD_POSTGRESQL, () =>
      Promise.allSettled([
        db.query("SELECT 1 AS value"),
        db.query("SELECT 1 / 0"),
      ])
    );
    const success = outcomes[0];
    const failure = outcomes[1];
    expect(success?.status).toBe("fulfilled");
    if (success?.status === "fulfilled") {
      expect(success.value.rows).toEqual([{ value: 1 }]);
    }
    expect(failure?.status).toBe("rejected");
    if (failure?.status === "rejected") {
      expect(failure.reason).toMatchObject({ code: "22012" });
    }
    expect((await db.query("SELECT 2 AS value")).rows).toEqual([{ value: 2 }]);
  });

  it("keeps the request pool attached to the exact database binding", async () => {
    await withPostgresRequest(env.OPENMELD_POSTGRESQL, async () => {
      const runtimePool = getPostgresRequestPool();
      const runtime = await getPostgresDatabase(env).query(
        "SELECT current_user AS role"
      );
      expect(runtime.rows).toEqual([{ role: "openmeld_pg_runtime" }]);
      await withPostgresRequest(env.TEST_POSTGRESQL_OWNER, async () => {
        expect(getPostgresRequestPool()).not.toBe(runtimePool);
        const owner = await new PostgresDatabase(
          env.TEST_POSTGRESQL_OWNER
        ).query("SELECT current_user AS role");
        expect(owner.rows).toEqual([{ role: "openmeld_pg_owner" }]);
      });
      expect(getPostgresRequestPool()).toBe(runtimePool);
      expect(
        (await getPostgresDatabase(env).query("SELECT current_user AS role"))
          .rows
      ).toEqual(runtime.rows);
    });
  });
});
