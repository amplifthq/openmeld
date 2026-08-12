import { env } from "cloudflare:test";
import { buildRepositoryFingerprint } from "@openmeld/projects";
import type { AgentActivityEvent } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptAgentActivityEventRecord } from "../src/agent-activity/activity-event-repository";
import type { CoreBindings } from "../src/lib/bindings";
import { createProjectService } from "../src/projects/project-service";
import {
  rpcCreateProject,
  rpcListProjects,
  rpcUpdateAgentProfileDefaultProject,
} from "../src/rpc/methods";

const ownedOrganizationIds = new Set<string>();
const ownedUserIds = new Set<string>();
const ownedExecutionIds = new Set<string>();

afterEach(async () => {
  for (const organizationId of ownedOrganizationIds) {
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_execution_links WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_daily_session_keys WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_daily_aggregates WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_digests WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_sessions WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_events WHERE organization_id = ?"
      ).bind(organizationId),
    ]);
    await env.OPENMELD_DB.prepare(
      "DELETE FROM projects WHERE organization_id = ?"
    )
      .bind(organizationId)
      .run();
    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ?"
    )
      .bind(organizationId)
      .run();
    await env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?")
      .bind(organizationId)
      .run();
  }
  for (const executionId of ownedExecutionIds) {
    await env.OPENMELD_DB.prepare(
      "DELETE FROM openMeldDaemon_runtime_coordinator_executions WHERE runtime_coordinator_execution_id = ?"
    )
      .bind(executionId)
      .run();
  }
  for (const userId of ownedUserIds) {
    await env.OPENMELD_DB.prepare(
      "DELETE FROM openmeld_profiles WHERE owner_user_id = ?"
    )
      .bind(userId)
      .run();
    await env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?")
      .bind(userId)
      .run();
  }
  ownedOrganizationIds.clear();
  ownedUserIds.clear();
  ownedExecutionIds.clear();
});

