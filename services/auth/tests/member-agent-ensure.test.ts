import {
  createAuthDatabase,
  createDrizzleOpenMeldProfileRepository,
  createOpenMeldProfileService,
} from "@openmeld/auth/server";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { AUTO_DETECTED_PROFILE_NAME_LOCKED_CODE } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
} from "../../../tooling/postgresql/test-harness";
import {
  ensureDetectedMemberAgentRpc,
  listMemberAgentOrganizationIdsRpc,
  listOwnerMemberAgentsRpc,
} from "../src/lib/member-agents/member-agent-rpc";

let harness: PostgresHarness;

function inRequest<T>(work: () => Promise<T>): Promise<T> {
  return withPostgresRequest(harness.binding, work);
}

function profileService() {
  return createOpenMeldProfileService(
    createDrizzleOpenMeldProfileRepository(createAuthDatabase())
  );
}

function ensure(
  input: { organizationId: string; ownerUserId: string; harnessKind: string },
  options: { enabled?: boolean } = {}
) {
  return inRequest(() =>
    ensureDetectedMemberAgentRpc(input, {
      enabled: options.enabled ?? true,
      profileService: profileService(),
    })
  );
}

async function rows<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await harness.query<T>({ text, values })).rows;
}

beforeEach(async () => {
  harness = await createPostgresHarness();
  for (const id of ["alice", "mallory"]) {
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
  // Alice is a member of both organizations; Mallory of none.
  for (const org of ["one", "two"]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."members"(id,user_id,organization_id,created_at) VALUES($1,$2,$3,0)',
      values: [`alice-${org}`, "alice", org],
    });
  }
});

afterEach(async () => await harness.close());

