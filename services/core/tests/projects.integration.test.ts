import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { buildRepositoryFingerprint } from "@openmeld/projects";
import type { AgentActivityEvent, SpaceTask } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptAgentActivityEventRecord } from "../src/agent-activity/activity-event-repository";
import type { CoreBindings } from "../src/lib/bindings";
import {
  archiveProjectRecord,
  listActivitySnapshotProjectRecords,
  readActiveProjectIds,
  readProjectLifecycleRecord,
  readProjectRecord,
} from "../src/projects/project-repository";
import { rpcReadProjectRecentTasks } from "../src/projects/project-rpc";
import { createProjectService } from "../src/projects/project-service";
import {
  rpcCreateProject,
  rpcListProjects,
  rpcUpdateAgentProfileDefaultProject,
} from "../src/rpc/methods";
import { projectSpaceTaskProjectLinks } from "../src/space/infrastructure/postgresql/space-task-project-link-repo";
import { env } from "../test-support/worker-env";

const ownedOrganizationIds = new Set<string>();
const ownedUserIds = new Set<string>();
const ownedExecutionIds = new Set<string>();
afterEach(async () => {
  for (const organizationId of ownedOrganizationIds) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_execution_links" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_daily_session_keys" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_daily_aggregates" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_digests" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_sessions" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."agent_activity_events" WHERE organization_id = $1',
              values: [],
            },
            values: [organizationId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."projects" WHERE organization_id = $1',
        values: [],
      },
      values: [organizationId],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
        values: [],
      },
      values: [organizationId],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."organizations" WHERE id = $1',
        values: [],
      },
      values: [organizationId],
    });
  }
  for (const executionId of ownedExecutionIds) {
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."openMeldDaemon_runtime_coordinator_executions" WHERE runtime_coordinator_execution_id = $1',
        values: [],
      },
      values: [executionId],
    });
  }
  for (const userId of ownedUserIds) {
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1',
        values: [],
      },
      values: [userId],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."users" WHERE id = $1',
        values: [],
      },
      values: [userId],
    });
  }
  ownedOrganizationIds.clear();
  ownedUserIds.clear();
  ownedExecutionIds.clear();
});
describe("Core Projects", () => {
  it("shows only current Tasks in Spaces the human can access, and ignores stale projection replay", async () => {
    const actor = await seedOrganizationActor("member");
    const project = await createProjectService({
      db: getPostgresDatabase(env),
    }).create(
      authority({
        organizationId: actor.organizationId,
        role: "member",
        userId: actor.userId,
      }),
      { name: "Payments" }
    );
    const context = {
      activeOrganizationId: actor.organizationId,
      actorContext: {
        callerPrincipalId: actor.userId,
        profileKind: "human" as const,
        requestId: `request_${crypto.randomUUID()}`,
        openMeldProfileId: actor.profileId,
      },
    };
    const actorSnapshot: SpaceTask["createdBy"] = {
      ownerUserId: actor.userId,
      profileId: actor.profileId,
      profileKind: "human",
      profileName: "Member",
    };
    const task = (spaceId: string, title: string, day: number): SpaceTask => ({
      assignee: null,
      automaticReworkRounds: 0,
      completionConditions: [],
      createdAt: `2026-09-${day}T00:00:00.000Z`,
      createdBy: actorSnapshot,
      description: null,
      externalWorkItems: [],
      needsHumanDecision: false,
      phase: "to_do",
      projectIds: [project.id],
      requestedBy: actorSnapshot,
      result: null,
      review: null,
      reviewer: null,
      revision: 1,
      sourceSignalId: null,
      spaceId,
      taskId: `tsk_${crypto.randomUUID()}`,
      threadId: null,
      title,
      updatedAt: `2026-09-${day}T00:00:00.000Z`,
    });
    const privateTask = task("a".repeat(64), "Private Task", 29);
    const staleTask = task("b".repeat(64), "Stale Task", 28);
    const visibleTask = task("c".repeat(64), "Visible Task", 27);
    for (const current of [privateTask, staleTask, visibleTask]) {
      await projectSpaceTaskProjectLinks({
        db: getPostgresDatabase(env),
        organizationId: actor.organizationId,
        task: current,
      });
    }
    const taskBySpace = new Map<string, SpaceTask>([
      [privateTask.spaceId, privateTask],
      [staleTask.spaceId, { ...staleTask, projectIds: [] }],
      [visibleTask.spaceId, visibleTask],
    ]);
    const spaces = {
      idFromString: (spaceId: string) => spaceId,
      get: (spaceId: string) => ({
        rpcGetTask: () => {
          if (spaceId === privateTask.spaceId) {
            return Promise.reject(
              new Error("HTTP 401: Space password required")
            );
          }
          return Promise.resolve({
            task: taskBySpace.get(spaceId),
            events: [],
          });
        },
      }),
    } as unknown as CoreBindings["OPENMELD_SPACES"];
    const coreEnv = { ...env, OPENMELD_SPACES: spaces } as CoreBindings;
    await expect(
      rpcReadProjectRecentTasks(coreEnv, { context, projectId: project.id })
    ).resolves.toEqual({
      tasks: [expect.objectContaining({ title: "Visible Task" })],
    });

    const removed = { ...visibleTask, projectIds: [], revision: 2 };
    taskBySpace.set(visibleTask.spaceId, removed);
    await projectSpaceTaskProjectLinks({
      db: getPostgresDatabase(env),
      organizationId: actor.organizationId,
      task: removed,
    });
    await projectSpaceTaskProjectLinks({
      db: getPostgresDatabase(env),
      organizationId: actor.organizationId,
      task: visibleTask,
    });
    await expect(
      rpcReadProjectRecentTasks(coreEnv, { context, projectId: project.id })
    ).resolves.toEqual({ tasks: [] });
  });
  it("configures shared repository associations and a versioned code default", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({ db: getPostgresDatabase(env) });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });
    const project = await service.create(owner, {
      name: "Payments",
      repositoryUrl: "https://github.com/acme/payments",
    });
    const initial = await service.readRepositorySettings(owner, project.id);
    expect(initial.repositories).toMatchObject([
      { repositoryUrl: "https://github.com/acme/payments", isDefault: true },
    ]);
    const updated = await service.updateRepositorySettings(owner, project.id, {
      defaultRepositoryUrl: "https://github.com/acme/sdk",
      expectedRevision: initial.revision,
      repositoryUrls: [
        "https://github.com/acme/payments",
        "https://github.com/acme/sdk",
      ],
    });
    expect(updated.repositories).toMatchObject([
      { repositoryUrl: "https://github.com/acme/sdk", isDefault: true },
      { repositoryUrl: "https://github.com/acme/payments", isDefault: false },
    ]);
    expect((await service.read(owner, project.id)).repositoryUrl).toBe(
      "https://github.com/acme/sdk"
    );
    await expect(
      service.updateRepositorySettings(owner, project.id, {
        defaultRepositoryUrl: null,
        expectedRevision: initial.revision,
        repositoryUrls: [],
      })
    ).rejects.toThrow("project.conflict");
  });

  it("keeps Common Agents independent of work history and Project edit authority", async () => {
    const actor = await seedOrganizationActor("member");
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, organization_id, owner_user_id, created_by_user_id, source,
        created_at, updated_at
      ) VALUES ($1, 'Project Agent', $2, 'agent', 0, 'active', $3, $4, $5, 'cli_create', 1, 1)`,
      values: [
        agentProfileId,
        `project-agent-${crypto.randomUUID()}`,
        actor.organizationId,
        actor.userId,
        actor.userId,
      ],
    });
    const service = createProjectService({ db: getPostgresDatabase(env) });
    const manager = authority({
      organizationId: actor.organizationId,
      role: "member",
      userId: actor.userId,
    });
    const project = await service.create(manager, { name: "Payments" });
    const configured = await service.updateCommonAgents(manager, project.id, {
      agentProfileIds: [agentProfileId],
      expectedRevision: 0,
    });
    expect(configured.agentProfileIds).toEqual([agentProfileId]);
    await expect(
      service.updateCommonAgents(
        { ...manager, userId: "other-member" },
        project.id,
        { agentProfileIds: [], expectedRevision: configured.revision }
      )
    ).rejects.toThrow("project.forbidden");
  });

  it("limits Task Project choices to active Projects in the owning Organization", async () => {
    const organizationId = await seedOrganization();
    const otherOrganizationId = await seedOrganization();
    const service = createProjectService({ db: getPostgresDatabase(env) });
    const ownProject = await service.create(
      authority({ organizationId, role: "owner", userId: "owner-1" }),
      { name: "Own work" }
    );
    const otherProject = await service.create(
      authority({
        organizationId: otherOrganizationId,
        role: "owner",
        userId: "owner-1",
      }),
      { name: "Other work" }
    );
    expect(
      await readActiveProjectIds({
        db: getPostgresDatabase(env),
        organizationId,
        projectIds: [ownProject.id, otherProject.id],
      })
    ).toEqual([ownProject.id]);
  });

  it("replays concurrent creation retries and rejects changed input after later edits", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({ db: getPostgresDatabase(env) });
    const owner = authority({
      organizationId,
      role: "owner",
      userId: "owner-1",
    });
    const request = { name: "Launch", operationId: "create-launch" };
    const [first, retry] = await Promise.all([
      service.create(owner, request),
      service.create(owner, request),
    ]);
    expect(first.id).toBe(retry.id);
    expect((await service.list(owner)).projects).toHaveLength(1);
    await service.update(owner, first.id, { name: "Launch planning" });
    expect((await service.create(owner, request)).id).toBe(first.id);
    await expect(
      service.create(owner, { ...request, name: "Different project" })
    ).rejects.toThrow("project.operation_conflict");
  });

  it("allows one repository to belong to Projects created by different members", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({ db: getPostgresDatabase(env) });
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
    const repositoryUrl = "https://github.com/acme/product";
    const results = await Promise.allSettled([
      service.create(owner, {
        name: "Product",
        repositoryUrl,
        operationId: "owner-create",
      }),
      service.create(member, {
        name: "Product team",
        repositoryUrl,
        operationId: "member-create",
      }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect((await service.list(owner)).projects).toHaveLength(2);
  });
  it("stores one safe repository URL with its matching fingerprint", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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

  it("keeps issue routing under Project management and rejects stale competing changes", async () => {
    const organizationId = await seedOrganization();
    const service = createProjectService({ db: getPostgresDatabase(env) });
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
    const project = await service.create(owner, { name: "Payments" });
    await expect(service.readIssueRouting(member, project.id)).resolves.toEqual(
      {
        destination: null,
        projectId: project.id,
        revision: 0,
        updatedAtMs: null,
        updatedByUserId: null,
      }
    );
    await expect(
      service.updateIssueRouting(member, project.id, {
        destination: { provider: "github", owner: "acme", repo: "payments" },
        expectedRevision: 0,
      })
    ).rejects.toThrow("project.forbidden");

    const saved = await service.updateIssueRouting(owner, project.id, {
      destination: { provider: "github", owner: "acme", repo: "payments" },
      expectedRevision: 0,
    });
    expect(saved).toMatchObject({
      destination: { provider: "github", owner: "acme", repo: "payments" },
      revision: 1,
      updatedByUserId: owner.userId,
      updatedAtMs: expect.any(Number),
    });
    const competing = await Promise.allSettled([
      service.updateIssueRouting(owner, project.id, {
        destination: {
          provider: "linear",
          teamId: "11111111-1111-4111-8111-111111111111",
        },
        expectedRevision: 1,
      }),
      service.updateIssueRouting(owner, project.id, {
        destination: null,
        expectedRevision: 1,
      }),
    ]);
    expect(
      competing.filter((item) => item.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      competing.filter((item) => item.status === "rejected")
    ).toMatchObject([
      {
        reason: expect.objectContaining({
          message: expect.stringContaining("project.conflict"),
        }),
      },
    ]);
    expect((await service.readIssueRouting(owner, project.id)).revision).toBe(
      2
    );
    expect((await service.list(owner)).projects[0]).not.toHaveProperty(
      "issueDestination"
    );
  });
  it("scopes every Project read and mutation to the actor organization", async () => {
    const firstOrganizationId = await seedOrganization();
    const secondOrganizationId = await seedOrganization();
    const service = createProjectService({
      db: getPostgresDatabase(env),
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [actor.memberId],
    });
    await expect(
      rpcListProjects(env as CoreBindings, { context })
    ).rejects.toThrow("organization.membership_required");
  });
  it("validates the canonical Project before changing or clearing Default Project", async () => {
    const actor = await seedOrganizationActor("member");
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES ($1, 'Project Agent', $2, 'agent', 0, 'active', $3, $4, $5, 'cli_create', 1, 1)
      `,
        values: [],
      },
      values: [
        agentProfileId,
        `project-agent-${crypto.randomUUID()}`,
        actor.organizationId,
        actor.userId,
        actor.userId,
      ],
    });
    const project = await createProjectService({
      db: getPostgresDatabase(env),
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
    const mutationOrder: string[] = [];
    const acquireFutureWorkSettingsMutation = vi.fn(
      (input: { operationId: string }) => {
        mutationOrder.push("acquire");
        return Promise.resolve({
          expiresAtMs: Date.now() + 30_000,
          operationId: input.operationId,
          status: "acquired" as const,
        });
      }
    );
    const releaseExecutionTargetMutation = vi.fn(() => {
      mutationOrder.push("release");
      return Promise.resolve({ status: "released" as const });
    });
    const updateDefaultProject = vi.fn(
      (input: { defaultProjectId: string | null }) => {
        mutationOrder.push("update");
        return Promise.resolve({
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
        });
      }
    );
    const coreEnv = {
      ...env,
      OPENMELD_AUTH_WORKER: {
        updateAgentProfileDefaultProjectInOrganization: updateDefaultProject,
      },
      OPENMELD_RUNTIME_TRANSPORT: {
        get: vi.fn(() => ({
          rpcAcquireAgentProfileFutureWorkSettingsMutation:
            acquireFutureWorkSettingsMutation,
          rpcReleaseAgentProfileControllerMutation:
            releaseExecutionTargetMutation,
        })),
        idFromName: vi.fn((value: string) => value),
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
    expect(acquireFutureWorkSettingsMutation).toHaveBeenCalledTimes(2);
    expect(releaseExecutionTargetMutation).toHaveBeenCalledTimes(2);
    expect(mutationOrder).toEqual([
      "acquire",
      "update",
      "release",
      "acquire",
      "update",
      "release",
    ]);
  });
  it("atomically caps active Projects before the list contract can overflow", async () => {
    const actor = await seedOrganizationActor("owner");
    await getPostgresDatabase(env).query({
      ...{
        text: `
        WITH RECURSIVE sequence(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 500
        )
        INSERT INTO "openmeld"."projects" (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        )
        SELECT
          'project_limit_' || value,
          $1,
          'Project ' || value,
          'project-' || value,
          NULL,
          $2,
          value,
          value,
          NULL
        FROM sequence
      `,
        values: [],
      },
      values: [actor.organizationId, actor.userId],
    });
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
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        WITH RECURSIVE sequence(value) AS (
          SELECT 3
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 99
        )
        INSERT INTO "openmeld"."projects" (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        )
        SELECT
          'slug_limit_' || value,
          $1,
          'OpenMeld ' || value,
          'openmeld-' || value,
          NULL,
          $2,
          value,
          value,
          NULL
        FROM sequence
      `,
        values: [],
      },
      values: [organizationId, owner.userId],
    });
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
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
      db: getPostgresDatabase(env),
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
    const counts = await getPostgresDatabase(env)
      .query<{
        events: number;
        sessions: number;
      }>({
        ...{
          text: `
        SELECT
          (SELECT count(*) FROM "openmeld"."agent_activity_events"
            WHERE organization_id = $1 AND project_id = $2) AS events,
          (SELECT count(*) FROM "openmeld"."agent_activity_sessions"
            WHERE organization_id = $3 AND project_id = $4) AS sessions
      `,
          values: [],
        },
        values: [
          organizationId,
          archiveFirst.id,
          organizationId,
          archiveFirst.id,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    expect(counts).toEqual({ events: 0, sessions: 0 });
  });
});
const ACTIVITY_EVIDENCE_KINDS = [
  "event",
  "session",
  "digest",
  "daily_aggregate",
  "daily_session_key",
] as const;
type ActivityEvidenceKind = (typeof ACTIVITY_EVIDENCE_KINDS)[number];
describe("Project Activity evidence reads", () => {
  it.each(
    ACTIVITY_EVIDENCE_KINDS
  )("scopes %s evidence to its own Project and Organization", async (evidenceKind) => {
    const organizationId = await seedOrganization();
    const otherOrganizationId = await seedOrganization();
    const db = getPostgresDatabase(env);
    // Ids sort so the evidence of the active Project is the next row an index
    // seek would meet when probing the quiet Project. Evidence stored under the
    // quiet Project id in another Organization must not count either.
    const quiet = `evidence-a-${crypto.randomUUID()}`;
    const active = `evidence-b-${crypto.randomUUID()}`;
    await seedProjectRow({ id: quiet, organizationId, updatedAtMs: 10 });
    await seedProjectRow({ id: active, organizationId, updatedAtMs: 20 });
    await seedActivityEvidence({
      evidenceKind,
      organizationId,
      projectId: active,
    });
    await seedActivityEvidence({
      evidenceKind,
      organizationId: otherOrganizationId,
      projectId: quiet,
    });
    await expect(
      readProjectRecord({ db, organizationId, projectId: active })
    ).resolves.toMatchObject({ hasActivity: true, id: active });
    await expect(
      readProjectRecord({ db, organizationId, projectId: quiet })
    ).resolves.toMatchObject({ hasActivity: false, id: quiet });
    await expect(
      archiveProjectRecord({
        authorityMode: "creator_grace",
        currentUpdatedAtMs: 20,
        db,
        nowMs: 30,
        organizationId,
        projectId: active,
        userId: "creator-1",
      })
    ).resolves.toBe("has_activity");
    await expect(
      archiveProjectRecord({
        authorityMode: "creator_grace",
        currentUpdatedAtMs: 10,
        db,
        nowMs: 30,
        organizationId,
        projectId: quiet,
        userId: "creator-1",
      })
    ).resolves.toBe("archived");
  });
  it.each(
    ACTIVITY_EVIDENCE_KINDS
  )("ignores %s evidence under the same Project id in the next Organization", async (evidenceKind) => {
    const base = `org_evidence_${crypto.randomUUID()}`;
    const organizationId = await seedOrganization(`${base}-a`);
    const nextOrganizationId = await seedOrganization(`${base}-b`);
    const db = getPostgresDatabase(env);
    const projectId = `evidence-${crypto.randomUUID()}`;
    await seedProjectRow({ id: projectId, organizationId, updatedAtMs: 10 });
    // The quiet Project has no later evidence in its own Organization, so the
    // seek lands on this row, which differs only by Organization.
    await seedActivityEvidence({
      evidenceKind,
      organizationId: nextOrganizationId,
      projectId,
    });
    await expect(
      readProjectRecord({ db, organizationId, projectId })
    ).resolves.toMatchObject({ hasActivity: false, id: projectId });
    await expect(
      archiveProjectRecord({
        authorityMode: "creator_grace",
        currentUpdatedAtMs: 10,
        db,
        nowMs: 30,
        organizationId,
        projectId,
        userId: "creator-1",
      })
    ).resolves.toBe("archived");
  });
  it("lists active Projects first, then archived Projects that keep evidence", async () => {
    const organizationId = await seedOrganization();
    const db = getPostgresDatabase(env);
    const prefix = crypto.randomUUID();
    const rows: {
      archived: boolean;
      at: number;
      evidence: ActivityEvidenceKind | null;
      id: string;
    }[] = [
      { archived: false, at: 10, evidence: null, id: `${prefix}-active-old` },
      {
        archived: false,
        at: 40,
        evidence: "session",
        id: `${prefix}-active-new`,
      },
      {
        archived: true,
        at: 90,
        evidence: "event",
        id: `${prefix}-archived-new`,
      },
      {
        archived: true,
        at: 5,
        evidence: "daily_session_key",
        id: `${prefix}-archived-old`,
      },
      {
        archived: true,
        at: 99,
        evidence: null,
        id: `${prefix}-archived-quiet`,
      },
    ];
    for (const row of rows) {
      await seedProjectRow({
        archivedAtMs: row.archived ? row.at : null,
        id: row.id,
        organizationId,
        updatedAtMs: row.at,
      });
      if (row.evidence) {
        await seedActivityEvidence({
          evidenceKind: row.evidence,
          organizationId,
          projectId: row.id,
        });
      }
    }
    const projects = await listActivitySnapshotProjectRecords({
      db,
      organizationId,
    });
    expect(
      projects.map(({ archivedAtMs, hasActivity, id }) => ({
        archived: archivedAtMs !== null,
        hasActivity,
        id,
      }))
    ).toEqual([
      { archived: false, hasActivity: true, id: `${prefix}-active-new` },
      { archived: false, hasActivity: false, id: `${prefix}-active-old` },
      { archived: true, hasActivity: true, id: `${prefix}-archived-new` },
      { archived: true, hasActivity: true, id: `${prefix}-archived-old` },
    ]);
  });
  it("reads lifecycle state without Activity evidence", async () => {
    const organizationId = await seedOrganization();
    const db = getPostgresDatabase(env);
    const active = `lifecycle-${crypto.randomUUID()}`;
    const archived = `lifecycle-${crypto.randomUUID()}`;
    await seedProjectRow({ id: active, organizationId, updatedAtMs: 10 });
    await seedProjectRow({
      archivedAtMs: 15,
      id: archived,
      organizationId,
      updatedAtMs: 15,
    });
    await expect(
      readProjectLifecycleRecord({ db, organizationId, projectId: active })
    ).resolves.toEqual({ archivedAtMs: null, id: active });
    await expect(
      readProjectLifecycleRecord({ db, organizationId, projectId: archived })
    ).resolves.toEqual({ archivedAtMs: 15, id: archived });
    await expect(
      readProjectLifecycleRecord({
        db,
        organizationId: await seedOrganization(),
        projectId: active,
      })
    ).resolves.toBeNull();
  });
});
async function seedProjectRow(input: {
  archivedAtMs?: number | null;
  id: string;
  organizationId: string;
  updatedAtMs: number;
}): Promise<void> {
  await getPostgresDatabase(env).query({
    text: `
      INSERT INTO "openmeld"."projects" (
        id, organization_id, name, slug, repository_fingerprint,
        created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
      ) VALUES ($1, $2, $3, $4, NULL, 'creator-1', 1, $5, $6)
    `,
    values: [
      input.id,
      input.organizationId,
      `Project ${input.id}`,
      `slug-${crypto.randomUUID()}`,
      input.updatedAtMs,
      input.archivedAtMs ?? null,
    ],
  });
}
async function seedActivityEvidence(input: {
  evidenceKind: ActivityEvidenceKind;
  organizationId: string;
  projectId: string;
}): Promise<void> {
  const db = getPostgresDatabase(env);
  const suffix = crypto.randomUUID();
  const hash = `sha256:${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
  const scope = [input.organizationId, input.projectId];
  switch (input.evidenceKind) {
    case "event":
      await db.query({
        text: `
          INSERT INTO "openmeld"."agent_activity_events" (
            id, event_id, canonical_payload_hash, organization_id, project_id,
            member_user_id, device_id, openmeld_service_runtime_id, provider,
            client_kind, provider_session_id, event_type, status,
            observed_at_ms, expires_at_ms, provider_metadata_json,
            accepted_at_ms, daily_session_key
          ) VALUES ($1, $2, $3, $4, $5, 'member-1', 'device-1', 'runtime-1',
            'codex', 'codex-cli', 'provider-session-1', 'session_active',
            'active', 100, 200, '{}', 100, $6)
        `,
        values: [
          `event-storage-${suffix}`,
          `event-${suffix}`,
          hash,
          ...scope,
          hash,
        ],
      });
      return;
    case "session":
      await db.query({
        text: `
          INSERT INTO "openmeld"."agent_activity_sessions" (
            id, organization_id, project_id, member_user_id, device_id,
            openmeld_service_runtime_id, provider, client_kind,
            provider_session_id, status, last_observed_at_ms, expires_at_ms,
            provider_metadata_json, last_event_id, last_accepted_sequence,
            created_at_ms, updated_at_ms
          ) VALUES ($1, $2, $3, 'member-1', 'device-1', 'runtime-1', 'codex',
            'codex-cli', $4, 'active', 100, 200, '{}', 'event-1', 1, 100, 100)
        `,
        values: [`session-${suffix}`, ...scope, `provider-session-${suffix}`],
      });
      return;
    case "digest":
      await db.query({
        text: `
          INSERT INTO "openmeld"."agent_activity_digests" (
            id, organization_id, project_id, source_cursor_accepted_sequence,
            window_started_at_ms, window_ended_at_ms, event_count,
            citations_json, summary, status, failure_reason, created_at_ms,
            expires_at_ms
          ) VALUES ($1, $2, $3, 1, 100, 200, 1, '[]', NULL, 'pending', NULL,
            100, 200)
        `,
        values: [`digest-${suffix}`, ...scope],
      });
      return;
    default:
      await seedStandaloneEvidence({
        evidenceKind: input.evidenceKind,
        organizationId: input.organizationId,
        projectId: input.projectId,
        dailySessionKey: hash,
      });
  }
}
function authority(input: {
  organizationId: string;
  role: "admin" | "member" | "owner";
  userId: string;
}) {
  return input;
}
async function seedOrganization(
  organizationId = `org_agent_activity_${crypto.randomUUID()}`
): Promise<string> {
  const suffix = crypto.randomUUID();
  ownedOrganizationIds.add(organizationId);
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      values: [],
    },
    values: [
      organizationId,
      "Agent Activity Test Organization",
      `agent-activity-${suffix}`,
      1,
    ],
  });
  return organizationId;
}
async function seedOrganizationActor(role: "admin" | "member" | "owner") {
  const organizationId = await seedOrganization();
  const suffix = crypto.randomUUID();
  const userId = `user_agent_activity_${suffix}`;
  const profileId = crypto.randomUUID();
  const memberId = `member_agent_activity_${suffix}`;
  ownedUserIds.add(userId);
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, 'Agent Activity User', $2, 1, 1, 1)
      `,
            values: [],
          },
          values: [userId, `${userId}@example.com`],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES ($1, 'Agent Activity User', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', 1, 1)
      `,
            values: [],
          },
          values: [profileId, `agent-activity-${suffix}`, userId, userId],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, $4, 1)
      `,
            values: [],
          },
          values: [memberId, organizationId, userId, role],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return { memberId, organizationId, profileId, userId };
}
async function seedStandaloneEvidence(input: {
  dailySessionKey?: string;
  evidenceKind: "daily_aggregate" | "daily_session_key";
  organizationId: string;
  projectId: string;
}): Promise<void> {
  if (input.evidenceKind === "daily_aggregate") {
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."agent_activity_daily_aggregates" (
          id, organization_id, project_id, member_user_id, utc_date,
          session_count, event_count, first_observed_at_ms,
          last_observed_at_ms, provider_counts_json, updated_at_ms
        ) VALUES ($1, $2, $3, 'member-1', '2026-07-14', 0, 0, 100, 100, '{}', 100)
      `,
        values: [],
      },
      values: [
        `daily-${crypto.randomUUID()}`,
        input.organizationId,
        input.projectId,
      ],
    });
    return;
  }
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."agent_activity_daily_session_keys" (
        daily_session_key, organization_id, project_id, member_user_id,
        utc_date, first_event_storage_id, created_at_ms, expires_at_ms
      ) VALUES ($1, $2, $3, 'member-1', '2026-07-14', 'event-storage-1', 100, 200)
    `,
      values: [],
    },
    values: [
      input.dailySessionKey ?? `sha256:${"a".repeat(64)}`,
      input.organizationId,
      input.projectId,
    ],
  });
}
async function seedExecutionLink(input: {
  organizationId: string;
  projectId: string;
}): Promise<void> {
  const session = await getPostgresDatabase(env)
    .query<{
      id: string;
    }>({
      ...{
        text: `
      SELECT id
      FROM "openmeld"."agent_activity_sessions"
      WHERE organization_id = $1 AND project_id = $2
      LIMIT 1
    `,
        values: [],
      },
      values: [input.organizationId, input.projectId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!session) {
    throw new Error("Expected an Activity session before linking execution.");
  }
  const executionId = `execution-${crypto.randomUUID()}`;
  ownedExecutionIds.add(executionId);
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openMeldDaemon_runtime_coordinator_executions" (
          runtime_coordinator_execution_id, model_version, space_id,
          dispatch_id, target_profile_id, openMeld_service_runtime_id_source,
          openmeld_service_runtime_id, binding_id, agent_controller_ref,
          status, created_at_ms, updated_at_ms
        ) VALUES ($1, 'v1', $2, $3, 'profile-1', 'runtime_registry_authority',
          'runtime-1', 'binding-1', 'builtin:codex', 'accepted', 100, 100)
      `,
            values: [],
          },
          values: [
            executionId,
            `space-${crypto.randomUUID()}`,
            `dispatch-${crypto.randomUUID()}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."agent_activity_execution_links" (
          id, organization_id, activity_session_id,
          runtime_coordinator_execution_id, device_id,
          openmeld_service_runtime_id, binding_id, agent_controller_ref,
          provider_conversation_id, created_at_ms
        ) VALUES ($1, $2, $3, $4, 'device-1', 'runtime-1', 'binding-1',
          'builtin:codex', 'conversation-1', 100)
      `,
            values: [],
          },
          values: [
            `link-${crypto.randomUUID()}`,
            input.organizationId,
            session.id,
            executionId,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
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
    db: getPostgresDatabase(env),
    deviceId: "device-1",
    event,
    memberUserId: "member-1",
    nowMs: observedAtMs,
    openMeldServiceRuntimeId: "runtime-1",
  });
}
