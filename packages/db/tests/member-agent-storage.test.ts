import { HARNESS_KINDS } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
} from "../../../tooling/postgresql/test-harness";
import { MEMBER_AGENT_HARNESS_KINDS } from "../src/auth/member-agent.schema.ts";

const agentProfileId = (suffix: string) =>
  `agt_00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

let harness: PostgresHarness;

async function insertMemberAgent(input: {
  id: string;
  organizationId?: string;
  ownerUserId?: string;
  harnessKind?: string;
  source?: string;
}) {
  await harness.query({
    text: `INSERT INTO "openmeld"."member_agents" (id, organization_id, owner_user_id, harness_kind, source)
      VALUES ($1, $2, $3, $4, $5)`,
    values: [
      input.id,
      input.organizationId ?? "one",
      input.ownerUserId ?? "alice",
      input.harnessKind ?? "claude-code",
      input.source ?? "migrated",
    ],
  });
}

async function insertAgentProfile(input: {
  profileId: string;
  organizationId?: string;
  ownerUserId?: string | null;
  managedRole?: string | null;
  source?: string;
  memberAgentId?: string | null;
}) {
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (
      profile_id, profile_name, profile_handle, profile_kind, organization_id,
      owner_user_id, source, managed_role, member_agent_id
    ) VALUES ($1, $1, $1, 'agent', $2, $3, $4, $5, $6)`,
    values: [
      input.profileId,
      input.organizationId ?? "one",
      input.ownerUserId === undefined ? "alice" : input.ownerUserId,
      input.source ?? "web_create",
      input.managedRole ?? null,
      input.memberAgentId ?? null,
    ],
  });
}

beforeEach(async () => {
  harness = await createPostgresHarness();
  for (const id of ["alice", "bob"]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."users"(id,name,email) VALUES($1,$2,$3)',
      values: [id, id, `${id}@example.com`],
    });
  }
  for (const org of ["one", "two"]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."organizations"(id,name,slug,created_at) VALUES($1,$2,$3,0)',
      values: [org, org, org],
    });
  }
});

afterEach(async () => await harness.close());