describe("Core Projects", () => {
  it("stores one safe repository URL with its matching fingerprint", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => "project-repository",
      now: () => 100,
    });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });
    const repositoryUrl = "https://github.com/amplifthq/openmeld";
    const repositoryFingerprint =
      await buildRepositoryFingerprint(repositoryUrl);

    await expect(
      service.create(owner, {
        name: "OpenMeld",
        repositoryFingerprint: repositoryFingerprint ?? undefined,
        repositoryUrl,
      })
    ).resolves.toMatchObject({ repositoryFingerprint, repositoryUrl });
    await expect(
      service.update(owner, "project-repository", {
        repositoryFingerprint: `sha256:${"b".repeat(64)}`,
        repositoryUrl,
      })
    ).rejects.toThrow("project.repository_identity_invalid");
  });

  it("separates all-member visibility from creator and administrator mutation authority", async () => {
    const organizationId = await seedOrganization();
    let nowMs = 100;
    let idSequence = 0;
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => {
        idSequence += 1;
        return `project-${idSequence}`;
      },
      now: () => {
        nowMs += 1;
        return nowMs;
      },
    });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });
    const member = authority({
      organizationId,
      role: "member",
      userId: "member-1",
    });

    const ownerProject = await service.create(owner, {
      name: "OpenMeld",
      slug: "openmeld",
    });
    const memberProject = await service.create(member, {
      name: "Agent Router",
      slug: "agent-router",
    });

    await expect(service.list(member)).resolves.toEqual({
      organizationId,
      projects: expect.arrayContaining([
        expect.objectContaining({
          canArchive: false,
          canManage: false,
          id: ownerProject.id,
        }),
        expect.objectContaining({
          canArchive: true,
          canManage: true,
          id: memberProject.id,
        }),
      ]),
    });

    await expect(
      service.update(member, ownerProject.id, { name: "Forbidden rename" })
    ).rejects.toThrow("project.forbidden");
    await expect(
      service.update(member, memberProject.id, { name: "Agent Router Core" })
    ).resolves.toMatchObject({ name: "Agent Router Core" });
    await expect(
      service.archive(owner, memberProject.id)
    ).resolves.toMatchObject({
      archivedAtMs: expect.any(Number),
      canArchive: false,
      canManage: false,
    });
    await expect(service.list(member)).resolves.toEqual({
      organizationId,
      projects: [expect.objectContaining({ id: ownerProject.id })],
    });
  });

  it("scopes every Project read and mutation to the actor organization", async () => {
    const firstOrganizationId = await seedOrganization();
    const secondOrganizationId = await seedOrganization();
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => 200,
    });
    const firstOwner = authority({
      organizationId: firstOrganizationId,
      role: "owner",
      userId: "owner-1",
    });
    const secondOwner = authority({
      organizationId: secondOrganizationId,
      role: "owner",
      userId: "owner-2",
    });
    const project = await service.create(firstOwner, {
      name: "Private Project",
      slug: "private-project",
    });

    await expect(service.list(secondOwner)).resolves.toEqual({
      organizationId: secondOrganizationId,
      projects: [],
    });
    await expect(
      service.update(secondOwner, project.id, { name: "Cross-org rename" })
    ).rejects.toThrow("project.not_found");
  });

  it("requires a verified active human member across the public Core RPC boundary", async () => {
    const actor = await seedOrganizationActor("member");
    const context = {
      activeOrganizationId: actor.organizationId,
      actorContext: {
        callerPrincipalId: actor.userId,
        profileKind: "human" as const,
        requestId: `request_${crypto.randomUUID()}`,
        openMeldProfileId: actor.profileId,
      },
    };

    await expect(
      rpcCreateProject(env as CoreBindings, {
        context,
        expectedOrganizationId: "org-stale-tab",
        name: "Wrong Organization",
        slug: "wrong-organization",
      })
    ).rejects.toThrow("project.organization_context_changed");

    const created = await rpcCreateProject(env as CoreBindings, {
      context,
      expectedOrganizationId: actor.organizationId,
      name: "OpenMeld",
      slug: "openmeld",
    });
    expect(created.project).toMatchObject({
      canArchive: true,
      canManage: true,
      organizationId: actor.organizationId,
    });
    await expect(
      rpcListProjects(env as CoreBindings, { context })
    ).resolves.toMatchObject({
      organizationId: actor.organizationId,
      projects: [{ id: created.project.id }],
    });

    await env.OPENMELD_DB.prepare("DELETE FROM members WHERE id = ?")
      .bind(actor.memberId)
      .run();
    await expect(
      rpcListProjects(env as CoreBindings, { context })
    ).rejects.toThrow("organization.membership_required");
  });

  it("validates the canonical Project before changing or clearing Default Project", async () => {
    const actor = await seedOrganizationActor("member");
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES (?, 'Project Agent', ?, 'agent', 0, 'active', ?, ?, ?, 'cli_create', 1, 1)
      `
    )
      .bind(
        agentProfileId,
        `project-agent-${crypto.randomUUID()}`,
        actor.organizationId,
        actor.userId,
        actor.userId
      )
      .run();
    const project = await createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => 100,
    }).create(
      authority({
        organizationId: actor.organizationId,
        role: "member",
        userId: actor.userId,
      }),
      { name: "OpenMeld" }
    );
    const updateDefaultProject = vi.fn(
      async (input: { defaultProjectId: string | null }) => ({
        ok: true as const,
        profile: {
          openMeldProfileId: agentProfileId,
          profileName: "Project Agent",
          profileHandle: "project-agent",
          profileKind: "agent" as const,
          isDefault: false,
          status: "active" as const,
          ownerUserId: actor.userId,
          source: "cli_create",
          managedRole: null,
          defaultProjectId: input.defaultProjectId,
          createdByUserId: actor.userId,
          creatorProfileId: actor.profileId,
          lastUsedAt: null,
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z",
        },
      })
    );
    const coreEnv = {
      ...env,
      OPENMELD_AUTH_WORKER: {
        updateAgentProfileDefaultProjectInOrganization: updateDefaultProject,
      },
    } as unknown as CoreBindings;
    const context = {
      activeOrganizationId: actor.organizationId,
      actorContext: {
        callerPrincipalId: actor.userId,
        ownerUserId: actor.userId,
        profileKind: "human" as const,
        requestId: `request_${crypto.randomUUID()}`,
        openMeldProfileId: actor.profileId,
      },
    };

    await expect(
      rpcUpdateAgentProfileDefaultProject(coreEnv, {
        agentProfileId,
        context,
        defaultProjectId: project.id,
        expectedOrganizationId: actor.organizationId,
      })
    ).resolves.toMatchObject({
      profile: { defaultProjectId: project.id },
    });
    await expect(
      rpcUpdateAgentProfileDefaultProject(coreEnv, {
        agentProfileId,
        context,
        defaultProjectId: null,
        expectedOrganizationId: actor.organizationId,
      })
    ).resolves.toMatchObject({ profile: { defaultProjectId: null } });
    await expect(
      rpcUpdateAgentProfileDefaultProject(coreEnv, {
        agentProfileId,
        context,
        defaultProjectId: "project-from-another-workspace",
        expectedOrganizationId: actor.organizationId,
      })
    ).rejects.toThrow("project.not_found");
    expect(updateDefaultProject).toHaveBeenCalledTimes(2);
  });

  it("atomically caps active Projects before the list contract can overflow", async () => {
    const actor = await seedOrganizationActor("owner");
    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 500
        )
        INSERT INTO projects (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        )
        SELECT
          'project_limit_' || value,
          ?,
          'Project ' || value,
          'project-' || value,
          NULL,
          ?,
          value,
          value,
          NULL
        FROM sequence
      `
    )
      .bind(actor.organizationId, actor.userId)
      .run();
    const context = {
      activeOrganizationId: actor.organizationId,
      actorContext: {
        callerPrincipalId: actor.userId,
        profileKind: "human" as const,
        requestId: `request_${crypto.randomUUID()}`,
        openMeldProfileId: actor.profileId,
      },
    };

    await expect(
      rpcListProjects(env as CoreBindings, { context })
    ).resolves.toMatchObject({ projects: expect.any(Array) });
    await expect(
      rpcCreateProject(env as CoreBindings, {
        context,
        expectedOrganizationId: actor.organizationId,
        name: "Overflow Project",
        slug: "overflow-project",
      })
    ).rejects.toThrow("project.limit_reached");
  });

  it.each([
    ["owner", "owner", "owner-actor", true],
    ["admin", "admin", "admin-actor", false],
    ["member creator", "member", "member-actor", true],
    ["member other", "member", "other-member", false],
  ] as const)("enforces owner-only plus zero-Activity creator grace for %s", async (_label, actorRole, actorUserId, expectedArchive) => {
    const organizationId = await seedOrganization();
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => Date.now(),
    });
    const creatorUserId = actorRole === "admin" ? actorUserId : "member-actor";
    const project = await service.create(
      authority({
        organizationId,
        role: actorRole === "owner" ? "member" : actorRole,
        userId: creatorUserId,
      }),
      { name: "Archive Matrix", slug: `matrix-${crypto.randomUUID()}` }
    );
    const actor = authority({
      organizationId,
      role: actorRole,
      userId: actorUserId,
    });

    await expect(service.list(actor)).resolves.toMatchObject({
      projects: [{ canArchive: expectedArchive, id: project.id }],
    });
    if (expectedArchive) {
      await expect(service.archive(actor, project.id)).resolves.toMatchObject({
        archivedAtMs: expect.any(Number),
      });
    } else {
      await expect(service.archive(actor, project.id)).rejects.toThrow(
        "project.forbidden"
      );
    }
  });

  it("allocates automatic slug conflicts through -99 and then stops", async () => {
    const organizationId = await seedOrganization();
    let idSequence = 0;
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => {
        idSequence += 1;
        return `slug-project-${idSequence}`;
      },
      now: () => 100,
    });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });
    await service.create(owner, { name: "OpenMeld", slug: "openmeld" });
    await expect(
      service.create(owner, { name: "OpenMeld" })
    ).resolves.toMatchObject({ slug: "openmeld-2" });

    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 3
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 99
        )
        INSERT INTO projects (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        )
        SELECT
          'slug_limit_' || value,
          ?,
          'OpenMeld ' || value,
          'openmeld-' || value,
          NULL,
          ?,
          value,
          value,
          NULL
        FROM sequence
      `
    )
      .bind(organizationId, owner.userId)
      .run();
    await expect(service.create(owner, { name: "OpenMeld" })).rejects.toThrow(
      "through the -99 suffix"
    );
  });

  it.each([
    "daily_aggregate",
    "daily_session_key",
  ] as const)("blocks creator grace when only %s evidence remains", async (evidenceKind) => {
    const organizationId = await seedOrganization();
    const member = authority({
      organizationId,
      role: "member",
      userId: "member-1",
    });
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => 100,
    });
    const project = await service.create(member, {
      name: "Evidence Project",
    });
    await seedStandaloneEvidence({
      evidenceKind,
      organizationId,
      projectId: project.id,
    });

    await expect(service.list(member)).resolves.toMatchObject({
      projects: [{ canArchive: false, id: project.id }],
    });
    await expect(service.archive(member, project.id)).rejects.toThrow(
      "This Project already has Activity. Only the organization owner can remove it."
    );
  });

  it("blocks creator grace for an execution-link association", async () => {
    const organizationId = await seedOrganization();
    const member = authority({
      organizationId,
      role: "member",
      userId: "member-1",
    });
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => 100,
    });
    const project = await service.create(member, { name: "Linked Project" });
    await expect(
      acceptEventRecord({ organizationId, projectId: project.id })
    ).resolves.toBe("accepted");
    await seedExecutionLink({ organizationId, projectId: project.id });

    await expect(service.archive(member, project.id)).rejects.toThrow(
      "This Project already has Activity. Only the organization owner can remove it."
    );
  });

  it("orders archive and Activity ingestion deterministically in both directions", async () => {
    const organizationId = await seedOrganization();
    let nowMs = 100;
    const service = createProjectService({
      db: env.OPENMELD_DB,
      generateId: () => `project-${crypto.randomUUID()}`,
      now: () => {
        nowMs += 1;
        return nowMs;
      },
    });
    const member = authority({
      organizationId,
      role: "member",
      userId: "member-1",
    });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });

    const archiveFirst = await service.create(member, {
      name: "Archive First",
    });
    await service.archive(member, archiveFirst.id);
    await expect(
      acceptEventRecord({ organizationId, projectId: archiveFirst.id })
    ).resolves.toBe("project_archived");

    const eventFirst = await service.create(member, { name: "Event First" });
    await expect(
      acceptEventRecord({ organizationId, projectId: eventFirst.id })
    ).resolves.toBe("accepted");
    await expect(service.archive(member, eventFirst.id)).rejects.toThrow(
      "This Project already has Activity. Only the organization owner can remove it."
    );
    await expect(service.archive(owner, eventFirst.id)).resolves.toMatchObject({
      archivedAtMs: expect.any(Number),
    });
    await expect(
      acceptEventRecord({
        eventId: `event-after-owner-${crypto.randomUUID()}`,
        organizationId,
        projectId: eventFirst.id,
      })
    ).resolves.toBe("project_archived");

    const counts = await env.OPENMELD_DB.prepare(
      `
        SELECT
          (SELECT count(*) FROM agent_activity_events
            WHERE organization_id = ? AND project_id = ?) AS events,
          (SELECT count(*) FROM agent_activity_sessions
            WHERE organization_id = ? AND project_id = ?) AS sessions
      `
    )
      .bind(organizationId, archiveFirst.id, organizationId, archiveFirst.id)
      .first<{ events: number; sessions: number }>();
    expect(counts).toEqual({ events: 0, sessions: 0 });
  });
});

function authority(input: {
  organizationId: string;
  role: "admin" | "member" | "owner";
  userId: string;
}) {
  return input;
}

async function seedOrganization(): Promise<string> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_agent_activity_${suffix}`;
  ownedOrganizationIds.add(organizationId);
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      organizationId,
      "Agent Activity Test Organization",
      `agent-activity-${suffix}`,
      1
    )
    .run();
  return organizationId;
}

