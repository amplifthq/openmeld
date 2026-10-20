import { withPostgresRequest } from "@openmeld/db/postgresql";
import {
  buildMemberAgentProfilesRoute,
  listMemberAgentsResponseSchema,
  MEMBER_AGENT_NOT_FOUND_CODE,
  resolveMemberAgentProfilesResponseSchema,
} from "@openmeld/schemas";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
} from "../../../tooling/postgresql/test-harness";
import type { AppContext } from "../src/lib/context";
import { registerMemberAgentRoutes } from "../src/lib/hono/member-agent-routes";

const agentProfileId = (suffix: string) =>
  `agt_00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

let harness: PostgresHarness;

async function insertAgentProfile(input: {
  profileId: string;
  profileName: string;
  organizationId: string;
  ownerUserId: string | null;
  managedRole?: "center_agent";
  status?: "active" | "disabled";
  createdAt: number;
}) {
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (
      profile_id, profile_name, profile_handle, profile_kind, status,
      organization_id, owner_user_id, source, managed_role, created_at, updated_at
    ) VALUES ($1, $2, $3, 'agent', $4, $5, $6, 'web_create', $7, $8, $8)`,
    values: [
      input.profileId,
      input.profileName,
      input.profileId,
      input.status ?? "active",
      input.organizationId,
      input.ownerUserId,
      input.managedRole ?? null,
      input.createdAt,
    ],
  });
}

async function insertMemberAgent(input: {
  id: string;
  organizationId: string;
  ownerUserId: string;
  harnessKind: string;
  createdAt: number;
}) {
  await harness.query({
    text: `INSERT INTO "openmeld"."member_agents" (
      id, organization_id, owner_user_id, harness_kind, source, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'migrated', $5, $5)`,
    values: [
      input.id,
      input.organizationId,
      input.ownerUserId,
      input.harnessKind,
      input.createdAt,
    ],
  });
}

async function assign(profileId: string, memberAgentId: string) {
  await harness.query({
    text: 'UPDATE "openmeld"."openmeld_profiles" SET member_agent_id = $2 WHERE profile_id = $1',
    values: [profileId, memberAgentId],
  });
}

function createApp(input: {
  enabled: boolean;
  userId: string | null;
  activeOrganizationId: string | null;
}) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    c.set(
      "user",
      (input.userId
        ? { id: input.userId, name: input.userId }
        : null) as AppContext["Variables"]["user"]
    );
    c.set("session", {
      activeOrganizationId: input.activeOrganizationId,
    } as AppContext["Variables"]["session"]);
    await next();
  });
  registerMemberAgentRoutes(app, { enabled: input.enabled });
  return app;
}

