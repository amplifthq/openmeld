import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensurePrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecord,
  reconnectPrimaryAgentProfileBindingRecord,
} from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentCheckAgentProfileReadiness,
  rpcCenterAgentListLocalAgentConnectionCandidates,
  rpcCenterAgentReadPeopleComputers,
  rpcCenterAgentRequestOpenMeldToolsUpdate,
  rpcCenterAgentUpdateAgentProfileRuntimeSettings,
  rpcCenterAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace,
  rpcGetCurrentAgentProfileWorkspace,
  rpcSetBoundPeopleComputerAgentProfileWorkspace,
  rpcUpdateBoundAgentProfileDefaultProject,
} from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

describe("Center Agent PeopleComputers authorization", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each([
    "owner",
    "owner_bound_lookup",
    "foreign_owner",
    "other_organization",
    "binding_changed_before_read",
    "binding_changed_during_read",
  ] as const)("admits a saved working-folder read against the canonical Profile owner and Binding (%s)", async (state) => {
    const f = await seedFixture();
    const db = getPostgresDatabase(env);
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    const organizationId = f.context.activeOrganizationId;
    if (!organizationId) {
      throw new Error("Missing Organization fixture");
    }
    const now = Date.now();
    await db.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Reader Agent', $1, 'agent', 0, 'active', $2, $3, $3, 'cli_create', $4, $4)",
      values: [agentProfileId, organizationId, f.member.userId, now],
    });
    const record = {
      agentProfileId,
      bindingId: `binding-${crypto.randomUUID()}`,
      agentControllerRef: "builtin:codex",
      createdAtMs: now,
      updatedAtMs: now,
      owner: { id: f.member.userId, kind: "owner_account" as const },
      openMeldServiceRuntimeId: f.member.runtimeId,
    };
    await ensurePrimaryAgentProfileBindingRecord({ db, record });
    const expectedBindingTarget = {
      bindingId: record.bindingId,
      agentControllerRef: record.agentControllerRef,
      agentControllerConversationId: null,
      openMeldServiceRuntimeId: record.openMeldServiceRuntimeId,
    };
    if (state.startsWith("binding_changed")) {
      await db.query({
        text: "INSERT INTO \"openmeld\".\"openMeldDaemon_runtime_registry_records\" (openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane, created_at_ms, last_registered_at_ms, updated_at_ms) VALUES ($1, 'owner_account', $2, $3, 'prod', $4, $4, $4)",
        values: [
          `${f.member.runtimeId}-second`,
          f.member.userId,
          `${f.member.deviceId}-second`,
          now,
        ],
      });
    }
    const changeBinding = async () => {
      const result = await reconnectPrimaryAgentProfileBindingRecord({
        db,
        acquireExecutionTargetMutationAdmission: async () => undefined,
        record: {
          ...record,
          bindingId: `binding-${crypto.randomUUID()}`,
          openMeldServiceRuntimeId: `${f.member.runtimeId}-second`,
        },
      });
      expect(result.status).toBe("accepted");
    };
    const profile = {
      profileId: agentProfileId,
      profileName: "Reader Agent",
      profileHandle: "reader-agent",
      profileKind: "agent" as const,
      ownerUserId: f.member.userId,
      organizationId,
      defaultProjectId: null,
      status: "active" as const,
    };
    const auth: NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]> = {
      resolveProfileById: vi.fn(async () => ({ ok: true as const, profile })),
    };
    const transport = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const read = vi
      .spyOn(transport, "readRuntimeTransportProfileWorkspace")
      .mockImplementation(async () => {
        if (state === "binding_changed_during_read") {
          await changeBinding();
        }
        // Same typed receipt captured from the account-checked native reader;
        // the filesystem path is sanitized for this controlled owner scenario.
        return {
          status: "accepted",
          payload: {
            accepted: true,
            status: "read",
            targetProfileId: agentProfileId,
            workspace: {
              status: "configured",
              workspaceMode: "openmeld_managed",
              workspacePath: "/private/member/managed",
              configurationVersion: 2,
              updatedAt: "2026-10-09T22:24:57.270Z",
            },
          },
        };
      });
    const caller = state === "foreign_owner" ? f.owner : f.member;
    const context: OpenMeldRequestContext = {
      activeOrganizationId:
        state === "other_organization" ? crypto.randomUUID() : organizationId,
      actorContext: {
        callerPrincipalId: caller.userId,
        ownerUserId: caller.userId,
        openMeldProfileId: caller.profileId,
        profileKind: "human",
        profileName: "Member",
        requestId: crypto.randomUUID(),
      },
    };
    if (state === "binding_changed_before_read") {
      await changeBinding();
    }
    const result = rpcGetCurrentAgentProfileWorkspace(
      { ...f.coreEnv, OPENMELD_AUTH_WORKER: auth },
      { agentProfileId, context, expectedBindingTarget },
      state === "owner_bound_lookup"
        ? undefined
        : { deviceId: f.member.deviceId, runtimeLane: "prod" }
    );
    if (state === "owner" || state === "owner_bound_lookup") {
      await expect(result).resolves.toMatchObject({
        agentProfileId,
        target: { deviceId: f.member.deviceId, runtimeLane: "prod" },
        workspace: {
          status: "configured",
          workspacePath: "/private/member/managed",
        },
      });
    } else {
      await expect(result).rejects.toThrow();
      expect(read).toHaveBeenCalledTimes(
        state === "binding_changed_during_read" ? 1 : 0
      );
    }
  });
  it.each([
    "available",
    "old_remote",
    "old_remote_combined",
    "missing",
    "old_service",
    "wrong_device",
    "binding_changed_before_admission",
    "binding_changed_before_project_clear",
    "web_binding_changed_before_admission",
    "web_binding_changed_before_project_clear",
  ] as const)("reads only the bound Computer's saved Project connection (%s) without exposing paths", async (stateName) => {
    const legacyCaller = stateName.startsWith("old_remote");
    const viaWeb = stateName.startsWith("web_");
    const callerState = viaWeb ? stateName.slice(4) : stateName;
    const state = legacyCaller ? "available" : callerState;
    const fixture = await seedFixture();
    const organizationId = fixture.context.activeOrganizationId;
    if (!organizationId) {
      throw new Error("Missing Organization fixture");
    }
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    const projectId = `project-${crypto.randomUUID()}`;
    const db = getPostgresDatabase(env);
    await db.query({
      text: 'INSERT INTO "openmeld"."projects" (id, organization_id, name, slug, created_by_user_id, created_at_ms, updated_at_ms) VALUES ($1, $2, $3, $4, $5, $6, $6)',
      values: [
        projectId,
        organizationId,
        "Test Project",
        projectId,
        fixture.member.userId,
        Date.now(),
      ],
    });
    await db.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at, default_project_id) VALUES ($1, $2, $3, 'agent', 0, 'active', $4, $5, $5, 'cli_create', $6, $6, $7)",
      values: [
        agentProfileId,
        "Member Agent",
        agentProfileId,
        organizationId,
        fixture.member.userId,
        Date.now(),
        projectId,
      ],
    });
    await ensurePrimaryAgentProfileBindingRecord({
      db,
      record: {
        agentProfileId,
        bindingId: `binding-${crypto.randomUUID()}`,
        agentControllerRef: "builtin:codex",
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        owner: { id: fixture.member.userId, kind: "owner_account" },
        openMeldServiceRuntimeId: fixture.member.runtimeId,
      },
    });
    const profile = {
      profileId: agentProfileId,
      profileKind: "agent" as const,
      profileName: "Member Agent",
      profileHandle: "member-agent",
      ownerUserId: fixture.member.userId,
      organizationId,
      defaultProjectId: projectId,
      status: "active" as const,
    };
    const auth: NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]> = {
      resolveProfileById: vi.fn(async () => ({ ok: true as const, profile })),
      resolveProfilesByIds: vi.fn(async () => ({
        ok: true as const,
        profiles: { [agentProfileId]: profile },
      })),
      updateAgentProfileDefaultProjectInOrganization: vi.fn(async () => ({
        ok: true as const,
        profile: {
          openMeldProfileId: agentProfileId,
          profileName: profile.profileName,
          profileHandle: profile.profileHandle,
          profileKind: "agent" as const,
          isDefault: false,
          status: "active" as const,
          ownerUserId: fixture.member.userId,
          organizationId,
          defaultProjectId: null,
          source: "cli_create",
          managedRole: null,
          createdByUserId: fixture.member.userId,
          creatorProfileId: fixture.member.profileId,
          lastUsedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })),
    };
    const transport = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const service: RuntimeTransportLookupOwnerServiceResponse = {
      online: true,
      sessions: [
        {
          daemonSessionId: "member-service",
          deviceId:
            state === "wrong_device"
              ? fixture.owner.deviceId
              : fixture.member.deviceId,
          lane: "prod",
          connectionGeneration: 1,
          lastHeartbeatMs: Date.now(),
          serviceVersion: "0.3.250",
          capabilities: {
            localAgentControl: { setProfileWorkspace: true },
            localProjectControl: {
              discoverProjects: true,
              ...(state === "old_service" ? {} : { readConnections: true }),
            },
          },
          executionCompatibility: {
            status: "compatible",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
          },
        },
      ],
    };
    vi.spyOn(transport, "lookupRuntimeTransportOwnerService").mockResolvedValue(
      service
    );
    const discover = vi
      .spyOn(transport, "discoverRuntimeTransportProjects")
      .mockResolvedValue({
        requestId: "project-read",
        clientGeneration: 0,
        deviceId: fixture.member.deviceId,
        checkedAtMs: 5000,
        gitStatus: "not_checked",
        projects: [
          {
            projectId,
            status:
              state === "missing" ? "connected_folder_missing" : "connected",
            candidates: [],
            connections: [
              {
                bindingGeneration: "connection-generation-1",
                path: "/private/member/project",
                isDefault: true,
                status: state === "missing" ? "missing" : "available",
              },
            ],
          },
        ],
      });
    const response = await rpcCenterAgentCheckAgentProfileReadiness(
      { ...fixture.coreEnv, OPENMELD_AUTH_WORKER: auth },
      {
        agentProfileId,
        context: fixture.context,
        includeDefaultProjectConnection: true,
        onBehalfOf: { profileId: fixture.member.profileId },
      }
    );
    expect(response.defaultProjectConnection).toMatchObject({
      projectId,
      target: { deviceId: fixture.member.deviceId, runtimeLane: "prod" },
    });
    expect(JSON.stringify(response)).not.toContain("/private/member/project");
    expect(JSON.stringify(response)).not.toContain(fixture.owner.deviceId);
    if (state === "old_service" || state === "wrong_device") {
      expect(response.defaultProjectConnection).toMatchObject({
        status: "unavailable",
        reasonCode:
          state === "old_service"
            ? "service_update_required"
            : "computer.target_disconnected",
        configurationVersion: null,
      });
      expect(discover).not.toHaveBeenCalled();
    } else {
      expect(response.defaultProjectConnection).toMatchObject({
        status: state === "missing" ? "folder_missing" : "connected",
        configurationVersion: "connection-generation-1",
        checkedAtMs: 5000,
      });
      expect(discover).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: fixture.member.deviceId,
          runtimeLane: "prod",
          ownerUserId: fixture.member.userId,
          request: expect.objectContaining({
            includeCandidates: false,
            projects: [{ projectId, repositoryFingerprint: null }],
          }),
        })
      );
    }
    const legacy = await rpcCenterAgentCheckAgentProfileReadiness(
      { ...fixture.coreEnv, OPENMELD_AUTH_WORKER: auth },
      {
        agentProfileId,
        context: fixture.context,
        onBehalfOf: { profileId: fixture.member.profileId },
      }
    );
    expect(legacy).not.toHaveProperty("defaultProjectConnection");
    if (state === "missing" || state === "old_service") {
      return;
    }
    const switchBinding = async () => {
      const switched = await reconnectPrimaryAgentProfileBindingRecord({
        db,
        acquireExecutionTargetMutationAdmission: async () => undefined,
        record: {
          agentProfileId,
          bindingId: `binding-${crypto.randomUUID()}`,
          agentControllerRef: "builtin:codex",
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
          owner: { id: fixture.member.userId, kind: "owner_account" },
          openMeldServiceRuntimeId: `${fixture.member.runtimeId}-second`,
        },
      });
      expect(switched.status).toBe("accepted");
    };
    // Both interleavings use the actual canonical Binding writer. The second
    // owned Computer is fixture data; no old/new target is synthesized by RPC.
    if (state.startsWith("binding_changed")) {
      await db.query({
        text: "INSERT INTO \"openmeld\".\"openMeldDaemon_runtime_registry_records\" (openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane, created_at_ms, last_registered_at_ms, updated_at_ms) VALUES ($1, 'owner_account', $2, $3, 'prod', $4, $4, $4)",
        values: [
          `${fixture.member.runtimeId}-second`,
          fixture.member.userId,
          `${fixture.member.deviceId}-second`,
          Date.now(),
        ],
      });
    }
    vi.spyOn(
      transport,
      "acquireRuntimeTransportAgentProfileExecutionTargetMutation"
    ).mockImplementation(async ({ operationId }) => {
      if (state === "binding_changed_before_admission") {
        await switchBinding();
      }
      return {
        status: "acquired",
        operationId,
        expiresAtMs: Date.now() + 60_000,
      };
    });
    vi.spyOn(
      transport,
      "acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation"
    ).mockImplementation(async ({ operationId }) => {
      if (state === "binding_changed_before_project_clear") {
        await switchBinding();
      }
      return {
        status: "acquired",
        operationId,
        expiresAtMs: Date.now() + 60_000,
      };
    });
    const release = vi
      .spyOn(
        transport,
        "releaseRuntimeTransportAgentProfileExecutionTargetMutation"
      )
      .mockResolvedValue({ status: "released" });
    const save = vi
      .spyOn(transport, "setRuntimeTransportProfileWorkspace")
      .mockResolvedValue({
        status: "accepted",
        payload: {
          accepted: true,
          status: "updated",
          targetProfileId: agentProfileId,
          workspaceMode: "openmeld_managed",
          workspacePath: "/private/member/managed",
        },
      });
    if (viaWeb) {
      const expectedBindingTarget = await readPrimaryAgentProfileBindingRecord({
        agentProfileId,
        db,
        owner: { id: fixture.member.userId, kind: "owner_account" },
      });
      if (!expectedBindingTarget) {
        throw new Error("Missing canonical fixture Binding");
      }
      const expected = {
        bindingId: expectedBindingTarget.bindingId,
        agentControllerRef: expectedBindingTarget.agentControllerRef,
        agentControllerConversationId:
          expectedBindingTarget.agentControllerConversationId ?? null,
        openMeldServiceRuntimeId:
          expectedBindingTarget.openMeldServiceRuntimeId,
      };
      const context: OpenMeldRequestContext = {
        activeOrganizationId: organizationId,
        actorContext: {
          callerPrincipalId: fixture.member.userId,
          ownerUserId: fixture.member.userId,
          openMeldProfileId: fixture.member.profileId,
          profileKind: "human",
          profileName: "Member",
          requestId: crypto.randomUUID(),
        },
      };
      const webEnv = { ...fixture.coreEnv, OPENMELD_AUTH_WORKER: auth };
      const firstWrite = rpcSetBoundPeopleComputerAgentProfileWorkspace(
        webEnv,
        {
          agentProfileId,
          context,
          deviceId: fixture.member.deviceId,
          runtimeLane: "prod",
          expectedBindingTarget: expected,
          workspaceMode: "openmeld_managed",
        }
      );
      if (state === "binding_changed_before_admission") {
        await expect(firstWrite).rejects.toThrow(
          "agent_profile_binding.target_changed"
        );
        expect(save).not.toHaveBeenCalled();
      } else {
        await expect(firstWrite).resolves.toMatchObject({
          agentProfileId,
          status: "updated",
        });
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            deviceId: fixture.member.deviceId,
            targetProfileId: agentProfileId,
          })
        );
        await expect(
          rpcUpdateBoundAgentProfileDefaultProject(webEnv, {
            agentProfileId,
            context,
            expectedOrganizationId: organizationId,
            expectedBindingTarget: expected,
            defaultProjectId: null,
          })
        ).rejects.toThrow("agent_profile_binding.target_changed");
      }
      expect(
        auth.updateAgentProfileDefaultProjectInOrganization
      ).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(
        state === "binding_changed_before_admission" ? 1 : 2
      );
      return;
    }
    if (legacyCaller) {
      const bindingBefore = await readPrimaryAgentProfileBindingRecord({
        agentProfileId,
        db,
        owner: { id: fixture.member.userId, kind: "owner_account" },
      });
      await expect(
        rpcCenterAgentUpdateAgentProfileRuntimeSettings(
          { ...fixture.coreEnv, OPENMELD_AUTH_WORKER: auth },
          {
            agentProfileId,
            context: fixture.context,
            onBehalfOf: { profileId: fixture.member.profileId },
            workspaceMode: "openmeld_managed",
            ...(stateName === "old_remote_combined"
              ? {
                  agentControllerCollaborationMode: "codex:plan" as const,
                  agentControllerPermissionMode: "codex:approveForMe" as const,
                  modelId: "gpt-6.1-sol",
                  reasoningLevel: "high",
                }
              : {}),
          }
        )
      ).rejects.toThrow("center_agent.workspace_contract_update_required");
      expect(save).not.toHaveBeenCalled();
      expect(
        auth.updateAgentProfileDefaultProjectInOrganization
      ).not.toHaveBeenCalled();
      expect(
        await readPrimaryAgentProfileBindingRecord({
          agentProfileId,
          db,
          owner: { id: fixture.member.userId, kind: "owner_account" },
        })
      ).toEqual(bindingBefore);
      return;
    }
    const update =
      await rpcCenterAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace(
        { ...fixture.coreEnv, OPENMELD_AUTH_WORKER: auth },
        {
          agentProfileId,
          context: fixture.context,
          onBehalfOf: { profileId: fixture.member.profileId },
          workspaceMode: "openmeld_managed",
        }
      );
    expect(JSON.stringify(update)).not.toContain("/private/member/managed");
    if (
      state === "wrong_device" ||
      state === "binding_changed_before_admission"
    ) {
      expect(update.status).toBe("blocked");
      expect(save).not.toHaveBeenCalled();
      expect(
        auth.updateAgentProfileDefaultProjectInOrganization
      ).not.toHaveBeenCalled();
      if (state === "binding_changed_before_admission") {
        expect(update.steps).toContainEqual(
          expect.objectContaining({
            name: "update_agent_profile_workspace",
            reasonCode: "agent_profile_binding.target_changed",
            status: "failed",
          })
        );
        expect(release).toHaveBeenCalled();
      }
    } else {
      expect(update.workspace).toEqual({
        agentProfileId,
        status: "updated",
        target: { deviceId: fixture.member.deviceId, runtimeLane: "prod" },
        configurationVersion: null,
      });
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: fixture.member.deviceId,
          runtimeLane: "prod",
          ownerUserId: fixture.member.userId,
          targetProfileId: agentProfileId,
          workspaceMode: "openmeld_managed",
        })
      );
      if (state === "binding_changed_before_project_clear") {
        expect(update.status).toBe("blocked");
        expect(update.steps).toContainEqual(
          expect.objectContaining({
            name: "update_agent_profile_workspace",
            status: "completed",
          })
        );
        expect(update.steps).toContainEqual(
          expect.objectContaining({
            name: "update_agent_profile_default_project",
            reasonCode: "agent_profile_binding.target_changed",
            status: "failed",
          })
        );
        expect(
          auth.updateAgentProfileDefaultProjectInOrganization
        ).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(2);
        return;
      }
      expect(
        auth.updateAgentProfileDefaultProjectInOrganization
      ).toHaveBeenCalledWith({
        profileId: agentProfileId,
        ownerUserId: fixture.member.userId,
        organizationId,
        defaultProjectId: null,
      });
      expect(update.steps).toContainEqual(
        expect.objectContaining({
          name: "update_agent_profile_default_project",
          status: "completed",
        })
      );
    }
  });
  it("reads readiness as the represented owner and rejects missing, revoked or different owners", async () => {
    const fixture = await seedFixture();
    const agentProfileId = `agt_${crypto.randomUUID()}`;
    const resolveProfileById = vi
      .fn<
        NonNullable<
          NonNullable<
            CoreBindings["OPENMELD_AUTH_WORKER"]
          >["resolveProfileById"]
        >
      >()
      .mockResolvedValue({
        ok: true,
        profile: {
          profileId: agentProfileId,
          profileKind: "agent",
          profileName: "Member Agent",
          profileHandle: "member-agent",
          ownerUserId: fixture.member.userId,
          status: "active",
        },
      });
    const coreEnv = {
      ...fixture.coreEnv,
      OPENMELD_AUTH_WORKER: { resolveProfileById },
    } as CoreBindings;
    const request = {
      agentProfileId,
      context: fixture.context,
      onBehalfOf: { profileId: fixture.member.profileId },
    };
    await expect(
      rpcCenterAgentCheckAgentProfileReadiness(coreEnv, request)
    ).resolves.toMatchObject({ agentProfileId, canReply: false });
    await expect(
      rpcCenterAgentCheckAgentProfileReadiness(coreEnv, {
        agentProfileId,
        context: fixture.context,
      })
    ).rejects.toThrow("verified requesting member");
    await expect(
      rpcCenterAgentCheckAgentProfileReadiness(coreEnv, {
        ...request,
        onBehalfOf: { profileId: fixture.owner.profileId },
      })
    ).rejects.toThrow("agent profile not found");
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [fixture.member.memberId],
    });
    await expect(
      rpcCenterAgentCheckAgentProfileReadiness(coreEnv, request)
    ).rejects.toThrow("requesting member is no longer available");
  });
  it("returns only the represented member's inventory without claiming a current computer", async () => {
    const fixture = await seedFixture();
    const request = {
      context: fixture.context,
      speakerMember: {
        memberId: fixture.member.memberId,
        userId: fixture.member.userId,
      },
    };
    const result = await rpcCenterAgentReadPeopleComputers(
      fixture.coreEnv,
      request
    );
    expect(result.inventory.computers).toHaveLength(1);
    expect(JSON.stringify(result.inventory)).toContain(fixture.member.deviceId);
    expect(JSON.stringify(result)).not.toContain(fixture.owner.deviceId);
    expect(JSON.stringify(result)).not.toContain('"isCurrent"');
    const reportedTarget = result.inventory.computers[0]?.executionTargets[0];
    expect(reportedTarget).toMatchObject({
      deviceId: fixture.member.deviceId,
      runtimeLane: "prod",
    });
    expect(reportedTarget).not.toHaveProperty("localAgentCatalog");
    expect(reportedTarget).not.toHaveProperty("capabilities");
    expect(result.selectedComputer).toBeNull();
    const transport = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const disconnected: RuntimeTransportLookupOwnerServiceResponse = {
      online: false,
      reasonCode: "daemon.session.not_found",
    };
    vi.spyOn(transport, "lookupRuntimeTransportOwnerService").mockResolvedValue(
      disconnected
    );
    const target = {
      deviceId: fixture.member.deviceId,
      runtimeLane: "canary" as const,
    };
    const selected = await rpcCenterAgentReadPeopleComputers(fixture.coreEnv, {
      ...request,
      target,
    });
    expect(selected.selectedComputer).toMatchObject({
      target,
      readiness: {
        canReplyFromThisComputer: false,
        currentTarget: { availability: "resolved", ...target },
        service: { connected: false },
      },
      fileAccess: { status: "unavailable" },
      care: {
        connection: "unavailable",
        supervisor: "unknown",
        executionHost: null,
      },
    });
    await expect(
      rpcCenterAgentReadPeopleComputers(fixture.coreEnv, {
        ...request,
        target: { deviceId: fixture.owner.deviceId, runtimeLane: "prod" },
      })
    ).rejects.toThrow("not available on your account");
  });
  it("updates only the represented member's explicit environment, never the organization's creator's computer", async () => {
    const transport = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const fixture = await seedFixture();
    const ownerService: RuntimeTransportLookupOwnerServiceResponse = {
      online: true,
      sessions: [
        {
          daemonSessionId: "member-service",
          deviceId: fixture.member.deviceId,
          lane: "canary",
          connectionGeneration: 1,
          lastHeartbeatMs: Date.now(),
          serviceVersion: "0.3.164",
          capabilities: { openMeldToolsControl: { requestUpdate: true } },
          executionCompatibility: {
            status: "compatible",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
          },
        },
      ],
    };
    const lookup = vi
      .spyOn(transport, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue(ownerService);
    const control = vi
      .spyOn(transport, "controlRuntimeTransportOpenMeldTools")
      .mockResolvedValue({
        status: "accepted",
        result: {
          operation: "request_update",
          result: { status: "current", currentVersion: "0.3.164" },
        },
      });
    const request = {
      context: fixture.context,
      speakerMember: {
        memberId: fixture.member.memberId,
        userId: fixture.member.userId,
      },
      target: {
        deviceId: fixture.member.deviceId,
        runtimeLane: "canary" as const,
      },
    };
    const host = {
      hostInstanceId: "c8229897-5b9c-4e8f-afc9-ed79f93d45ca",
      observedAtMs: Date.now(),
      responsive: false,
      admission: "open" as const,
      activeCount: 1,
      pendingCount: 2,
      unacknowledgedResultCount: 1,
      startupReplayPending: false,
    };
    const memberSession = ownerService.sessions[0];
    if (!memberSession) {
      throw new Error("Missing member session fixture");
    }
    memberSession.capabilities.executionHost = host;
    const diagnostics = await rpcCenterAgentReadPeopleComputers(
      fixture.coreEnv,
      request
    );
    expect(diagnostics.selectedComputer?.care).toMatchObject({
      connection: "connected",
      supervisor: "responding",
      executionHost: host,
    });
    const wrongLane = await rpcCenterAgentReadPeopleComputers(fixture.coreEnv, {
      ...request,
      target: { ...request.target, runtimeLane: "prod" },
    });
    expect(wrongLane.selectedComputer?.care).toMatchObject({
      connection: "unavailable",
      executionHost: null,
    });
    await expect(
      rpcCenterAgentRequestOpenMeldToolsUpdate(fixture.coreEnv, {
        ...request,
        target: { ...request.target, deviceId: fixture.owner.deviceId },
      })
    ).rejects.toThrow("not available on your account");
    await expect(
      rpcCenterAgentRequestOpenMeldToolsUpdate(fixture.coreEnv, {
        ...request,
        target: { ...request.target, runtimeLane: "prod" },
      })
    ).rejects.toThrow("disconnected in this environment");
    expect(control).not.toHaveBeenCalled();
    await expect(
      rpcCenterAgentRequestOpenMeldToolsUpdate(fixture.coreEnv, request)
    ).resolves.toMatchObject({
      result: { status: "current" },
    });
    expect(lookup).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerUserId: fixture.member.userId })
    );
    expect(control).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ownerUserId: fixture.member.userId,
        deviceId: fixture.member.deviceId,
        runtimeLane: "canary",
        request: { operation: "request_update", requestSource: "center_agent" },
      })
    );
  });
  it("reads the requesting member's devices instead of the organization's creator's devices", async () => {
    const fixture = await seedFixture();
    const result = await rpcCenterAgentListLocalAgentConnectionCandidates(
      fixture.coreEnv,
      {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
      }
    );
    expect(result.candidates.map((candidate) => candidate.deviceId)).toEqual([
      fixture.member.deviceId,
    ]);
    expect(result.candidates[0]?.connectable).toBe(false);
    expect(JSON.stringify(result)).not.toContain(fixture.owner.deviceId);
  });
  it("rejects mismatched member identity and an explicitly requested nonmember", async () => {
    const fixture = await seedFixture();
    await expect(
      rpcCenterAgentListLocalAgentConnectionCandidates(fixture.coreEnv, {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.owner.userId,
        },
      })
    ).rejects.toThrow("verified active human");
    await expect(
      rpcCenterAgentListLocalAgentConnectionCandidates(fixture.coreEnv, {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
        memberUserId: "not-an-organization-member",
      })
    ).rejects.toThrow();
  });
  it("permits explicit team-member candidate discovery without changing the requesting identity", async () => {
    const fixture = await seedFixture();
    const result = await rpcCenterAgentListLocalAgentConnectionCandidates(
      fixture.coreEnv,
      {
        context: fixture.context,
        speakerMember: {
          memberId: fixture.member.memberId,
          userId: fixture.member.userId,
        },
        memberUserId: fixture.owner.userId,
      }
    );
    expect(result.candidates.map((candidate) => candidate.deviceId)).toEqual([
      fixture.owner.deviceId,
    ]);
  });
});
async function seedFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org_people_computers_${suffix}`;
  const actors = ["owner", "member"].map((role) => ({
    role,
    userId: `user_${role}_${suffix}`,
    memberId: `member_${role}_${suffix}`,
    profileId: crypto.randomUUID(),
    deviceId: `device_${role}_${suffix}`,
    runtimeId: `runtime_${role}_${suffix}`,
  }));
  const owner = actors[0];
  const member = actors[1];
  if (!(owner && member)) {
    throw new Error("Missing fixture members.");
  }
  const centerAgentId = `agt_${crypto.randomUUID()}`;
  const now = Date.now();
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Computer test\', $2, $3)',
      values: [],
    },
    values: [organizationId, `people-computers-${suffix}`, now],
  });
  for (const actor of actors) {
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
              values: [],
            },
            values: [
              actor.userId,
              actor.role,
              `${actor.userId}@example.com`,
              now,
              now,
            ],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
              values: [],
            },
            values: [
              actor.memberId,
              organizationId,
              actor.userId,
              actor.role,
              now,
            ],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $5, 'auth_bootstrap', $6, $7)",
              values: [],
            },
            values: [
              actor.profileId,
              actor.role,
              `${actor.role}-${suffix}`,
              actor.userId,
              actor.userId,
              now,
              now,
            ],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openMeldDaemon_owned_devices\" (owner_user_id, device_id, observed_display_name, platform_family, device_type, first_seen_at_ms, last_observed_at_ms, updated_at_ms) VALUES ($1, $2, $3, 'macOS', 'laptop', $4, $5, $6)",
              values: [],
            },
            values: [
              actor.userId,
              actor.deviceId,
              `${actor.role} computer`,
              now,
              now,
              now,
            ],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openMeldDaemon_runtime_registry_records\" (openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane, created_at_ms, last_registered_at_ms, updated_at_ms) VALUES ($1, 'owner_account', $2, $3, 'prod', $4, $5, $6)",
              values: [],
            },
            values: [
              actor.runtimeId,
              actor.userId,
              actor.deviceId,
              now,
              now,
              now,
            ],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openMeldDaemon_runtime_agent_controller_reports\" (openmeld_service_runtime_id, agent_controller_ref, report_status, observed_at_ms, expires_at_ms, reported_reason_codes_json, accepted_at_ms, updated_at_ms) VALUES ($1, 'builtin:codex', 'ready', $2, $3, '[]', $4, $5)",
              values: [],
            },
            values: [actor.runtimeId, now, now + 60_000, now, now],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  }
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, managed_role, created_at, updated_at) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'cli_create', 'center_agent', $5, $6)",
            values: [],
          },
          values: [
            centerAgentId,
            `center-agent-${suffix}`,
            organizationId,
            owner.userId,
            now,
            now,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, $3, $4)',
            values: [],
          },
          values: [organizationId, centerAgentId, owner.userId, now],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  const context: OpenMeldRequestContext = {
    activeOrganizationId: organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: centerAgentId,
      openMeldProfileId: centerAgentId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: suffix,
    },
  };
  // Real D1 authorization and reports; no Service transport is configured, so
  // connection remains unknown and historical reports cannot admit execution.
  return {
    context,
    owner,
    member,
    coreEnv: { OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL } as CoreBindings,
  };
}
