import { env } from "cloudflare:test";
import { createRuntimeLookupInput } from "@openmeld/agent-runtime";
import {
  centerAgentCreateConfiguredAgentProfileBodySchema,
  centerAgentCreateConfiguredAgentProfileResponseSchema,
  localRuntimesResponseSchema,
  openMeldRequestContextSchema,
} from "@openmeld/schemas";
import type { LocalRuntimesResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../../remote-agent/agent-core/callback-context";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentOpenMeldToolDefinition,
} from "../../remote-agent/agent-core/tools";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { InMemoryDurableObjectStorage } from "../../remote-agent/tests/storage";
import { projectCenterAgentLocalAgentConnectionCandidates } from "../src/center-agent/application/product-operations";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCenterAgentCreateConfiguredAgentProfile } from "../src/rpc/methods";
import { acceptRuntimeAgentControllerReportRecord } from "../src/runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for the local runtime inventory test seam.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";
import { readAvailableModelIds } from "./test-support/model-catalog.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_10000000-0000-4000-8000-000000000001";
const CREATED_AGENT_PROFILE_ID = "agt_10000000-0000-4000-8000-000000000002";
const HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "org-configured-model-validation";
const OWNER_USER_ID = "user-configured-model-validation";
const SPACE_ID = "a".repeat(64);
const TEST_NOW_MS = Date.parse("2026-07-10T00:00:00.000Z");
const CONFIGURED_PROFILE_TOOL_RPC_INPUT_SCHEMA =
  centerAgentCreateConfiguredAgentProfileBodySchema.safeExtend({
    context: openMeldRequestContextSchema,
  });