async function request(
  app: Hono<AppContext>,
  headers: Record<string, string> = {},
  path = "/v1/member-agents"
) {
  return await withPostgresRequest(harness.binding, async () => {
    const response = await app.request(
      path,
      { headers },
      { OPENMELD_POSTGRESQL: harness.binding }
    );
    return { status: response.status, body: await response.json() };
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
    for (const user of ["alice", "bob"]) {
      await harness.query({
        text: 'INSERT INTO "openmeld"."members"(id,user_id,organization_id,created_at) VALUES($1,$2,$3,0)',
        values: [`${user}-${org}`, user, org],
      });
    }
  }
  await insertAgentProfile({
    profileId: agentProfileId("1"),
    profileName: "Claude Code",
    organizationId: "one",
    ownerUserId: "alice",
    createdAt: 1000,
  });
  await insertAgentProfile({
    profileId: agentProfileId("2"),
    profileName: "PR Reviewer",
    organizationId: "one",
    ownerUserId: "alice",
    createdAt: 900,
  });
  await insertAgentProfile({
    profileId: agentProfileId("3"),
    profileName: "Codex",
    organizationId: "one",
    ownerUserId: "alice",
    createdAt: 1100,
  });
  await insertAgentProfile({
    profileId: agentProfileId("4"),
    profileName: "Never Bound",
    organizationId: "one",
    ownerUserId: "alice",
    createdAt: 1200,
  });
  await insertAgentProfile({
    profileId: agentProfileId("5"),
    profileName: "Other Org",
    organizationId: "two",
    ownerUserId: "alice",
    createdAt: 1000,
  });
  await insertAgentProfile({
    profileId: agentProfileId("6"),
    profileName: "Bob Agent",
    organizationId: "one",
    ownerUserId: "bob",
    createdAt: 1000,
  });
  await insertAgentProfile({
    profileId: agentProfileId("7"),
    profileName: "Center Agent",
    organizationId: "one",
    ownerUserId: null,
    managedRole: "center_agent",
    createdAt: 1000,
  });
  await insertAgentProfile({
    profileId: agentProfileId("8"),
    profileName: "Disabled",
    organizationId: "one",
    ownerUserId: "alice",
    status: "disabled",
    createdAt: 1000,
  });
  await insertMemberAgent({
    id: "ma-alice-one-claude",
    organizationId: "one",
    ownerUserId: "alice",
    harnessKind: "claude-code",
    createdAt: 10,
  });
  await insertMemberAgent({
    id: "ma-alice-one-codex",
    organizationId: "one",
    ownerUserId: "alice",
    harnessKind: "codex",
    createdAt: 20,
  });
  await insertMemberAgent({
    id: "ma-alice-two-claude",
    organizationId: "two",
    ownerUserId: "alice",
    harnessKind: "claude-code",
    createdAt: 10,
  });
  await insertMemberAgent({
    id: "ma-bob-one-claude",
    organizationId: "one",
    ownerUserId: "bob",
    harnessKind: "claude-code",
    createdAt: 10,
  });
  await assign(agentProfileId("1"), "ma-alice-one-claude");
  await assign(agentProfileId("2"), "ma-alice-one-claude");
  await assign(agentProfileId("3"), "ma-alice-one-codex");
  await assign(agentProfileId("5"), "ma-alice-two-claude");
  await assign(agentProfileId("6"), "ma-bob-one-claude");
  await harness.query({
    text: 'UPDATE "openmeld"."member_agents" SET default_profile_id = $2 WHERE id = $1',
    values: ["ma-alice-one-claude", agentProfileId("1")],
  });
  await harness.query({
    text: 'UPDATE "openmeld"."member_agents" SET default_profile_id = $2 WHERE id = $1',
    values: ["ma-alice-one-codex", agentProfileId("3")],
  });
});

afterEach(async () => await harness.close());

describe("GET /v1/member-agents", () => {
  it("groups the signed-in member's Profiles in the current organization by MemberAgent", async () => {
    const { status, body } = await request(
      createApp({ enabled: true, userId: "alice", activeOrganizationId: "one" })
    );

    expect(status).toBe(200);
    expect(listMemberAgentsResponseSchema.parse(body)).toEqual({
      ok: true,
      organizationId: "one",
      memberAgents: [
        {
          id: "ma-alice-one-claude",
          organizationId: "one",
          ownerUserId: "alice",
          harnessKind: "claude-code",
          defaultProfileId: agentProfileId("1"),
          source: "migrated",
          archivedAt: null,
          profiles: [
            {
              openMeldProfileId: agentProfileId("1"),
              profileName: "Claude Code",
              isDefault: true,
            },
            {
              openMeldProfileId: agentProfileId("2"),
              profileName: "PR Reviewer",
              isDefault: false,
            },
          ],
        },
        {
          id: "ma-alice-one-codex",
          organizationId: "one",
          ownerUserId: "alice",
          harnessKind: "codex",
          defaultProfileId: agentProfileId("3"),
          source: "migrated",
          archivedAt: null,
          profiles: [
            {
              openMeldProfileId: agentProfileId("3"),
              profileName: "Codex",
              isDefault: true,
            },
          ],
        },
      ],
      unassignedProfiles: [
        { openMeldProfileId: agentProfileId("4"), profileName: "Never Bound" },
      ],
    });
  });

  it("uses an explicitly requested organization over the Session selection", async () => {
    const { status, body } = await request(
      createApp({
        enabled: true,
        userId: "alice",
        activeOrganizationId: "one",
      }),
      { "x-openmeld-requested-organization-id": "two" }
    );

    expect(status).toBe(200);
    expect(body.organizationId).toBe("two");
    expect(body.memberAgents.map((agent: { id: string }) => agent.id)).toEqual([
      "ma-alice-two-claude",
    ]);
    expect(body.unassignedProfiles).toEqual([]);
  });

  it("rejects an organization the member does not belong to", async () => {
    const { status, body } = await request(
      createApp({
        enabled: true,
        userId: "alice",
        activeOrganizationId: "one",
      }),
      { "x-openmeld-requested-organization-id": "missing" }
    );

    expect(status).toBe(403);
    expect(body.code).toBe("organization.membership_required");
  });

  it("rejects a Session organization the member has left", async () => {
    await harness.query({
      text: `DELETE FROM "openmeld"."members" WHERE id = 'alice-one'`,
    });
    const { status, body } = await request(
      createApp({ enabled: true, userId: "alice", activeOrganizationId: "one" })
    );

    expect(status).toBe(403);
    expect(body.code).toBe("organization.membership_required");
  });

  it("requires a signed-in member and an organization", async () => {
    expect(
      (
        await request(
          createApp({
            enabled: true,
            userId: null,
            activeOrganizationId: "one",
          })
        )
      ).status
    ).toBe(401);
    const noOrganization = await request(
      createApp({ enabled: true, userId: "alice", activeOrganizationId: null })
    );
    expect(noOrganization.status).toBe(400);
    expect(noOrganization.body.code).toBe("organization.context_required");
  });

  it("is unavailable while the MemberAgent flag is off", async () => {
    const { status, body } = await request(
      createApp({
        enabled: false,
        userId: "alice",
        activeOrganizationId: "one",
      })
    );

    expect(status).toBe(404);
    expect(body).toEqual({
      ok: false,
      code: "member_agents.disabled",
      message: "Agents grouped by harness are not available yet.",
    });
  });
});

