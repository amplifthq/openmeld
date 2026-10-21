import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { AssignAgentProfileMemberAgentRpcInput } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  type EnabledPrimaryAgentProfileBindingInput,
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import { assignBoundProfileToMemberAgent } from "../src/member-agent/member-agent-profile-assignment";
import { env } from "../test-support/worker-env";

// developing/product/agent-profiles.md, MemberAgent Layer: a Profile that
// belongs to a MemberAgent cannot change harness, and an assignment never
// groups a Profile under a harness that a concurrent switch replaced.

const db = () => {
  const database = getPostgresDatabase(env);
  if (!database) {
    throw new Error("PostgreSQL test binding is missing");
  }
  return database;
};

type Fixture = {
  claudeMemberAgentId: string;
  codexMemberAgentId: string;
  ownerUserId: string;
  profileId: string;
};

async function seed(input: { assigned: boolean }): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const now = Date.now();
  const fixture: Fixture = {
    claudeMemberAgentId: `ma-claude-${suffix}`,
    codexMemberAgentId: `ma-codex-${suffix}`,
    ownerUserId: `user-${suffix}`,
    profileId: `agt_${suffix}`,
  };
  const organizationId = `org-${suffix}`;
  await db().transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Harness lock', $2, $3)`,
      values: [organizationId, `harness-lock-${suffix}`, now],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, 'Felix', $2, 1, $3, $3)`,
      values: [fixture.ownerUserId, `${fixture.ownerUserId}@example.com`, now],
    });
    await client.query({
      text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', $4)`,
      values: [`member-${suffix}`, organizationId, fixture.ownerUserId, now],
    });
    for (const [id, harnessKind] of [
      [fixture.claudeMemberAgentId, "claude-code"],
      [fixture.codexMemberAgentId, "codex"],
    ] as const) {
      await client.query({
        text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at) VALUES ($1, $2, $3, $4, 'detected', $5, $5)`,
        values: [id, organizationId, fixture.ownerUserId, harnessKind, now],
      });
    }
    await client.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, member_agent_id, created_at, updated_at) VALUES ($1, 'PR Reviewer', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', $4, $5, $5)`,
      values: [
        fixture.profileId,
        organizationId,
        fixture.ownerUserId,
        input.assigned ? fixture.claudeMemberAgentId : null,
        now,
      ],
    });
  });
  return fixture;
}

function bindingRecord(
  fixture: Fixture,
  agentControllerRef: string
): EnabledPrimaryAgentProfileBindingInput {
  const nowMs = Date.now();
  return {
    agentControllerRef,
    agentProfileId: fixture.profileId,
    bindingId: `binding-${crypto.randomUUID()}`,
    createdAtMs: nowMs,
    openMeldServiceRuntimeId: `runtime-${fixture.ownerUserId}`,
    owner: { id: fixture.ownerUserId, kind: "owner_account" },
    updatedAtMs: nowMs,
  };
}

async function bind(fixture: Fixture, agentControllerRef: string) {
  return await ensurePrimaryAgentProfileBindingRecord({
    db: db(),
    record: bindingRecord(fixture, agentControllerRef),
  });
}

async function switchController(fixture: Fixture, agentControllerRef: string) {
  return await reconnectPrimaryAgentProfileBindingRecord({
    acquireExecutionTargetMutationAdmission: async () => undefined,
    db: db(),
    record: bindingRecord(fixture, agentControllerRef),
  });
}

async function readControllerRef(fixture: Fixture) {
  return (
    await readPrimaryAgentProfileBindingRecord({
      agentProfileId: fixture.profileId,
      db: db(),
      owner: { id: fixture.ownerUserId, kind: "owner_account" },
    })
  )?.agentControllerRef;
}

