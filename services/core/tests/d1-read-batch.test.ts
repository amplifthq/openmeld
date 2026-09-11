import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../src/agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { createD1ReadBatch } from "../src/lib/d1-read-batch";

describe("request-local D1 read batching", () => {
  it("preserves Binding owner scope, conflict ordering, exclusion, and fresh reads", async () => {
    const suffix = crypto.randomUUID();
    const owner = { kind: "owner_account" as const, id: `owner-${suffix}` };
    const db = env.OPENMELD_DB;
    const current = `current-${suffix}`;
    const currentProfileId = `agt_${crypto.randomUUID()}`;
    const profiles = new Map<string, string>();
    const organizationId = `org-${suffix}`;
    await db
      .prepare(
        "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Batch test', ?, 1)"
      )
      .bind(organizationId, organizationId)
      .run();
    for (const ownerId of [owner.id, `other-${suffix}`]) {
      await db
        .prepare(
          "INSERT INTO users (id, name, email) VALUES (?, 'Batch test', ?)"
        )
        .bind(ownerId, `${ownerId}@example.test`)
        .run();
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
      await db
        .prepare(`INSERT INTO openmeld_profiles
        (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, organization_id, source)
        VALUES (?, 'Batch Agent', ?, 'agent', ?, ?, 'cli_create')`)
        .bind(profileId, name, ownerId, organizationId)
        .run();
      await db
        .prepare(`INSERT INTO openMeldDaemon_agent_profile_bindings
        (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id,
         agent_controller_ref, agent_controller_conversation_id, binding_state, created_at_ms, updated_at_ms, disabled_at_ms)
        VALUES (?, 'owner_account', ?, ?, 'runtime-test', ?, 'thread-test', ?, 1, ?, ?)`)
        .bind(
          `binding-${name}`,
          ownerId,
          profileId,
          controller,
          state,
          updated,
          state === "disabled_historical" ? updated : null
        )
        .run();
    }
    const readBatch = createD1ReadBatch();
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
    const [binding, wrongOwner, batchedConflict, blankConversation] =
      await Promise.all([
        readPrimaryAgentProfileBindingRecord({
          db,
          owner,
          agentProfileId: currentProfileId,
          readBatch,
        }),
        readPrimaryAgentProfileBindingRecord({
          db,
          owner: { ...owner, id: `other-${suffix}` },
          agentProfileId: currentProfileId,
          readBatch,
        }),
        readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
          readBatch,
        }),
        readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
          agentControllerConversationId: " ",
          readBatch,
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
    expect(batchedConflict).toEqual(scalarConflict);
    expect(blankConversation).toBeNull();
    await db
      .prepare(
        "UPDATE openMeldDaemon_agent_profile_bindings SET binding_state = 'disabled_historical', disabled_at_ms = updated_at_ms WHERE binding_id = ?"
      )
      .bind(`binding-newer-${suffix}`)
      .run();
    expect(
      (
        await readPrimaryAgentProfileBindingRecordByControllerConversation({
          ...conflict,
          readBatch,
        })
      )?.agentProfileId
    ).toBe(profiles.get(`older-${suffix}`));
  });
  it("preserves ordered scalar results, including absence, with bounded round trips", async () => {
    const batch = vi.fn(env.OPENMELD_DB.batch.bind(env.OPENMELD_DB));
    const db = { batch } as unknown as D1Database;
    const reads = createD1ReadBatch();
    const statements = Array.from({ length: 70 }, (_, index) =>
      env.OPENMELD_DB.prepare("SELECT ? AS value WHERE ? != 5 LIMIT 1").bind(
        index,
        index
      )
    );
    const expected = await Promise.all(
      statements.map((statement) => statement.first())
    );
    expect(
      await Promise.all(
        statements.map((statement) => reads.first(db, statement))
      )
    ).toEqual(expected);
    expect(batch.mock.calls.map(([statements]) => statements.length)).toEqual([
      32, 32, 6,
    ]);
  });

  it("isolates database bindings and never reuses a previous result", async () => {
    const reads = createD1ReadBatch();
    const firstBatch = vi.fn(env.OPENMELD_DB.batch.bind(env.OPENMELD_DB));
    const secondBatch = vi.fn(env.OPENMELD_DB.batch.bind(env.OPENMELD_DB));
    const firstDb = { batch: firstBatch } as unknown as D1Database;
    const secondDb = { batch: secondBatch } as unknown as D1Database;
    const statement = env.OPENMELD_DB.prepare("SELECT 1 AS value LIMIT 1");
    await Promise.all([
      reads.first(firstDb, statement),
      reads.first(secondDb, statement),
    ]);
    expect(firstBatch).toHaveBeenCalledOnce();
    expect(secondBatch).toHaveBeenCalledOnce();
    await reads.first(firstDb, statement);
    expect(firstBatch).toHaveBeenCalledTimes(2);
  });

  it("rejects failed or incomplete batches instead of treating them as absent rows", async () => {
    const reads = createD1ReadBatch();
    const failed = await Promise.allSettled([
      reads.first(env.OPENMELD_DB, env.OPENMELD_DB.prepare("SELECT 1 LIMIT 1")),
      reads.first(
        env.OPENMELD_DB,
        env.OPENMELD_DB.prepare(
          "SELECT * FROM missing_readiness_test_table LIMIT 1"
        )
      ),
    ]);
    expect(failed.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    const db = {
      batch: vi.fn().mockResolvedValue([]),
    } as unknown as D1Database;
    await expect(
      reads.first(db, env.OPENMELD_DB.prepare("SELECT 1 LIMIT 1"))
    ).rejects.toThrow("Incomplete D1 readiness read batch.");
    expect(
      await reads.first(
        env.OPENMELD_DB,
        env.OPENMELD_DB.prepare("SELECT 2 AS value LIMIT 1")
      )
    ).toEqual({ value: 2 });
  });
});