describe("GET /v1/member-agents/:memberAgentId/profiles", () => {
  const resolve = (
    memberAgentId: string,
    input: { userId: string; organizationId: string; enabled?: boolean }
  ) =>
    request(
      createApp({
        enabled: input.enabled ?? true,
        userId: input.userId,
        activeOrganizationId: input.organizationId,
      }),
      {},
      buildMemberAgentProfilesRoute(memberAgentId)
    );

  it("resolves a teammate's MemberAgent to the Profiles All Agents shows", async () => {
    // A disabled Profile is not in All Agents, so it is not resolved either.
    await assign(agentProfileId("8"), "ma-alice-one-claude");

    const { status, body } = await resolve("ma-alice-one-claude", {
      userId: "bob",
      organizationId: "one",
    });

    expect(status).toBe(200);
    expect(resolveMemberAgentProfilesResponseSchema.parse(body)).toEqual({
      ok: true,
      organizationId: "one",
      memberAgentId: "ma-alice-one-claude",
      ownerUserId: "alice",
      harnessKind: "claude-code",
      defaultProfileId: agentProfileId("1"),
      profileIds: [agentProfileId("2"), agentProfileId("1")],
    });
  });

  it("hides a default Profile the caller cannot see", async () => {
    await harness.query({
      text: `UPDATE "openmeld"."openmeld_profiles" SET status = 'disabled' WHERE profile_id = $1`,
      values: [agentProfileId("3")],
    });

    const { status, body } = await resolve("ma-alice-one-codex", {
      userId: "bob",
      organizationId: "one",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ defaultProfileId: null, profileIds: [] });
  });

  it("reads a MemberAgent of another organization as not found", async () => {
    const { status, body } = await resolve("ma-alice-two-claude", {
      userId: "bob",
      organizationId: "one",
    });

    expect(status).toBe(404);
    expect(body).toMatchObject({
      ok: false,
      code: MEMBER_AGENT_NOT_FOUND_CODE,
    });
    expect(
      (await resolve("ma-missing", { userId: "bob", organizationId: "one" }))
        .status
    ).toBe(404);
  });

  it("rejects a caller who is not a member of the organization", async () => {
    await harness.query({
      text: `DELETE FROM "openmeld"."members" WHERE id = 'bob-one'`,
    });

    const { status, body } = await resolve("ma-alice-one-claude", {
      userId: "bob",
      organizationId: "one",
    });

    expect(status).toBe(403);
    expect(body.code).toBe("organization.membership_required");
    expect(body).not.toHaveProperty("profileIds");
  });

  it("is unavailable while the MemberAgent flag is off", async () => {
    const { status } = await resolve("ma-alice-one-claude", {
      userId: "bob",
      organizationId: "one",
      enabled: false,
    });

    expect(status).toBe(404);
  });
});
