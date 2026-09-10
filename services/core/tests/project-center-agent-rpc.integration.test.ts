import { env } from "cloudflare:test";
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

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const ownedFixtures: Array<{
  organizationId: string;
  userIds: string[];
}> = [];

afterEach(async () => {
  for (const fixture of ownedFixtures.splice(0)) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_project_remove_confirmations WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_project_operations WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_audit_journal WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM projects WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_designations WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openmeld_profiles WHERE organization_id = ? OR owner_user_id IN (?, ?)"
      ).bind(fixture.organizationId, fixture.userIds[0], fixture.userIds[1]),
      env.OPENMELD_DB.prepare(
        "DELETE FROM members WHERE organization_id = ?"
      ).bind(fixture.organizationId),
      env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
        fixture.organizationId
      ),
      ...fixture.userIds.map((userId) =>
        env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(userId)
      ),
    ]);
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

    const projectCount = await env.OPENMELD_DB.prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE organization_id = ? AND archived_at_ms IS NULL"
    )
      .bind(fixture.organizationId)
      .first<{ count: number }>();
    expect(Number(projectCount?.count)).toBe(1);

    const audits = await env.OPENMELD_DB.prepare(
      `
        SELECT action, on_behalf_of_profile_id, on_behalf_of_user_id
        FROM center_agent_audit_journal
        WHERE organization_id = ?
        ORDER BY created_at ASC
      `
    )
      .bind(fixture.organizationId)
      .all<{
        action: string;
        on_behalf_of_profile_id: string | null;
        on_behalf_of_user_id: string | null;
      }>();
    expect(audits.results).toEqual([
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

    const projectCount = await env.OPENMELD_DB.prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE organization_id = ? AND archived_at_ms IS NULL"
    )
      .bind(fixture.organizationId)
      .first<{ count: number }>();
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
    const storedConfirmation = await env.OPENMELD_DB.prepare(
      `
        SELECT token_hash, consumed_operation_id
        FROM center_agent_project_remove_confirmations
        WHERE project_id = ?
      `
    )
      .bind(created.project.id)
      .first<{ consumed_operation_id: string; token_hash: string }>();
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
    OPENMELD_DB: env.OPENMELD_DB,
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

  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, 'Center Agent Owner', ?, 1, ?, ?)
      `
    ).bind(ownerUserId, `${ownerUserId}@example.test`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, 'Project Speaker', ?, 1, ?, ?)
      `
    ).bind(speakerUserId, `${speakerUserId}@example.test`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES (?, 'Center Agent Project Organization', ?, ?)
      `
    ).bind(organizationId, `center-agent-project-${suffix}`, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `
    ).bind(ownerMemberId, organizationId, ownerUserId, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, 'member', ?)
      `
    ).bind(speakerMemberId, organizationId, speakerUserId, nowMs),
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
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
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
        ) VALUES (?, 'Project Center Agent', ?, 'agent', 0, 'active', ?, NULL, ?, 'auth_bootstrap', 'center_agent', ?, ?)
      `
    ).bind(
      centerAgentProfileId,
      `project-center-agent-${suffix}`,
      organizationId,
      ownerUserId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES (?, ?, NULL, ?, ?)
      `
    ).bind(organizationId, centerAgentProfileId, ownerUserId, nowMs),
  ]);

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
}): D1PreparedStatement {
  return env.OPENMELD_DB.prepare(
    `
      INSERT INTO openmeld_profiles (
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
      ) VALUES (?, ?, ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
    `
  ).bind(
    input.profileId,
    input.profileName,
    input.handle,
    input.userId,
    input.userId,
    input.nowMs,
    input.nowMs
  );
}