describe("Center Agent configured Agent Profile model validation", () => {
  it("returns the real Core model rejection through the Remote Agent tool", async () => {
    await seedConfiguredProfileFixture();
    try {
      const createdProfile = {
        createdAt: "2026-07-10T00:00:00.000Z",
        createdByUserId: OWNER_USER_ID,
        creatorProfileId: CENTER_AGENT_PROFILE_ID,
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerUserId: OWNER_USER_ID,
        profileHandle: "invalid-model-agent",
        profileKind: "agent" as const,
        profileName: "Invalid Model Agent",
        source: "user_created",
        status: "active" as const,
        updatedAt: "2026-07-10T00:00:00.000Z",
        openMeldProfileId: CREATED_AGENT_PROFILE_ID,
      };
      const authWorker = {
        createAgentProfileInOrganization: vi.fn(async () => {
          await insertCreatedAgentProfile();
          return { ok: true as const, profile: createdProfile };
        }),
        resolveProfileById: vi.fn(() =>
          Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: OWNER_USER_ID,
              profileHandle: createdProfile.profileHandle,
              profileId: CREATED_AGENT_PROFILE_ID,
              profileKind: "agent" as const,
              profileName: createdProfile.profileName,
              status: "active" as const,
            },
          })
        ),
      } satisfies NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>;
      const coreEnv = {
        OPENMELD_AUTH_WORKER: authWorker,
        OPENMELD_DB: env.OPENMELD_DB,
        OPENMELD_SPACES: env.OPENMELD_SPACES as CoreBindings["OPENMELD_SPACES"],
      } satisfies CoreBindings;
      const localRuntimesResponse = createLocalRuntimesResponse();
      const agentControllerInterface =
        localRuntimesResponse.localRuntimes[0]?.executionTargets[0]
          ?.capabilities[0]?.agentControllerInterface;
      if (!agentControllerInterface) {
        throw new Error(
          "Expected the runtime fixture to include ACI evidence."
        );
      }
      const runtimeLookupInput = createRuntimeLookupInput({
        deviceId: "device-configured-model-validation",
        lane: "dev-local",
        owner: { id: OWNER_USER_ID, kind: "owner_account" },
      });
      const listLocalRuntimes = vi
        .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
        .mockResolvedValue(localRuntimesResponse);
      await seedRuntimeEvidence({
        agentControllerInterface,
        localRuntimes: localRuntimesResponse,
        runtimeLookupInput,
      });

      const request = createSubmitTurnRequest({
        agentProfileId: CENTER_AGENT_PROFILE_ID,
        agentProfileOwnerUserId: OWNER_USER_ID,
        author: {
          displayName: "Configured Model Validation Owner",
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
        },
        organizationId: ORGANIZATION_ID,
        spaceId: SPACE_ID,
        turnEnvelope: {
          ...createSubmitTurnRequest().turnEnvelope,
          organization: {
            id: ORGANIZATION_ID,
            memberCount: 1,
            name: "Configured Model Validation",
            personal: true,
          },
          sender: {
            displayName: "Configured Model Validation Owner",
            id: "member-configured-model-validation",
            kind: "member",
            ownerUserId: OWNER_USER_ID,
            profileId: HUMAN_PROFILE_ID,
            role: "owner",
            verified: true,
          },
          space: {
            id: SPACE_ID,
            isCenterAgentDm: true,
            kind: "dm",
            name: "Configured Model Validation DM",
          },
        },
      });
      const storage = new InMemoryDurableObjectStorage();
      await putRemoteAgentCallbackContext(
        storage,
        createRemoteAgentCallbackContext({
          ack: {
            accepted: true,
            createdAt: TEST_NOW_MS,
            idempotencyKey: request.idempotencyKey,
            requestId: "request-configured-profile-validation",
            status: "pending",
            submissionId: "submission-configured-profile-validation",
          },
          nowMs: TEST_NOW_MS,
          request,
        })
      );
      const candidate = projectCenterAgentLocalAgentConnectionCandidates({
        localRuntimes: localRuntimesResponse,
        organizationId: ORGANIZATION_ID,
      }).candidates[0];
      if (!candidate) {
        throw new Error("Expected the runtime fixture to project a candidate.");
      }
      const tool = requireRemoteAgentTool(
        getRemoteAgentOpenMeldToolDefinitions({
          coreWorker: {
            centerAgentCreateConfiguredAgentProfile: async (input) =>
              await rpcCenterAgentCreateConfiguredAgentProfile(
                coreEnv,
                CONFIGURED_PROFILE_TOOL_RPC_INPUT_SCHEMA.parse(input)
              ),
          },
          storage,
          submissionId: "submission-configured-profile-validation",
        }),
        "openmeld_create_configured_agent_profile"
      );
      const toolResult: unknown = await tool.execute({
        candidateId: candidate.candidateId,
        modelId: "gpt-99-nonexistent",
        profileName: createdProfile.profileName,
        spaceId: SPACE_ID,
      });
      expect(listLocalRuntimes).toHaveBeenCalled();

      const result =
        centerAgentCreateConfiguredAgentProfileResponseSchema.parse(toolResult);
      const failedConnectionStep = result.steps.find(
        (step) => step.name === "connect_agent_profile_to_local_agent"
      );
      const availableModelIds = readAvailableModelIds("codex");
      const expectedValidationMessage = `Model "gpt-99-nonexistent" is not supported for Agent Controller "builtin:codex". Supported models: ${availableModelIds.join(", ")}.`;

      expect(result).toMatchObject({
        agentProfileId: CREATED_AGENT_PROFILE_ID,
        canReply: false,
        organizationId: ORGANIZATION_ID,
        status: "blocked",
      });
      expect(failedConnectionStep).toMatchObject({ status: "failed" });
      expect(failedConnectionStep?.message).toContain("HTTP 400:");
      expect(failedConnectionStep?.message).toContain(
        '"code":"agent_profile_binding.model_not_supported"'
      );
      expect(failedConnectionStep?.message).toContain(
        JSON.stringify(expectedValidationMessage).slice(1, -1)
      );
      expect(
        await env.OPENMELD_DB.prepare(
          `
          SELECT count(*) AS binding_count
          FROM openMeldDaemon_agent_profile_bindings
          WHERE owner_id = ? AND agent_profile_id = ?
        `
        )
          .bind(OWNER_USER_ID, CREATED_AGENT_PROFILE_ID)
          .first<number>("binding_count")
      ).toBe(0);
    } finally {
      vi.restoreAllMocks();
      await cleanupConfiguredProfileFixture();
    }
  });
});