describe("member_agents storage", () => {
  it("keeps the stored Harness kinds aligned with the shared schema", () => {
    expect([...MEMBER_AGENT_HARNESS_KINDS]).toEqual([...HARNESS_KINDS]);
  });

  it("stores no status column; state is derived at read time", async () => {
    const columns = await harness.queryAll<{ column_name: string }>({
      text: `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'openmeld' AND table_name = 'member_agents' ORDER BY ordinal_position`,
    });
    expect(columns.map((column) => column.column_name)).toEqual([
      "id",
      "organization_id",
      "owner_user_id",
      "harness_kind",
      "default_profile_id",
      "source",
      "archived_at",
      "created_at",
      "updated_at",
    ]);
  });

  it("allows one MemberAgent per organization, owner and Harness", async () => {
    await insertMemberAgent({ id: "a" });
    await expect(insertMemberAgent({ id: "b" })).rejects.toMatchObject({
      code: "23505",
      constraint: "member_agents_owner_harness_uq_idx",
    });
    await insertMemberAgent({ id: "c", harnessKind: "codex" });
    await insertMemberAgent({ id: "d", organizationId: "two" });
    await insertMemberAgent({ id: "e", ownerUserId: "bob" });
  });

  it("rejects unknown Harness kinds and sources", async () => {
    await expect(
      insertMemberAgent({ id: "a", harnessKind: "custom:ops-bot" })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "member_agents_harness_kind_check",
    });
    await expect(
      insertMemberAgent({ id: "b", source: "inferred" })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "member_agents_source_check",
    });
  });

  it("keeps a Profile and its MemberAgent in the same organization and owner", async () => {
    await insertMemberAgent({ id: "alice-one" });
    await insertAgentProfile({
      profileId: agentProfileId("1"),
      memberAgentId: "alice-one",
    });
    await expect(
      insertAgentProfile({
        profileId: agentProfileId("2"),
        organizationId: "two",
        memberAgentId: "alice-one",
      })
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "openmeld_profiles_member_agent_fk",
    });
    await expect(
      insertAgentProfile({
        profileId: agentProfileId("3"),
        ownerUserId: "bob",
        memberAgentId: "alice-one",
      })
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "openmeld_profiles_member_agent_fk",
    });
  });

  it("never assigns a Profile without an owner", async () => {
    await insertMemberAgent({ id: "alice-two", organizationId: "two" });
    await expect(
      insertAgentProfile({
        profileId: agentProfileId("1"),
        ownerUserId: null,
        memberAgentId: "alice-two",
      })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "openmeld_profiles_member_agent_check",
    });
  });

  it("accepts only one of its own Profiles as the default Profile", async () => {
    await insertMemberAgent({ id: "alice-claude" });
    await insertMemberAgent({ id: "alice-codex", harnessKind: "codex" });
    await insertMemberAgent({ id: "bob-claude", ownerUserId: "bob" });
    await insertAgentProfile({
      profileId: agentProfileId("1"),
      memberAgentId: "alice-claude",
    });
    await insertAgentProfile({
      profileId: agentProfileId("2"),
      memberAgentId: "alice-codex",
    });
    await insertAgentProfile({
      profileId: agentProfileId("3"),
      ownerUserId: "bob",
      memberAgentId: "bob-claude",
    });
    await insertAgentProfile({ profileId: agentProfileId("4") });
    const setDefault = (memberAgentId: string, profile: string) =>
      harness.query({
        text: `UPDATE "openmeld"."member_agents" SET default_profile_id = $2 WHERE id = $1`,
        values: [memberAgentId, agentProfileId(profile)],
      });
    for (const profile of ["2", "3", "4"]) {
      await expect(setDefault("alice-claude", profile)).rejects.toMatchObject({
        code: "23503",
        constraint: "member_agents_default_profile_fk",
      });
    }
    await setDefault("alice-claude", "1");
    // The default Profile cannot move to another MemberAgent while it is default.
    await expect(
      harness.query({
        text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = 'alice-codex' WHERE profile_id = $1`,
        values: [agentProfileId("1")],
      })
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "member_agents_default_profile_fk",
    });
  });

  it("never assigns managed Profiles such as the Center Agent", async () => {
    await insertMemberAgent({ id: "alice-one" });
    await expect(
      insertAgentProfile({
        profileId: agentProfileId("1"),
        ownerUserId: null,
        managedRole: "center_agent",
        memberAgentId: "alice-one",
      })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "openmeld_profiles_member_agent_check",
    });
  });

  it("clears the default Profile when that Profile is deleted", async () => {
    await insertMemberAgent({ id: "alice-one" });
    await insertAgentProfile({
      profileId: agentProfileId("1"),
      memberAgentId: "alice-one",
    });
    await harness.query({
      text: `UPDATE "openmeld"."member_agents" SET default_profile_id = $1 WHERE id = 'alice-one'`,
      values: [agentProfileId("1")],
    });
    await harness.query({
      text: `DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
      values: [agentProfileId("1")],
    });
    expect(
      await harness.queryFirst({
        text: `SELECT default_profile_id FROM "openmeld"."member_agents" WHERE id = 'alice-one'`,
      })
    ).toEqual({ default_profile_id: null });
  });

  it("accepts auto_detected as a Profile source", async () => {
    await insertAgentProfile({
      profileId: agentProfileId("1"),
      source: "auto_detected",
    });
    await expect(
      insertAgentProfile({ profileId: agentProfileId("2"), source: "guessed" })
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "openmeld_profiles_source_check",
    });
  });

  it("removes MemberAgents with their organization", async () => {
    await insertMemberAgent({ id: "alice-one" });
    await insertAgentProfile({
      profileId: agentProfileId("1"),
      memberAgentId: "alice-one",
    });
    await harness.query({
      text: `DELETE FROM "openmeld"."organizations" WHERE id = 'one'`,
    });
    expect(
      await harness.queryAll({
        text: `SELECT id FROM "openmeld"."member_agents"`,
      })
    ).toEqual([]);
  });
});
