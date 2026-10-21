import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase, type QueryConfig } from "@openmeld/db/postgresql";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentCreateProject,
  rpcCenterAgentListProjects,
  rpcCenterAgentPrepareRemoveProject,
  rpcCenterAgentRemoveProject,
  rpcCenterAgentSetAgentProfileDefaultProject,
  rpcCenterAgentUpdateProject,
} from "../src/projects/project-center-agent-rpc";
import { env } from "../test-support/worker-env";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const ownedFixtures: Array<{
  organizationId: string;
  userIds: string[];
}> = [];
afterEach(async () => {
  for (const fixture of ownedFixtures.splice(0)) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_project_remove_confirmations" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_project_operations" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_audit_journal" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."projects" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE organization_id = $1 OR owner_user_id IN ($2, $3)',
              values: [],
            },
            values: [
              fixture.organizationId,
              fixture.userIds[0],
              fixture.userIds[1],
            ],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
          ...fixture.userIds.map((userId) => ({
            ...{
              text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
              values: [],
            },
            values: [userId],
          })),
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
});
describe("Center Agent Project RPC", () => {
  it("creates once, replays safely, lists a safe projection, and audits the represented member", async () => {
    const fixture = await seedCenterAgentProjectOrganization();
    const request = {
      context: fixture.context("create-request"),
      executionMode: "interactive" as const,
      name: "OpenMeld",
      operationId: "create-openmeld",
      repositoryUrl: "https://github.com/amplifthq/openmeld",
      speakerMember: fixture.speakerMember,
    };
    const created = await rpcCenterAgentCreateProject(coreEnv(), request);
    const replayed = await rpcCenterAgentCreateProject(coreEnv(), request);
    const listed = await rpcCenterAgentListProjects(coreEnv(), {
      context: fixture.context("list-request"),
      executionMode: "routine",
      speakerMember: fixture.speakerMember,
    });
    expect(created).toMatchObject({
      outcome: "created",
      project: {
        name: "OpenMeld",
        repositoryUrl: "https://github.com/amplifthq/openmeld",
      },
    });
    expect(replayed).toEqual({ ...created, outcome: "replayed" });
    expect(listed).toEqual({
      hasMore: false,
      projects: [created.project],
    });
    expect(Object.keys(listed.projects[0] ?? {})).toEqual([
      "canArchive",
      "canManage",
      "id",
      "name",
      "repositoryUrl",
      "slug",
    ]);
    const projectCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."projects" WHERE organization_id = $1 AND archived_at_ms IS NULL',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(Number(projectCount?.count)).toBe(1);
    const audits = await getPostgresDatabase(env).query<{
      action: string;
      on_behalf_of_profile_id: string | null;
      on_behalf_of_user_id: string | null;
    }>({
      ...{
        text: `
        SELECT action, on_behalf_of_profile_id, on_behalf_of_user_id
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1
        ORDER BY created_at ASC
      `,
        values: [],
      },
      values: [fixture.organizationId],
    });
    expect(audits.rows).toEqual([
      {
        action: "create_project",
        on_behalf_of_profile_id: fixture.speakerProfileId,
        on_behalf_of_user_id: fixture.speakerUserId,
      },
      {
        action: "read_projects",
        on_behalf_of_profile_id: fixture.speakerProfileId,
        on_behalf_of_user_id: fixture.speakerUserId,
      },
    ]);
  });
  it("rejects reuse of an operation ID for a different request", async () => {
    const fixture = await seedCenterAgentProjectOrganization();
    const base = {
      context: fixture.context("create-request"),
      executionMode: "interactive" as const,
      operationId: "same-operation",
      speakerMember: fixture.speakerMember,
    };
    await rpcCenterAgentCreateProject(coreEnv(), {
      ...base,
      name: "First Project",
    });
    await expect(
      rpcCenterAgentCreateProject(coreEnv(), {
        ...base,
        name: "Different Project",
      })
    ).rejects.toThrow("project.operation_conflict");
  });
  it("allows ordinary Routine Project writes but rejects Project removal", async () => {
    const fixture = await seedCenterAgentProjectOrganization();
    await expect(
      rpcCenterAgentListProjects(coreEnv(), {
        context: fixture.context("routine-list"),
        executionMode: "routine",
        speakerMember: fixture.speakerMember,
      })
    ).resolves.toEqual({
      hasMore: false,
      projects: [],
    });
    const created = await rpcCenterAgentCreateProject(coreEnv(), {
      context: fixture.context("routine-create"),
      executionMode: "routine",
      name: "Routine Project",
      operationId: "routine-create",
      speakerMember: fixture.speakerMember,
    });
    await expect(
      rpcCenterAgentUpdateProject(coreEnv(), {
        context: fixture.context("routine-update"),
        executionMode: "routine",
        name: "Routine update",
        operationId: "routine-update",
        projectId: created.project.id,
        speakerMember: fixture.speakerMember,
      })
    ).resolves.toMatchObject({ project: { name: "Routine update" } });
    await expect(
      rpcCenterAgentPrepareRemoveProject(coreEnv(), {
        context: fixture.context("routine-prepare-remove"),
        executionMode: "routine",
        projectId: created.project.id,
        speakerMember: fixture.speakerMember,
      })
    ).rejects.toThrow("routine_destructive_action_unsupported");
    const projectCount = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."projects" WHERE organization_id = $1 AND archived_at_ms IS NULL',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(Number(projectCount?.count)).toBe(1);
  });
  it("allows same-turn removal with a bound token and replays the operation", async () => {
    const fixture = await seedCenterAgentProjectOrganization();
    const created = await rpcCenterAgentCreateProject(coreEnv(), {
      context: fixture.context("create-request"),
      executionMode: "interactive",
      name: "Temporary Project",
      operationId: "create-temporary",
      speakerMember: fixture.speakerMember,
    });
    const prepared = await rpcCenterAgentPrepareRemoveProject(coreEnv(), {
      context: fixture.context("prepare-remove"),
      executionMode: "interactive",
      projectId: created.project.id,
      speakerMember: fixture.speakerMember,
    });
    const removed = await rpcCenterAgentRemoveProject(coreEnv(), {
      confirmationToken: prepared.confirmation.token,
      context: fixture.context("prepare-remove"),
      executionMode: "interactive",
      operationId: "remove-temporary",
      speakerMember: fixture.speakerMember,
    });
    const replayed = await rpcCenterAgentRemoveProject(coreEnv(), {
      confirmationToken: prepared.confirmation.token,
      context: fixture.context("confirm-remove-retry"),
      executionMode: "interactive",
      operationId: "remove-temporary",
      speakerMember: fixture.speakerMember,
    });
    expect(removed).toMatchObject({
      outcome: "removed",
      project: { id: created.project.id },
    });
    expect(replayed).toEqual({ ...removed, outcome: "replayed" });
    const storedConfirmation = await getPostgresDatabase(env)
      .query<{
        consumed_operation_id: string;
        token_hash: string;
      }>({
        ...{
          text: `
        SELECT token_hash, consumed_operation_id
        FROM "openmeld"."center_agent_project_remove_confirmations"
        WHERE project_id = $1
      `,
          values: [],
        },
        values: [created.project.id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(storedConfirmation).toMatchObject({
      consumed_operation_id: "remove-temporary",
      token_hash: expect.stringMatching(SHA256_HEX_PATTERN),
    });
    expect(storedConfirmation?.token_hash).not.toContain(
      prepared.confirmation.token
    );
  });
  it("sets a local Agent Profile Default Project through represented-member authority", async () => {
    const fixture = await seedCenterAgentProjectOrganization();
    const created = await rpcCenterAgentCreateProject(coreEnv(), {
      context: fixture.context("create-request"),
      executionMode: "interactive",
      name: "Default Project",
      operationId: "create-default",
      speakerMember: fixture.speakerMember,
    });
    const mutationOrder: string[] = [];
    const updateAgentProfileDefaultProjectInOrganization = vi.fn(() => {
      mutationOrder.push("update");
      return Promise.resolve({
        ok: true as const,
        profile: {
          createdAt: new Date().toISOString(),
          createdByUserId: fixture.speakerUserId,
          creatorProfileId: fixture.speakerProfileId,
          defaultProjectId: created.project.id,
          isDefault: false,
          lastUsedAt: null,
          managedRole: null,
          ownerUserId: fixture.speakerUserId,
          profileHandle: "codex",
          profileKind: "agent" as const,
          profileName: "Codex",
          source: "user",
          status: "active" as const,
          updatedAt: new Date().toISOString(),
          openMeldProfileId: fixture.localAgentProfileId,
        },
      });
    });
    const acquire = vi.fn((input: { operationId: string }) => {
      mutationOrder.push("acquire");
      return Promise.resolve({
        expiresAtMs: Date.now() + 30_000,
        operationId: input.operationId,
        status: "acquired" as const,
      });
    });
    const release = vi.fn(() => {
      mutationOrder.push("release");
      return Promise.resolve({ status: "released" as const });
    });
    await expect(
      rpcCenterAgentSetAgentProfileDefaultProject(
        coreEnv(
          { updateAgentProfileDefaultProjectInOrganization },
          {
            rpcAcquireAgentProfileFutureWorkSettingsMutation: acquire,
            rpcReleaseAgentProfileControllerMutation: release,
          }
        ),
        {
          agentProfileId: fixture.localAgentProfileId,
          context: fixture.context("set-default"),
          executionMode: "interactive",
          operationId: "set-default-project",
          projectId: created.project.id,
          speakerMember: fixture.speakerMember,
        }
      )
    ).resolves.toMatchObject({
      agentProfile: {
        defaultProjectId: created.project.id,
        id: fixture.localAgentProfileId,
        name: "Codex",
      },
      outcome: "updated",
      project: { id: created.project.id },
    });
    expect(updateAgentProfileDefaultProjectInOrganization).toHaveBeenCalledWith(
      {
        defaultProjectId: created.project.id,
        organizationId: fixture.organizationId,
        ownerUserId: fixture.speakerUserId,
        profileId: fixture.localAgentProfileId,
      }
    );
    expect(mutationOrder).toEqual(["acquire", "update", "release"]);
  });
});
function coreEnv(
  authWorker: Partial<NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>> = {},
  runtimeTransportStub?: Record<string, unknown>
): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: authWorker,
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    ...(runtimeTransportStub
      ? {
          OPENMELD_RUNTIME_TRANSPORT: {
            get: vi.fn(() => runtimeTransportStub),
            idFromName: vi.fn((value: string) => value),
          },
        }
      : {}),
    OPENMELD_SPACES: env.OPENMELD_SPACES,
  } as CoreBindings;
}
async function seedCenterAgentProjectOrganization() {
  const suffix = crypto.randomUUID();
  const nowMs = Date.now();
  const organizationId = `org_center_agent_project_${suffix}`;
  const ownerUserId = `user_center_agent_owner_${suffix}`;
  const speakerUserId = `user_center_agent_speaker_${suffix}`;
  const ownerProfileId = crypto.randomUUID();
  const speakerProfileId = crypto.randomUUID();
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  const localAgentProfileId = `agt_${crypto.randomUUID()}`;
  const ownerMemberId = `member_center_agent_owner_${suffix}`;
  const speakerMemberId = `member_center_agent_speaker_${suffix}`;
  ownedFixtures.push({
    organizationId,
    userIds: [ownerUserId, speakerUserId],
  });
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, 'Center Agent Owner', $2, 1, $3, $4)
      `,
            values: [],
          },
          values: [ownerUserId, `${ownerUserId}@example.test`, nowMs, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, 'Project Speaker', $2, 1, $3, $4)
      `,
            values: [],
          },
          values: [
            speakerUserId,
            `${speakerUserId}@example.test`,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
        VALUES ($1, 'Center Agent Project Organization', $2, $3)
      `,
            values: [],
          },
          values: [organizationId, `center-agent-project-${suffix}`, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'owner', $4)
      `,
            values: [],
          },
          values: [ownerMemberId, organizationId, ownerUserId, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, 'member', $4)
      `,
            values: [],
          },
          values: [speakerMemberId, organizationId, speakerUserId, nowMs],
        },
        humanProfileStatement({
          handle: `center-agent-owner-${suffix}`,
          nowMs,
          profileId: ownerProfileId,
          profileName: "Center Agent Owner",
          userId: ownerUserId,
        }),
        humanProfileStatement({
          handle: `project-speaker-${suffix}`,
          nowMs,
          profileId: speakerProfileId,
          profileName: "Project Speaker",
          userId: speakerUserId,
        }),
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          organization_id,
          owner_user_id,
          created_by_user_id,
          source,
          managed_role,
          created_at,
          updated_at
        ) VALUES ($1, 'Project Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            centerAgentProfileId,
            `project-center-agent-${suffix}`,
            organizationId,
            ownerUserId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."center_agent_designations" (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES ($1, $2, NULL, $3, $4)
      `,
            values: [],
          },
          values: [organizationId, centerAgentProfileId, ownerUserId, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    context: (requestId: string) => ({
      activeOrganizationId: organizationId,
      actorContext: {
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        callerPrincipalId: centerAgentProfileId,
        profileKind: "agent" as const,
        requestId,
        openMeldProfileId: centerAgentProfileId,
      },
      agentControllerConversationId: `conversation_${suffix}`,
    }),
    localAgentProfileId,
    organizationId,
    speakerMember: {
      memberId: speakerMemberId,
      userId: speakerUserId,
    },
    speakerProfileId,
    speakerUserId,
  };
}
function humanProfileStatement(input: {
  handle: string;
  nowMs: number;
  profileId: string;
  profileName: string;
  userId: string;
}): QueryConfig {
  return {
    ...{
      text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_by_user_id,
        source,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 'human', 1, 'active', NULL, $4, $5, 'auth_bootstrap', $6, $7)
    `,
      values: [],
    },
    values: [
      input.profileId,
      input.profileName,
      input.handle,
      input.userId,
      input.userId,
      input.nowMs,
      input.nowMs,
    ],
  };
}