async function readMemberAgentId(fixture: Fixture) {
  const result = await db().query<{ member_agent_id: string | null }>({
    text: `SELECT member_agent_id FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
    values: [fixture.profileId],
  });
  return result.rows[0]?.member_agent_id ?? null;
}

function authWorker(
  assign: (input: AssignAgentProfileMemberAgentRpcInput) => Promise<unknown>
) {
  const assignAgentProfileMemberAgent = vi.fn(assign);
  return {
    assignAgentProfileMemberAgent,
    env: {
      OPENMELD_AUTH_WORKER: { assignAgentProfileMemberAgent },
    } as unknown as Pick<CoreBindings, "OPENMELD_AUTH_WORKER">,
  };
}

describe("MemberAgent harness lock on Binding writes", () => {
  it("refuses to move an assigned Profile to another harness", async () => {
    const fixture = await seed({ assigned: true });
    expect(await bind(fixture, "builtin:claude-code")).toMatchObject({
      status: "accepted",
    });

    expect(await switchController(fixture, "builtin:codex")).toEqual({
      reason: "member_agent_harness_locked",
      status: "rejected",
    });
    // A custom controller has no harness, so it is a change too.
    expect(await switchController(fixture, "custom:my-runner")).toEqual({
      reason: "member_agent_harness_locked",
      status: "rejected",
    });
    expect(await readControllerRef(fixture)).toBe("builtin:claude-code");
    expect(await readMemberAgentId(fixture)).toBe(fixture.claudeMemberAgentId);
  });

  it("refuses the first Binding of an assigned Profile on another harness", async () => {
    const fixture = await seed({ assigned: true });

    expect(await bind(fixture, "builtin:codex")).toEqual({
      reason: "member_agent_harness_locked",
      status: "rejected",
    });
    expect(await readControllerRef(fixture)).toBeUndefined();
  });

  it("allows a same-harness reconnect on an assigned Profile", async () => {
    const fixture = await seed({ assigned: true });
    await bind(fixture, "builtin:claude-code");

    const reconnected = await reconnectPrimaryAgentProfileBindingRecord({
      acquireExecutionTargetMutationAdmission: async () => undefined,
      db: db(),
      record: {
        ...bindingRecord(fixture, "builtin:claude-code"),
        openMeldServiceRuntimeId: `other-runtime-${fixture.ownerUserId}`,
      },
    });

    expect(reconnected).toMatchObject({ status: "accepted" });
  });

  it("allows an unassigned Profile to change harness", async () => {
    const fixture = await seed({ assigned: false });
    await bind(fixture, "builtin:claude-code");

    expect(await switchController(fixture, "builtin:codex")).toMatchObject({
      outcome: "reconnected",
      status: "accepted",
    });
    expect(await switchController(fixture, "custom:my-runner")).toMatchObject({
      status: "accepted",
    });
    expect(await readControllerRef(fixture)).toBe("custom:my-runner");
  });

  it("assigns by the Binding current under the lock, not an earlier read", async () => {
    // Catalog sync read builtin:claude-code, then a controller switch
    // committed builtin:codex before the repair ran.
    const fixture = await seed({ assigned: false });
    await bind(fixture, "builtin:claude-code");
    await switchController(fixture, "builtin:codex");
    const { assignAgentProfileMemberAgent, env: authEnv } = authWorker(
      async () => ({
        ok: true,
        outcome: "assigned",
        memberAgentId: fixture.codexMemberAgentId,
      })
    );

    await assignBoundProfileToMemberAgent(
      authEnv,
      {
        agentProfileId: fixture.profileId,
        db: db(),
        ownerUserId: fixture.ownerUserId,
      },
      { enabled: true }
    );

    expect(assignAgentProfileMemberAgent).toHaveBeenCalledWith({
      harnessKind: "codex",
      ownerUserId: fixture.ownerUserId,
      profileId: fixture.profileId,
    });
  });

  it("serializes a controller switch behind an assignment in flight", async () => {
    const fixture = await seed({ assigned: false });
    await bind(fixture, "builtin:claude-code");
    let authCalled!: (input: AssignAgentProfileMemberAgentRpcInput) => void;
    const authReached = new Promise<AssignAgentProfileMemberAgentRpcInput>(
      (resolve) => {
        authCalled = resolve;
      }
    );
    let releaseAuth!: () => void;
    const authReleased = new Promise<void>((resolve) => {
      releaseAuth = resolve;
    });
    const { env: authEnv } = authWorker(async (input) => {
      authCalled(input);
      await authReleased;
      return {
        ok: true,
        outcome: "assigned",
        memberAgentId: fixture.claudeMemberAgentId,
      };
    });

    const assigning = assignBoundProfileToMemberAgent(
      authEnv,
      {
        agentProfileId: fixture.profileId,
        db: db(),
        ownerUserId: fixture.ownerUserId,
      },
      { enabled: true }
    );
    expect((await authReached).harnessKind).toBe("claude-code");
    // Auth commits the assignment while Core still holds the assignment lock;
    // the account guard on the Profile row takes the owner row FOR SHARE.
    await db().query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = $1 WHERE profile_id = $2`,
      values: [fixture.claudeMemberAgentId, fixture.profileId],
    });
    let switchSettled = false;
    const switching = switchController(fixture, "builtin:codex").finally(() => {
      switchSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(switchSettled).toBe(false);

    releaseAuth();

    expect(await assigning).toBe("assigned");
    expect(await switching).toEqual({
      reason: "member_agent_harness_locked",
      status: "rejected",
    });
    expect(await readControllerRef(fixture)).toBe("builtin:claude-code");
    expect(await readMemberAgentId(fixture)).toBe(fixture.claudeMemberAgentId);
  });
});