async function seedOrganizationActor(role: "admin" | "member" | "owner") {
  const organizationId = await seedOrganization();
  const suffix = crypto.randomUUID();
  const userId = `user_agent_activity_${suffix}`;
  const profileId = crypto.randomUUID();
  const memberId = `member_agent_activity_${suffix}`;
  ownedUserIds.add(userId);
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, 'Agent Activity User', ?, 1, 1, 1)
      `
    ).bind(userId, `${userId}@example.com`),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES (?, 'Agent Activity User', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', 1, 1)
      `
    ).bind(profileId, `agent-activity-${suffix}`, userId, userId),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?, 1)
      `
    ).bind(memberId, organizationId, userId, role),
  ]);
  return { memberId, organizationId, profileId, userId };
}

async function seedStandaloneEvidence(input: {
  evidenceKind: "daily_aggregate" | "daily_session_key";
  organizationId: string;
  projectId: string;
}): Promise<void> {
  if (input.evidenceKind === "daily_aggregate") {
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO agent_activity_daily_aggregates (
          id, organization_id, project_id, member_user_id, utc_date,
          session_count, event_count, first_observed_at_ms,
          last_observed_at_ms, provider_counts_json, updated_at_ms
        ) VALUES (?, ?, ?, 'member-1', '2026-07-14', 0, 0, 100, 100, '{}', 100)
      `
    )
      .bind(
        `daily-${crypto.randomUUID()}`,
        input.organizationId,
        input.projectId
      )
      .run();
    return;
  }
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO agent_activity_daily_session_keys (
        daily_session_key, organization_id, project_id, member_user_id,
        utc_date, first_event_storage_id, created_at_ms, expires_at_ms
      ) VALUES (?, ?, ?, 'member-1', '2026-07-14', 'event-storage-1', 100, 200)
    `
  )
    .bind(`sha256:${"a".repeat(64)}`, input.organizationId, input.projectId)
    .run();
}

async function seedExecutionLink(input: {
  organizationId: string;
  projectId: string;
}): Promise<void> {
  const session = await env.OPENMELD_DB.prepare(
    `
      SELECT id
      FROM agent_activity_sessions
      WHERE organization_id = ? AND project_id = ?
      LIMIT 1
    `
  )
    .bind(input.organizationId, input.projectId)
    .first<{ id: string }>();
  if (!session) {
    throw new Error("Expected an Activity session before linking execution.");
  }
  const executionId = `execution-${crypto.randomUUID()}`;
  ownedExecutionIds.add(executionId);
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_runtime_coordinator_executions (
          runtime_coordinator_execution_id, model_version, space_id,
          dispatch_id, target_profile_id, openMeld_service_runtime_id_source,
          openmeld_service_runtime_id, binding_id, agent_controller_ref,
          status, created_at_ms, updated_at_ms
        ) VALUES (?, 'v1', ?, ?, 'profile-1', 'runtime_registry_authority',
          'runtime-1', 'binding-1', 'builtin:codex', 'accepted', 100, 100)
      `
    ).bind(
      executionId,
      `space-${crypto.randomUUID()}`,
      `dispatch-${crypto.randomUUID()}`
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO agent_activity_execution_links (
          id, organization_id, activity_session_id,
          runtime_coordinator_execution_id, device_id,
          openmeld_service_runtime_id, binding_id, agent_controller_ref,
          provider_conversation_id, created_at_ms
        ) VALUES (?, ?, ?, ?, 'device-1', 'runtime-1', 'binding-1',
          'builtin:codex', 'conversation-1', 100)
      `
    ).bind(
      `link-${crypto.randomUUID()}`,
      input.organizationId,
      session.id,
      executionId
    ),
  ]);
}

async function acceptEventRecord(input: {
  eventId?: string;
  organizationId: string;
  projectId: string;
}) {
  const observedAtMs = 1000;
  const event: AgentActivityEvent = {
    clientKind: "codex-app",
    eventId: input.eventId ?? `event-${crypto.randomUUID()}`,
    eventType: "session_active",
    expiresAtMs: observedAtMs + 60_000,
    gitBranch: "main",
    gitCommit: "f5ed74125265b042763b5b484e46bc033b759d98",
    model: "gpt-5.6-sol",
    observedAtMs,
    organizationId: input.organizationId,
    projectId: input.projectId,
    provider: "codex",
    providerMetadata: {
      approvalPolicy: "never",
      cliVersion: "0.144.1",
      originator: "desktop",
      reasoningEffort: "xhigh",
      sandboxMode: "danger-full-access",
      source: "rollout",
    },
    providerSessionId: `session-${crypto.randomUUID()}`,
    repositoryFingerprint: null,
    source: "observed",
    startedAtMs: observedAtMs - 500,
    status: "active",
    title: "Project archive ordering",
  };
  return await acceptAgentActivityEventRecord({
    db: env.OPENMELD_DB,
    deviceId: "device-1",
    event,
    memberUserId: "member-1",
    nowMs: observedAtMs,
    openMeldServiceRuntimeId: "runtime-1",
  });
}