describe("ensureDetectedMemberAgent RPC", () => {
  it("creates the MemberAgent and its default Profile named after the harness", async () => {
    const result = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "claude-code",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.created).toBe(true);
    expect(result.memberAgent).toMatchObject({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "claude-code",
      source: "detected",
      archivedAt: null,
    });
    const [profile] = await rows<{
      profile_id: string;
      profile_name: string;
      source: string;
      member_agent_id: string;
      creation_idempotency_key: string;
    }>(
      `SELECT profile_id, profile_name, source, member_agent_id, creation_idempotency_key
       FROM "openmeld"."openmeld_profiles" WHERE profile_kind = 'agent'`
    );
    expect(profile).toMatchObject({
      profile_id: result.memberAgent.defaultProfileId,
      profile_name: "Claude Code",
      source: "auto_detected",
      creation_idempotency_key: "auto:one:claude-code",
    });
    // Invariant 3: the default Profile belongs to its own MemberAgent.
    expect(profile?.member_agent_id).toBe(result.memberAgent.id);
  });

  it("returns the existing row on repeat without a second Profile", async () => {
    const first = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });
    const second = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });

    expect(first.ok && second.ok).toBe(true);
    if (!(first.ok && second.ok)) {
      return;
    }
    expect(second.created).toBe(false);
    expect(second.memberAgent).toEqual(first.memberAgent);
    expect(
      await rows(`SELECT id FROM "openmeld"."member_agents"`)
    ).toHaveLength(1);
    expect(
      await rows(
        `SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE profile_kind = 'agent'`
      )
    ).toHaveLength(1);
  });

  it("converges two concurrent calls on one MemberAgent and one default Profile", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        ensure({
          organizationId: "one",
          ownerUserId: "alice",
          harnessKind: "claude-code",
        })
      )
    );

    const ensured = results.flatMap((result) => (result.ok ? [result] : []));
    expect(ensured).toHaveLength(4);
    expect(new Set(ensured.map((result) => result.memberAgent.id)).size).toBe(
      1
    );
    expect(ensured.filter((result) => result.created)).toHaveLength(1);
    expect(
      await rows(`SELECT id FROM "openmeld"."member_agents"`)
    ).toHaveLength(1);
    const profiles = await rows<{
      profile_id: string;
      member_agent_id: string;
    }>(
      `SELECT profile_id, member_agent_id FROM "openmeld"."openmeld_profiles" WHERE profile_kind = 'agent'`
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.member_agent_id).toBe(ensured[0]?.memberAgent.id);
    expect(ensured[0]?.memberAgent.defaultProfileId).toBe(
      profiles[0]?.profile_id
    );
  });

  it("keeps one MemberAgent per organization", async () => {
    await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "claude-code",
    });
    await ensure({
      organizationId: "two",
      ownerUserId: "alice",
      harnessKind: "claude-code",
    });

    expect(
      await rows(
        `SELECT organization_id FROM "openmeld"."member_agents" ORDER BY organization_id`
      )
    ).toEqual([{ organization_id: "one" }, { organization_id: "two" }]);
  });

  it("rejects an owner who is not a current member and writes nothing", async () => {
    const result = await ensure({
      organizationId: "one",
      ownerUserId: "mallory",
      harnessKind: "claude-code",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "organization.membership_required",
    });
    expect(await rows(`SELECT id FROM "openmeld"."member_agents"`)).toEqual([]);
    expect(
      await rows(
        `SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = 'mallory'`
      )
    ).toEqual([]);
  });

  it("refuses hosted harnesses and the disabled release flag", async () => {
    expect(
      await ensure({
        organizationId: "one",
        ownerUserId: "alice",
        harnessKind: "hosted",
      })
    ).toMatchObject({ ok: false, code: "member_agents.invalid_input" });
    expect(
      await ensure(
        { organizationId: "one", ownerUserId: "alice", harnessKind: "codex" },
        { enabled: false }
      )
    ).toMatchObject({ ok: false, code: "member_agents.disabled" });
    expect(await rows(`SELECT id FROM "openmeld"."member_agents"`)).toEqual([]);
  });

  it("returns a migrated MemberAgent unchanged", async () => {
    await harness.query({
      text: `INSERT INTO "openmeld"."member_agents"
        (id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at)
        VALUES ('ma-migrated', 'one', 'alice', 'codex', 'migrated', 1, 1)`,
    });

    const result = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });

    expect(result).toMatchObject({
      ok: true,
      created: false,
      memberAgent: { id: "ma-migrated", defaultProfileId: null },
    });
    expect(
      await rows(
        `SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE profile_kind = 'agent'`
      )
    ).toEqual([]);
  });

  it("resumes an interrupted creation but never recreates a deleted default", async () => {
    const created = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "cursor",
    });
    if (!created.ok) {
      throw new Error("setup failed");
    }
    // Simulate a crash after the Profile and MemberAgent writes.
    await harness.query({
      text: `UPDATE "openmeld"."member_agents" SET default_profile_id = NULL WHERE id = $1`,
      values: [created.memberAgent.id],
    });
    await harness.query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = NULL WHERE profile_id = $1`,
      values: [created.memberAgent.defaultProfileId],
    });

    const resumed = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "cursor",
    });
    expect(resumed).toMatchObject({
      ok: true,
      created: false,
      memberAgent: {
        id: created.memberAgent.id,
        defaultProfileId: created.memberAgent.defaultProfileId,
      },
    });

    // The owner deletes the default Profile; the foreign key clears it.
    await harness.query({
      text: `DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
      values: [created.memberAgent.defaultProfileId],
    });
    const afterDelete = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "cursor",
    });
    expect(afterDelete).toMatchObject({
      ok: true,
      created: false,
      memberAgent: { id: created.memberAgent.id, defaultProfileId: null },
    });
    expect(
      await rows(
        `SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE profile_kind = 'agent'`
      )
    ).toEqual([]);
  });

  it("locks the detected default Profile name", async () => {
    const created = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "claude-code",
    });
    if (!(created.ok && created.memberAgent.defaultProfileId)) {
      throw new Error("setup failed");
    }
    const profileId = created.memberAgent.defaultProfileId;

    await expect(
      inRequest(() =>
        profileService().updateProfileNameForOwner({
          ownerUserId: "alice",
          profileId,
          profileName: "My Claude",
        })
      )
    ).rejects.toMatchObject({ code: AUTO_DETECTED_PROFILE_NAME_LOCKED_CODE });
  });

  it("locks a migrated default Profile name but not its other Profiles", async () => {
    const created = await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });
    if (!(created.ok && created.memberAgent.defaultProfileId)) {
      throw new Error("setup failed");
    }
    const defaultProfileId = created.memberAgent.defaultProfileId;
    // A migrated default keeps its original source; the lock follows the
    // MemberAgent's default, not the source.
    await harness.query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET source = 'web_create' WHERE profile_id = $1`,
      values: [defaultProfileId],
    });
    await harness.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles"
        (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source, member_agent_id)
        VALUES ('agt_99999999-9999-4999-8999-999999999999', 'PR Reviewer', 'pr-reviewer', 'agent', 'one', 'alice', 'web_create', $1)`,
      values: [created.memberAgent.id],
    });

    await expect(
      inRequest(() =>
        profileService().updateProfileNameForOwner({
          ownerUserId: "alice",
          profileId: defaultProfileId,
          profileName: "My Codex",
        })
      )
    ).rejects.toMatchObject({ code: AUTO_DETECTED_PROFILE_NAME_LOCKED_CODE });
    await expect(
      inRequest(() =>
        profileService().updateProfileNameForOwner({
          ownerUserId: "alice",
          profileId: "agt_99999999-9999-4999-8999-999999999999",
          profileName: "Release Reviewer",
        })
      )
    ).resolves.toMatchObject({ profileName: "Release Reviewer" });
  });
});

