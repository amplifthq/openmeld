import {
  createAuthDatabase,
  createDrizzleOpenMeldProfileRepository,
  createOpenMeldProfileService,
} from "@openmeld/auth/server";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
} from "../../../tooling/postgresql/test-harness";
import {
  assignAgentProfileMemberAgentRpc,
  ensureDetectedMemberAgentRpc,
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

async function ensureMemberAgent(harnessKind: string) {
  const ensureOnce = () =>
    inRequest(() =>
      ensureDetectedMemberAgentRpc(
        { organizationId: "one", ownerUserId: "alice", harnessKind },
        { enabled: true, profileService: profileService() }
      )
    );
  const first = await ensureOnce();
  if (!first.ok) {
    throw new Error(first.code);
  }
  // Core assigns the keyed default Profile; Auth then sets the default.
  if (first.defaultProfileCandidateId) {
    await assign({ harnessKind, profileId: first.defaultProfileCandidateId });
  }
  const result = await ensureOnce();
  if (!result.ok) {
    throw new Error(result.code);
  }
  return result.memberAgent;
}

async function createProfile(input: {
  organizationId?: string;
  ownerUserId?: string;
  profileName: string;
}) {
  return await inRequest(() =>
    profileService().createAgentProfile({
      createdByUserId: input.ownerUserId ?? "alice",
      organizationId: input.organizationId ?? "one",
      ownerUserId: input.ownerUserId ?? "alice",
      profileName: input.profileName,
      source: "web_create",
    })
  );
}

function assign(
  input: { harnessKind: string; ownerUserId?: string; profileId: string },
  options: { enabled?: boolean } = {}
) {
  return inRequest(() =>
    assignAgentProfileMemberAgentRpc(
      { ownerUserId: "alice", ...input },
      { enabled: options.enabled ?? true }
    )
  );
}

async function memberAgentIdOf(profileId: string) {
  const { rows } = await harness.query<{ member_agent_id: string | null }>({
    text: `SELECT member_agent_id FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
    values: [profileId],
  });
  return rows[0]?.member_agent_id ?? null;
}

beforeEach(async () => {
  harness = await createPostgresHarness();
  for (const id of ["alice", "mallory"]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."users"(id,name,email) VALUES($1,$2,$3)',
      values: [id, id, `${id}@example.com`],
    });
  }
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations"(id,name,slug,created_at) VALUES('one','one','one',0)`,
  });
  for (const id of ["alice", "mallory"]) {
    await harness.query({
      text: 'INSERT INTO "openmeld"."members"(id,user_id,organization_id,created_at) VALUES($1,$2,$3,0)',
      values: [`${id}-one`, id, "one"],
    });
  }
});

afterEach(async () => await harness.close());

describe("assignAgentProfileMemberAgent RPC", () => {
  it("adds a created Profile to the existing MemberAgent of its Harness", async () => {
    const cursor = await ensureMemberAgent("cursor");
    const profile = await createProfile({ profileName: "Folder Moved" });

    const result = await assign({
      harnessKind: "cursor",
      profileId: profile.profileId,
    });

    expect(result).toEqual({
      ok: true,
      outcome: "assigned",
      memberAgentId: cursor.id,
    });
    const listing = await inRequest(() =>
      listOwnerMemberAgentsRpc(
        { organizationId: "one", ownerUserId: "alice" },
        { enabled: true }
      )
    );
    expect(listing.ok && listing.unassignedProfiles).toEqual([]);
    expect(
      listing.ok &&
        listing.memberAgents[0]?.profiles.map((item) => item.isDefault)
    ).toEqual([true, false]);
    // The default Profile is unchanged.
    expect(listing.ok && listing.memberAgents[0]?.defaultProfileId).toBe(
      cursor.defaultProfileId
    );
  });

  it("is idempotent for a Profile already under that MemberAgent", async () => {
    const cursor = await ensureMemberAgent("cursor");
    const profile = await createProfile({ profileName: "Reviewer" });
    await assign({ harnessKind: "cursor", profileId: profile.profileId });

    expect(
      await assign({ harnessKind: "cursor", profileId: profile.profileId })
    ).toEqual({ ok: true, outcome: "unchanged", memberAgentId: cursor.id });
  });

  it("never creates a MemberAgent", async () => {
    const profile = await createProfile({ profileName: "Reviewer" });

    expect(
      await assign({ harnessKind: "codex", profileId: profile.profileId })
    ).toEqual({ ok: true, outcome: "no_member_agent", memberAgentId: null });
    expect(
      (
        await harness.query({
          text: `SELECT id FROM "openmeld"."member_agents"`,
        })
      ).rows
    ).toHaveLength(0);
  });

  it("never moves a Profile to another Harness's MemberAgent", async () => {
    const cursor = await ensureMemberAgent("cursor");
    await ensureMemberAgent("codex");
    const profile = await createProfile({ profileName: "Reviewer" });
    await assign({ harnessKind: "cursor", profileId: profile.profileId });

    expect(
      await assign({ harnessKind: "codex", profileId: profile.profileId })
    ).toEqual({
      ok: true,
      outcome: "assigned_elsewhere",
      memberAgentId: cursor.id,
    });
    expect(await memberAgentIdOf(profile.profileId)).toBe(cursor.id);
  });

  it("refuses another owner's Profile", async () => {
    await ensureMemberAgent("cursor");
    const profile = await createProfile({
      ownerUserId: "mallory",
      profileName: "Mallory Agent",
    });

    expect(
      await assign({ harnessKind: "cursor", profileId: profile.profileId })
    ).toEqual({ ok: true, outcome: "not_eligible", memberAgentId: null });
    expect(await memberAgentIdOf(profile.profileId)).toBeNull();
  });

  it("is unavailable while the release gate is off", async () => {
    const result = await assign(
      { harnessKind: "cursor", profileId: "agt_missing" },
      { enabled: false }
    );
    expect(result).toMatchObject({ ok: false, code: "member_agents.disabled" });
  });
});