async function seedConfiguredProfileFixture(): Promise<void> {
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO users (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `
    ).bind(
      OWNER_USER_ID,
      "Configured Model Validation Owner",
      "configured-model-validation@example.com",
      1,
      TEST_NOW_MS,
      TEST_NOW_MS
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES (?, ?, ?, ?)
      `
    ).bind(
      ORGANIZATION_ID,
      "Configured Model Validation",
      "configured-model-validation",
      TEST_NOW_MS
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).bind(
      "member-configured-model-validation",
      ORGANIZATION_ID,
      OWNER_USER_ID,
      "owner",
      TEST_NOW_MS
    ),
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      CENTER_AGENT_PROFILE_ID,
      "Configured Model Validation Center Agent",
      "configured-model-validation-center-agent",
      "agent",
      0,
      "active",
      ORGANIZATION_ID,
      OWNER_USER_ID,
      OWNER_USER_ID,
      "cli_create",
      "center_agent",
      TEST_NOW_MS,
      TEST_NOW_MS
    ),
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      HUMAN_PROFILE_ID,
      "Configured Model Validation Owner",
      "configured-model-validation-owner",
      "human",
      1,
      "active",
      null,
      OWNER_USER_ID,
      OWNER_USER_ID,
      "cli_create",
      null,
      TEST_NOW_MS,
      TEST_NOW_MS
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO center_agent_designations (
          organization_id,
          agent_profile_id,
          duty,
          designated_by,
          created_at
        ) VALUES (?, ?, ?, ?, ?)
      `
    ).bind(
      ORGANIZATION_ID,
      CENTER_AGENT_PROFILE_ID,
      null,
      OWNER_USER_ID,
      TEST_NOW_MS
    ),
  ]);
}

async function insertCreatedAgentProfile(): Promise<void> {
  await env.OPENMELD_DB.prepare(
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
        creator_profile_id,
        source,
        managed_role,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      CREATED_AGENT_PROFILE_ID,
      "Invalid Model Agent",
      "invalid-model-agent",
      "agent",
      0,
      "active",
      ORGANIZATION_ID,
      OWNER_USER_ID,
      OWNER_USER_ID,
      CENTER_AGENT_PROFILE_ID,
      "cli_create",
      null,
      TEST_NOW_MS,
      TEST_NOW_MS
    )
    .run();
}

async function seedRuntimeEvidence(input: {
  agentControllerInterface: NonNullable<
    LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number]["capabilities"][number]["agentControllerInterface"]
  >;
  localRuntimes: LocalRuntimesResponse;
  runtimeLookupInput: ReturnType<typeof createRuntimeLookupInput>;
}): Promise<void> {
  const nowMs = Date.now();
  const openMeldServiceRuntimeId =
    input.localRuntimes.localRuntimes[0]?.executionTargets[0]
      ?.openMeldServiceRuntimeId;
  if (!openMeldServiceRuntimeId) {
    throw new Error("Expected the runtime fixture to include a Runtime id.");
  }
  const registration = await registerRuntimeRegistryRecord({
    db: env.OPENMELD_DB,
    record: {
      nowMs,
      openMeldServiceRuntimeId,
      runtimeLookupInput: input.runtimeLookupInput,
    },
  });
  if (registration.status !== "created") {
    throw new Error(
      `Expected to create the runtime registry record, received ${registration.status}.`
    );
  }
  const report = await acceptRuntimeAgentControllerReportRecord({
    db: env.OPENMELD_DB,
    nowMs,
    report: {
      agentControllerInterface: input.agentControllerInterface,
      agentControllerRef: "builtin:codex",
      expiresAtMs: nowMs + 60 * 60_000,
      observedAtMs: nowMs,
      reasonCodes: [],
      status: "ready",
      openMeldServiceRuntimeId,
    },
  });
  if (report.status !== "accepted") {
    throw new Error(
      `Expected to accept the Runtime Agent Controller report, received ${report.status}.`
    );
  }
}

async function cleanupConfiguredProfileFixture(): Promise<void> {
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "DELETE FROM center_agent_audit_journal WHERE organization_id = ?"
    ).bind(ORGANIZATION_ID),
    env.OPENMELD_DB.prepare(
      "DELETE FROM center_agent_designations WHERE organization_id = ?"
    ).bind(ORGANIZATION_ID),
    env.OPENMELD_DB.prepare(
      "DELETE FROM organization_binding_authorizations WHERE organization_id = ?"
    ).bind(ORGANIZATION_ID),
    env.OPENMELD_DB.prepare(
      `
        DELETE FROM openMeldDaemon_agent_profile_bindings
        WHERE owner_id = ? AND agent_profile_id IN (?, ?)
      `
    ).bind(OWNER_USER_ID, CENTER_AGENT_PROFILE_ID, CREATED_AGENT_PROFILE_ID),
    env.OPENMELD_DB.prepare(
      `
        DELETE FROM openMeldDaemon_runtime_agent_controller_reports
        WHERE openmeld_service_runtime_id = ?
      `
    ).bind("runtime-configured-model-validation"),
    env.OPENMELD_DB.prepare(
      `
        DELETE FROM openMeldDaemon_runtime_registry_records
        WHERE openmeld_service_runtime_id = ?
      `
    ).bind("runtime-configured-model-validation"),
    env.OPENMELD_DB.prepare(
      "DELETE FROM openmeld_profiles WHERE profile_id IN (?, ?, ?)"
    ).bind(CENTER_AGENT_PROFILE_ID, CREATED_AGENT_PROFILE_ID, HUMAN_PROFILE_ID),
    env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    ).bind(ORGANIZATION_ID, OWNER_USER_ID),
    env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
      ORGANIZATION_ID
    ),
    env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(
      OWNER_USER_ID
    ),
  ]);
}

function createLocalRuntimesResponse(): LocalRuntimesResponse {
  return localRuntimesResponseSchema.parse({
    currentConnectedComputerId: "computer-configured-model-validation",
    currentDeviceId: "device-configured-model-validation",
    currentRuntimeLane: "dev-local",
    legacyDeviceEvidence: [],
    localRuntimes: [
      {
        connectedComputerId: "computer-configured-model-validation",
        connectionStatus: "connected",
        deviceDisplayName: "Test MacBook Pro",
        deviceDisplayNameSource: "observed",
        deviceId: "device-configured-model-validation",
        deviceType: "laptop",
        executionTargets: [
          {
            capabilities: [
              {
                agentControllerInterface: {
                  agentControllerRef: "builtin:codex",
                  auth: { status: "authenticated" },
                  capabilities: {
                    approvals: true,
                    cancel: true,
                    interrupt: true,
                    modelSelection: true,
                    nativeEventStream: true,
                    permissionModes: true,
                    structuredUserInput: true,
                  },
                  checkedAt: "2026-07-10T00:00:00.000Z",
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: [],
                    commandPath: "/Applications/Codex.app/Contents/MacOS/Codex",
                    installChoiceCount: 1,
                    status: "ready",
                  },
                  message: null,
                  models: [],
                  nativeInterface: "codex-app-server",
                  schemaVersion: 1,
                  skills: [],
                  status: "ready",
                  version: "1.0.0",
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready",
              },
            ],
            deviceId: "device-configured-model-validation",
            isCurrent: true,
            lastObservedAtMs: TEST_NOW_MS,
            localAgentCatalog: {
              detectedNotSupportedYet: 0,
              detectedSupported: 0,
              entries: [],
              needsChoice: 0,
              needsRepair: 0,
              notDetected: 0,
              totalBuiltins: 0,
            },
            localAgentControl: {
              refreshCatalog: true,
              setEnabled: true,
              setProfileWorkspace: true,
            },
            reasonCodes: [],
            runtimeLane: "dev-local",
            status: "ready",
            userFacingCommand: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-configured-model-validation",
            },
          },
        ],
        firstSeenAtMs: TEST_NOW_MS - 1000,
        isCurrent: true,
        lastObservedAtMs: TEST_NOW_MS,
        legacyDeviceIds: ["device-configured-model-validation"],
        osVersion: "15.6",
        platformFamily: "macOS",
      },
    ],
  });
}

function requireRemoteAgentTool(
  tools: RemoteAgentOpenMeldToolDefinition[],
  name: RemoteAgentOpenMeldToolDefinition["name"]
): RemoteAgentOpenMeldToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing Remote Agent tool: ${name}`);
  }
  return tool;
}