describe("MemberAgent listing RPCs", () => {
  it("lists the owner's MemberAgents only while the owner is a member", async () => {
    await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });

    const listing = await inRequest(() =>
      listOwnerMemberAgentsRpc(
        { organizationId: "one", ownerUserId: "alice" },
        { enabled: true }
      )
    );
    expect(listing).toMatchObject({
      ok: true,
      organizationId: "one",
      memberAgents: [{ harnessKind: "codex", profiles: [{ isDefault: true }] }],
    });
    expect(
      await inRequest(() =>
        listOwnerMemberAgentsRpc(
          { organizationId: "one", ownerUserId: "mallory" },
          { enabled: true }
        )
      )
    ).toMatchObject({ ok: false, code: "organization.membership_required" });
  });

  it("names only organizations where the owner has a MemberAgent and is still a member", async () => {
    await ensure({
      organizationId: "one",
      ownerUserId: "alice",
      harnessKind: "codex",
    });
    await ensure({
      organizationId: "two",
      ownerUserId: "alice",
      harnessKind: "codex",
    });
    await harness.query({
      text: `DELETE FROM "openmeld"."members" WHERE id = 'alice-two'`,
    });

    expect(
      await inRequest(() =>
        listMemberAgentOrganizationIdsRpc(
          { ownerUserId: "alice" },
          { enabled: true }
        )
      )
    ).toEqual({ ok: true, organizationIds: ["one"] });
  });
});

describe("ensureDetectedMemberAgent membership race", () => {
  it("does not insert a MemberAgent once the owner is no longer a member", async () => {
    // The owner leaves between the first membership check and the insert.
    const result = await inRequest(async () => {
      const service = profileService();
      return await ensureDetectedMemberAgentRpc(
        { organizationId: "one", ownerUserId: "alice", harnessKind: "codex" },
        {
          enabled: true,
          profileService: {
            createAgentProfile: async (input) => {
              const profile = await service.createAgentProfile(input);
              await harness.query({
                text: `DELETE FROM "openmeld"."members" WHERE id = 'alice-one'`,
              });
              return profile;
            },
          },
        }
      );
    });

    expect(result).toMatchObject({
      ok: false,
      code: "organization.membership_required",
    });
    expect(await rows(`SELECT id FROM "openmeld"."member_agents"`)).toEqual([]);
  });
});
