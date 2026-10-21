import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { env } from "../test-support/worker-env";

vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => true,
  isRequestChainEnforced: () => true,
}));

const { rpcListViewerAgentAccessGrants } = await import(
  "../src/agent-access/agent-access-rpc"
);

type Person = { profileId: string; userId: string; name: string };

async function seed() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_viewer_grants_${suffix}`;
  const db = getPostgresDatabase(env);
  if (!db) {
    throw new Error("PostgreSQL is required for this test.");
  }
  const person = (name: string): Person => ({
    name,
    profileId: crypto.randomUUID(),
    userId: `user_${name.toLowerCase()}_${suffix}`,
  });
  const tali = person("Tali");
  const felix = person("Felix");
  const sam = person("Sam");
  const agents = {
    shared: `agt_${crypto.randomUUID()}`,
    revoked: `agt_${crypto.randomUUID()}`,
    disabled: `agt_${crypto.randomUUID()}`,
    deleted: `agt_${crypto.randomUUID()}`,
    samOnly: `agt_${crypto.randomUUID()}`,
  };
  const now = Date.now();
  await db.transaction(async (client) => {
    await client.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, 'Viewer grants', $2, $3)`,
      values: [organizationId, `viewer-grants-${suffix}`, now],
    });
    for (const member of [tali, felix, sam]) {
      await client.query({
        text: `INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $4)`,
        values: [
          member.userId,
          member.name,
          `${member.userId}@example.com`,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $4, 'auth_bootstrap', $5, $5)`,
        values: [
          member.profileId,
          member.name,
          `${member.name.toLowerCase()}-${suffix}`,
          member.userId,
          now,
        ],
      });
      await client.query({
        text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, 'member', $4)`,
        values: [`member_${member.userId}`, organizationId, member.userId, now],
      });
    }
    for (const [key, profileId] of Object.entries(agents)) {
      await client.query({
        text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $1, 'agent', 0, $3, $4, $5, $5, 'cli_create', $6, $6)`,
        values: [
          profileId,
          `Tali ${key}`,
          key === "disabled" ? "disabled" : "active",
          organizationId,
          tali.userId,
          now,
        ],
      });
    }
    const grant = async (input: {
      profileId: string;
      grantee: Person;
      revoked?: boolean;
    }) => {
      await client.query({
        text: `INSERT INTO "openmeld"."agent_profile_access_grants" (id, organization_id, profile_id, grantee_user_id, grantee_kind, scope, granted_by_user_id, granted_at_ms, revoked_at_ms, revoked_by_user_id) VALUES ($1, $2, $3, $4, 'member', 'always', $5, $6, $7, $8)`,
        values: [
          crypto.randomUUID(),
          organizationId,
          input.profileId,
          input.grantee.userId,
          tali.userId,
          now,
          input.revoked ? now + 1 : null,
          input.revoked ? tali.userId : null,
        ],
      });
    };
    await grant({ profileId: agents.shared, grantee: felix });
    await grant({
      profileId: agents.revoked,
      grantee: felix,
      revoked: true,
    });
    await grant({ profileId: agents.disabled, grantee: felix });
    await grant({ profileId: agents.deleted, grantee: felix });
    await client.query({
      text: `DELETE FROM "openmeld"."openmeld_profiles" WHERE profile_id = $1`,
      values: [agents.deleted],
    });
    await grant({ profileId: agents.samOnly, grantee: sam });
  });
  return { organizationId, tali, felix, sam, agents };
}

function contextFor(
  organizationId: string,
  person: Person
): OpenMeldRequestContext {
  return {
    activeOrganizationId: organizationId,
    actorContext: {
      requestId: crypto.randomUUID(),
      openMeldProfileId: person.profileId,
      profileKind: "human",
      profileName: person.name,
      ownerUserId: person.userId,
      callerPrincipalId: person.userId,
    },
  };
}

const profileIdsFor = async (organizationId: string, person: Person) =>
  (
    await rpcListViewerAgentAccessGrants(env as CoreBindings, {
      context: contextFor(organizationId, person),
    })
  ).grants.map((grant) => grant.profileId);

describe("rpcListViewerAgentAccessGrants", () => {
  it("returns only the caller's own standing grants on active Agents", async () => {
    const f = await seed();

    expect(await profileIdsFor(f.organizationId, f.felix)).toEqual([
      f.agents.shared,
    ]);
  });

  it("never shows one member another member's grants", async () => {
    const f = await seed();

    const felixGrants = await profileIdsFor(f.organizationId, f.felix);
    const samGrants = await profileIdsFor(f.organizationId, f.sam);

    expect(samGrants).toEqual([f.agents.samOnly]);
    expect(felixGrants).not.toContain(f.agents.samOnly);
    expect(samGrants).not.toContain(f.agents.shared);
    // The owner holds no grants of their own Agents.
    expect(await profileIdsFor(f.organizationId, f.tali)).toEqual([]);
  });
});
