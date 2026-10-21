import { createExecutionContext } from "cloudflare:test";
import { createHash } from "node:crypto";
import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type { RuntimeTransportLookupOwnerServiceResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import { handleAgentProfileCreationMessage } from "../src/agent-profile-creation-request/agent-profile-creation-execution";
import { recoverAgentProfileCreationRequests } from "../src/agent-profile-creation-request/agent-profile-creation-request-recovery";
import { createPostgresAgentProfileCreationRequestRepository } from "../src/agent-profile-creation-request/agent-profile-creation-request-repository";
import {
  executeAgentProfileCreationRequest,
  rpcRetryAgentProfileCreationRequest as retryRequest,
  rpcListAgentProfileCreationRequests,
  rpcCenterAgentCreateAgentProfileCreationRequest as submitCenterAgentRequest,
  rpcCreateAgentProfileCreationRequest as submitRequest,
} from "../src/agent-profile-creation-request/agent-profile-creation-request-rpc";
import type { CoreBindings } from "../src/lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Vitest needs the module object to replace this dependency at the RPC boundary.
import * as rpcMethods from "../src/rpc/methods";
import { handleCoreQueueBatch } from "../src/shared/queue/core-queue-router";
// biome-ignore lint/performance/noNamespaceImport: Vitest needs the module object to replace this dependency at the RPC boundary.
import * as currentDeviceTargetService from "../src/start/application/current-device-target-service";
import { env } from "../test-support/worker-env";

// These integration scenarios cover the complete admission + execution path.
// Production delivery invokes the same executor from the Core queue consumer.
async function rpcCreateAgentProfileCreationRequest(
  ...args: Parameters<typeof submitRequest>
) {
  const result = await submitRequest(...args);
  return {
    ...result,
    request: await executeAgentProfileCreationRequest(args[0], result.request),
  };
}
async function rpcRetryAgentProfileCreationRequest(
  ...args: Parameters<typeof retryRequest>
) {
  const result = await retryRequest(...args);
  return {
    ...result,
    request: await executeAgentProfileCreationRequest(args[0], result.request),
  };
}
describe("Agent Profile creation request RPC", () => {
  it("replays a pre-upgrade Center request without replacing its identity or merging another Space intent", async () => {
    const fixture = await seedFixture();
    const send = vi.fn();
    const createAgentProfileInOrganization = vi.fn();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
    } as unknown as CoreBindings;
    const command = {
      ...centerCreationCommand(fixture),
      configuration: {
        ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
        agentControllerRef: "builtin:codex",
        targetComputerId: `device-${fixture.suffix}`,
      },
      requestedSpaceId: `space-before-upgrade-${fixture.suffix}`,
    };
    // Freeze the pre-upgrade byte formula independently of the new key builder.
    const legacyKey = `center-agent:agent-profile-request:${createHash("sha256")
      .update(
        JSON.stringify({
          configuration: command.configuration,
          nativeSessionId: null,
          profileName: command.profileName,
          requestId: command.context.actorContext.requestId,
          sessionStrategy: command.sessionStrategy,
          targetOwnerUserId: command.targetOwnerUserId,
        })
      )
      .digest("hex")}`;
    const accepted = await submitRequest(bindings, {
      ...command,
      context: {
        ...command.context,
        actorContext: {
          ...command.context.actorContext,
          callerPrincipalId: fixture.requesterUserId,
          ownerUserId: fixture.requesterUserId,
        },
      },
      idempotencyKey: legacyKey,
      organizationId: fixture.organizationId,
      source: "center_agent",
    });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    const completedAtMs = Date.parse(accepted.request.updatedAt) + 1;
    const createdAgentProfileId = `agt_${crypto.randomUUID()}`;
    // The old deployment already completed setup; only its response was lost.
    const completed = await repository.transition({
      expectedStatuses: ["approved"],
      expectedUpdatedAtMs: Date.parse(accepted.request.updatedAt),
      requestId: accepted.request.id,
      update: {
        completedAtMs,
        createdAgentProfileId,
        status: "completed",
        statusReason: "profile_created",
        updatedAtMs: completedAtMs,
      },
    });
    expect(completed).not.toBeNull();
    send.mockClear();
    const replay = await submitCenterAgentRequest(bindings, command);
    expect(replay).toMatchObject({
      replayed: true,
      request: {
        id: accepted.request.id,
        createdAgentProfileId,
        status: "completed",
      },
    });
    await executeAgentProfileCreationRequest(bindings, replay.request);
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // The legacy hash omitted Space. It must not absorb a different intent.
    const otherCommand = {
      ...command,
      requestedSpaceId: `space-after-upgrade-${fixture.suffix}`,
    };
    const other = await submitCenterAgentRequest(bindings, otherCommand);
    expect(other.replayed).toBe(false);
    expect(other.request.id).not.toBe(accepted.request.id);
    expect(other.request.createdAgentProfileId).toBeNull();
    await expect(
      submitCenterAgentRequest(bindings, otherCommand)
    ).resolves.toMatchObject({
      replayed: true,
      request: {
        id: other.request.id,
        requestedSpaceId: otherCommand.requestedSpaceId,
      },
    });
    expect(
      await repository.findByIdempotencyKey({
        idempotencyKey: legacyKey,
        organizationId: fixture.organizationId,
        requesterUserId: fixture.requesterUserId,
      })
    ).toMatchObject({
      id: accepted.request.id,
      createdAgentProfileId,
      status: "completed",
    });
    const rows = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT count(*) AS count FROM "openmeld"."agent_profile_creation_requests" WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(rows?.count).toBe(2);
  });
  it("keeps distinct target Spaces separate while replaying the same canonical Center creation intent", async () => {
    const fixture = await seedFixture();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn() },
    } as unknown as CoreBindings;
    const command = centerCreationCommand(fixture);
    const first = await submitCenterAgentRequest(bindings, {
      ...command,
      requestedSpaceId: "space-a",
    });
    const same = await submitCenterAgentRequest(bindings, {
      ...command,
      profileName: ` ${command.profileName} `,
      requestedSpaceId: "space-a",
      configuration: Object.fromEntries(
        Object.entries(command.configuration).reverse()
      ) as typeof command.configuration,
    });
    expect(same).toMatchObject({
      replayed: true,
      request: { id: first.request.id },
    });
    const other = await submitCenterAgentRequest(bindings, {
      ...command,
      requestedSpaceId: "space-b",
    });
    expect(other.replayed).toBe(false);
    expect(other.request.id).not.toBe(first.request.id);
    expect(other.request).toMatchObject({
      requestedSpaceId: "space-b",
      status: "approved",
      createdAgentProfileId: null,
    });
    const rows = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT count(*) AS count FROM "openmeld"."agent_profile_creation_requests" WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(rows?.count).toBe(2);
  });
  it("rejects a Center working request with no run target before persisting identity or execution", async () => {
    const fixture = await seedFixture();
    const send = vi.fn();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
    } as unknown as CoreBindings;
    await expect(
      submitCenterAgentRequest(bindings, {
        ...centerCreationCommand(fixture),
        configuration: undefined,
      })
    ).rejects.toMatchObject({
      code: "agent_profile_creation_request.state_conflict",
    });
    expect(send).not.toHaveBeenCalled();
    const rows = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT count(*) AS count FROM "openmeld"."agent_profile_creation_requests" WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(rows?.count).toBe(0);
  });
  it("rejects contradictory Remote and Local selection without silently changing the requested runtime", async () => {
    const fixture = await seedFixture();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as CoreBindings;
    await expect(
      submitCenterAgentRequest(bindings, {
        ...centerCreationCommand(fixture),
        localAgentConnectionCandidateId: "local-candidate",
      })
    ).rejects.toMatchObject({ code: "invalid_payload", status: 400 });
  });
  it("recovers a durable accepted request after notification loss and executes duplicate deliveries only once", async () => {
    const fixture = await seedFixture();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue temporarily unavailable"))
      .mockResolvedValue(undefined);
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: { openMeldProfileId: "agt_durable_creation" },
    });
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
    } as unknown as CoreBindings;
    const command = {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `lost-ack-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Durable Agent",
      sessionStrategy: "new" as const,
      source: "cli" as const,
      targetOwnerUserId: fixture.requesterUserId,
    };
    const accepted = await submitRequest(bindings, command);
    expect(accepted.request.status).toBe("approved");
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
    const recovered = await rpcListAgentProfileCreationRequests(bindings, {
      context: command.context,
      organizationId: command.organizationId,
      idempotencyKey: command.idempotencyKey,
    });
    expect(recovered).toMatchObject({
      matchedIdempotencyKey: command.idempotencyKey,
      requests: [{ id: accepted.request.id, status: "approved" }],
    });
    await recoverAgentProfileCreationRequests({
      db: getPostgresDatabase(env),
      env: bindings,
      nowMs: Date.now(),
    });
    const body = send.mock.calls.findLast(
      ([message]) => message.requestId === accepted.request.id
    )?.[0];
    expect(body).toEqual({
      kind: "agent_profile_creation",
      v: 1,
      requestId: accepted.request.id,
      organizationId: fixture.organizationId,
    });
    const message: Message<unknown> = {
      id: "delivery-1",
      attempts: 1,
      timestamp: new Date(),
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await handleCoreQueueBatch({
      env: bindings,
      ctx: createExecutionContext(),
      batch: {
        queue: "openmeld-daemon-dispatch",
        messages: [message],
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
    });
    expect(
      await handleAgentProfileCreationMessage({ env: bindings, message })
    ).toBe(true);
    expect(createAgentProfileInOrganization).toHaveBeenCalledOnce();
    expect(message.ack).toHaveBeenCalledTimes(2);
    expect(message.retry).not.toHaveBeenCalled();
    const replay = await submitRequest(bindings, command);
    expect(replay).toMatchObject({
      replayed: true,
      request: {
        id: accepted.request.id,
        status: "completed",
        createdAgentProfileId: "agt_durable_creation",
      },
    });
  });
  it("rechecks Organization membership after accepting a request and before creating identity", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn() },
    } as unknown as CoreBindings;
    const accepted = await submitRequest(bindings, {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `revoked-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Revoked Agent",
      sessionStrategy: "new",
      source: "cli",
      targetOwnerUserId: fixture.requesterUserId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationId, fixture.requesterUserId],
    });
    expect(
      await executeAgentProfileCreationRequest(bindings, accepted.request)
    ).toMatchObject({ status: "failed", createdAgentProfileId: null });
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
  });
  it("retries setup for the committed Profile without creating another identity", async () => {
    const fixture = await seedFixture();
    const createdAgentProfileId = "agt_33333333-3333-4333-8333-333333333333";
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: { openMeldProfileId: createdAgentProfileId },
    });
    const addProfileToSpace = vi
      .spyOn(rpcMethods, "rpcAddOrganizationDirectoryProfilesToSpace")
      .mockRejectedValueOnce(new Error("The Space is temporarily unavailable."))
      .mockResolvedValueOnce({
        addedMemberIds: [createdAgentProfileId],
        alreadyMemberIds: [],
        items: [],
      });
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as unknown as CoreBindings;
    try {
      const first = await rpcCreateAgentProfileCreationRequest(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `setup-retry-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        requestedSpaceId: `space-${fixture.suffix}`,
        sessionStrategy: "new",
        source: "cli",
        targetOwnerUserId: fixture.requesterUserId,
      });
      expect(first.request).toMatchObject({
        createdAgentProfileId,
        status: "failed",
        statusReason: "profile_created",
      });
      const retried = await rpcRetryAgentProfileCreationRequest(bindings, {
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        organizationId: fixture.organizationId,
        requestId: first.request.id,
      });
      expect(retried.request).toMatchObject({
        createdAgentProfileId,
        status: "completed",
        statusReason: "profile_created",
      });
      expect(createAgentProfileInOrganization).toHaveBeenCalledTimes(1);
      expect(addProfileToSpace).toHaveBeenCalledTimes(2);
    } finally {
      addProfileToSpace.mockRestore();
    }
  });
  it.each([
    "gpt-5.6-sol",
    "gpt-6",
  ])("persists a fenced model correction for stored model %s while retaining committed identity and setup intent", async (storedModelId) => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn();
    const send = vi.fn();
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as unknown as CoreBindings;
    const accepted = await submitRequest(bindings, {
      configuration: {
        ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
        agentControllerRef: "builtin:codex",
        defaultProjectId: `project-${fixture.suffix}`,
        modelId: "gpt-5.6-sol",
        reasoningLevel: "high",
        targetComputerId: "device-model-guard",
      },
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      idempotencyKey: `correct-model-${fixture.suffix}`,
      organizationId: fixture.organizationId,
      profileName: "Model Guard Reviewer",
      requestedSpaceId: `space-${fixture.suffix}`,
      sessionStrategy: "new",
      source: "web",
      targetOwnerUserId: fixture.requesterUserId,
    });
    const repository = createPostgresAgentProfileCreationRequestRepository(
      getPostgresDatabase(env)
    );
    // Older requests could store the unsupported generic model ID. Admission
    // uses a valid current model; only this isolated historical fixture stores
    // the old selection through the request repository.
    const storedConfiguration = {
      ...accepted.request.configuration,
      modelId: storedModelId,
    };
    const updatedAtMs = Date.parse(accepted.request.updatedAt) + 1;
    const createdAgentProfileId = `agt_${crypto.randomUUID()}`;
    const failed = await repository.transition({
      expectedStatuses: ["approved"],
      expectedUpdatedAtMs: Date.parse(accepted.request.updatedAt),
      requestId: accepted.request.id,
      update: {
        configuration: storedConfiguration,
        createdAgentProfileId,
        failureMessage: "Binding setup did not complete.",
        status: "failed",
        statusReason: "profile_created",
        updatedAtMs,
      },
    });
    expect(failed).not.toBeNull();
    const correction = {
      context: contextFor(fixture.requesterUserId, fixture.requesterProfileId),
      expectedUpdatedAt: new Date(updatedAtMs).toISOString(),
      modelSelection: { modelId: "gpt-6-astra", reasoningLevel: "high" },
      organizationId: fixture.organizationId,
      requestId: accepted.request.id,
    };
    const bindingRecord = {
      agentProfileId: createdAgentProfileId,
      bindingId: `binding-${fixture.suffix}`,
      agentControllerRef: "builtin:codex",
      createdAtMs: updatedAtMs,
      owner: { id: fixture.requesterUserId, kind: "owner_account" as const },
      modelId: storedModelId,
      reasoningLevel: "high",
      openMeldServiceRuntimeId: `runtime-${fixture.suffix}`,
      updatedAtMs,
    };
    await getPostgresDatabase(env).query({
      text: `INSERT INTO openmeld.openmeld_profiles
        (profile_id,profile_name,profile_handle,profile_kind,is_default,status,organization_id,owner_user_id,source)
        VALUES ($1,'Model Guard Reviewer',$2,'agent',0,'active',$3,$4,'web_create')`,
      values: [
        createdAgentProfileId,
        `model-reviewer-${fixture.suffix}`,
        fixture.organizationId,
        fixture.requesterUserId,
      ],
    });
    await ensurePrimaryAgentProfileBindingRecord({
      db: getPostgresDatabase(env),
      record: bindingRecord,
    });
    await expect(retryRequest(bindings, correction)).rejects.toMatchObject({
      code: "agent_profile_creation_request.state_conflict",
      status: 409,
    });
    expect(
      await repository.getById({
        organizationId: fixture.organizationId,
        requestId: accepted.request.id,
      })
    ).toMatchObject({
      status: "failed",
      configuration: storedConfiguration,
    });
    // Existing Binding settings change through their owner before request
    // recovery; the request must never replace that later choice itself.
    await ensurePrimaryAgentProfileBindingRecord({
      db: getPostgresDatabase(env),
      record: bindingRecord,
      modelSelectionPatch: correction.modelSelection,
    });
    const corrected = await retryRequest(bindings, correction);
    expect(corrected.request).toMatchObject({
      id: accepted.request.id,
      createdAgentProfileId,
      configuration: {
        ...storedConfiguration,
        ...correction.modelSelection,
      },
      requestedSpaceId: accepted.request.requestedSpaceId,
      sessionStrategy: "new",
      status: "approved",
    });
    expect(
      await repository.getById({
        organizationId: fixture.organizationId,
        requestId: accepted.request.id,
      })
    ).toMatchObject({
      createdAgentProfileId,
      configuration: corrected.request.configuration,
      status: "approved",
    });
    await expect(retryRequest(bindings, correction)).rejects.toMatchObject({
      code: "agent_profile_creation_request.state_conflict",
      status: 409,
    });
    expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("does not create an Agent Profile when the selected local agent is no longer available", async () => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganizationMock = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    });
    const listLocalRuntimes = vi
      .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
      .mockResolvedValue({
        currentConnectedComputerId: null,
        currentDeviceId: null,
        currentRuntimeLane: null,
        legacyDeviceEvidence: [],
        localRuntimes: [],
      });
    const bindings = {
      OPENMELD_AUTH_WORKER: {
        createAgentProfileInOrganization: createAgentProfileInOrganizationMock,
      },
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as unknown as CoreBindings;
    try {
      const result = await rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: null,
          modelId: null,
          openCodePermission: null,
          reasoningLevel: null,
          targetComputerId: "device-that-disconnected",
        },
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `stale-local-agent-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        sessionStrategy: "new",
        source: "web",
        targetOwnerUserId: fixture.requesterUserId,
      });
      expect(result.request).toMatchObject({
        createdAgentProfileId: null,
        failureMessage:
          "The selected local agent is no longer available on that Computer.",
        status: "failed",
      });
      expect(createAgentProfileInOrganizationMock).not.toHaveBeenCalled();
      expect(listLocalRuntimes).toHaveBeenCalled();
    } finally {
      listLocalRuntimes.mockRestore();
    }
  });
  it.each([
    {
      modelId: "gpt-6",
      reasoningLevel: "high",
      code: "agent_profile_binding.model_not_supported",
    },
    {
      modelId: "gpt-6-astra",
      reasoningLevel: "invalid-effort",
      code: "agent_profile_binding.reasoning_level_not_supported",
    },
  ])("rejects invalid catalog selection before persisting a request: $modelId/$reasoningLevel", async ({
    modelId,
    reasoningLevel,
    code,
  }) => {
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn();
    const listLocalRuntimes = vi.spyOn(
      currentDeviceTargetService,
      "listLocalRuntimesUseCase"
    );
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as unknown as CoreBindings;
    try {
      await expect(
        submitRequest(bindings, {
          configuration: {
            ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
            agentControllerRef: "builtin:codex",
            modelId,
            reasoningLevel,
            targetComputerId: "device-model-guard",
          },
          context: contextFor(
            fixture.requesterUserId,
            fixture.requesterProfileId
          ),
          idempotencyKey: `invalid-model-${fixture.suffix}`,
          organizationId: fixture.organizationId,
          profileName: "Model Guard Reviewer",
          sessionStrategy: "new",
          source: "web",
          targetOwnerUserId: fixture.requesterUserId,
        })
      ).rejects.toMatchObject({ code, status: 400 });
      expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
      expect(listLocalRuntimes).not.toHaveBeenCalled();
      expect(
        await rpcListAgentProfileCreationRequests(bindings, {
          context: contextFor(
            fixture.requesterUserId,
            fixture.requesterProfileId
          ),
          organizationId: fixture.organizationId,
        })
      ).toMatchObject({ requests: [] });
    } finally {
      listLocalRuntimes.mockRestore();
    }
  });
  it("persists a retryable failure when the device does not offer a valid catalog model", async () => {
    const modelId = "gpt-5.6-sol";
    const reasoningLevel = "high";
    const fixture = await seedFixture();
    const createAgentProfileInOrganization = vi.fn().mockResolvedValue({
      ok: true,
      profile: {
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      },
    });
    const listLocalRuntimes = vi
      .spyOn(currentDeviceTargetService, "listLocalRuntimesUseCase")
      .mockResolvedValue(createModelGuardLocalRuntimes());
    // Model validation requires a live, compatible target, not merely a saved
    // ready report. This transport fixture follows the shared wire contract.
    const ownerService: RuntimeTransportLookupOwnerServiceResponse = {
      online: true,
      sessions: [
        {
          daemonSessionId: "model-guard-session",
          capabilities: {},
          deviceId: "device-model-guard",
          lane: "dev-local",
          connectionGeneration: 1,
          lastHeartbeatMs: Date.now(),
          serviceVersion: "999.0.0",
          executionCompatibility: {
            status: "compatible",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
          },
        },
      ],
    };
    const bindings = {
      OPENMELD_AUTH_WORKER: { createAgentProfileInOrganization },
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
      OPENMELD_RUNTIME_TRANSPORT: {
        idFromName: (name: string) => {
          expect(name).toBe(fixture.requesterUserId);
          return name;
        },
        get: () => ({
          fetch: (url: string) => {
            expect(new URL(url).pathname).toBe("/lookup-owner-service");
            return Promise.resolve(Response.json(ownerService));
          },
        }),
      },
    } as unknown as CoreBindings;
    try {
      const result = await rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: null,
          modelId,
          openCodePermission: null,
          reasoningLevel,
          targetComputerId: "device-model-guard",
        },
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: `model-guard-${fixture.suffix}`,
        organizationId: fixture.organizationId,
        profileName: "Model Guard Reviewer",
        sessionStrategy: "new",
        source: "web",
        targetOwnerUserId: fixture.requesterUserId,
      });
      expect(result.request).toMatchObject({
        createdAgentProfileId: null,
        failureMessage:
          "The selected model isn't offered by this local agent. Choose another model or update the local agent, then retry setup. Reason: agent_profile_creation_request.model_not_offered.",
        status: "failed",
      });
      expect(createAgentProfileInOrganization).not.toHaveBeenCalled();
      expect(listLocalRuntimes).toHaveBeenCalled();
    } finally {
      listLocalRuntimes.mockRestore();
    }
  });
  it("rejects teammate creation through both public and represented-member entry points", async () => {
    const fixture = await seedFixture();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as CoreBindings;
    const intent = {
      profileName: "Held Agent",
      sessionStrategy: "new" as const,
      targetOwnerUserId: fixture.targetUserId,
    };
    await expect(
      submitRequest(bindings, {
        ...intent,
        context: contextFor(
          fixture.requesterUserId,
          fixture.requesterProfileId
        ),
        idempotencyKey: fixture.suffix,
        organizationId: fixture.organizationId,
        source: "cli",
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "agent_profile_creation_request.forbidden",
    });
    await expect(
      submitCenterAgentRequest(bindings, {
        ...intent,
        context: {
          activeOrganizationId: fixture.organizationId,
          actorContext: {
            callerPrincipalId: fixture.centerAgentProfileId,
            openMeldProfileId: fixture.centerAgentProfileId,
            profileKind: "agent",
            profileName: "Center Agent",
            requestId: fixture.suffix,
          },
        },
        onBehalfOf: { profileId: fixture.requesterProfileId },
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "agent_profile_creation_request.forbidden",
    });
    const rows = await getPostgresDatabase(env)
      .query<{
        count: number;
      }>({
        ...{
          text: 'SELECT count(*) AS count FROM "openmeld"."agent_profile_creation_requests" WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(rows?.count).toBe(0);
    // The same Center Agent attribution may still create for its represented
    // member. The launch hold must not confuse Agent identity with ownership.
    const own = await submitCenterAgentRequest(bindings, {
      ...intent,
      configuration: centerCreationCommand(fixture).configuration,
      targetOwnerUserId: fixture.requesterUserId,
      context: {
        activeOrganizationId: fixture.organizationId,
        actorContext: {
          callerPrincipalId: fixture.centerAgentProfileId,
          openMeldProfileId: fixture.centerAgentProfileId,
          profileKind: "agent",
          profileName: "Center Agent",
          requestId: `own-${fixture.suffix}`,
        },
      },
      onBehalfOf: { profileId: fixture.requesterProfileId },
    });
    expect(own.request).toMatchObject({
      requesterUserId: fixture.requesterUserId,
      targetOwnerUserId: fixture.requesterUserId,
      status: "approved",
    });
  });
  it("accepts a Resume request for a current matching Session", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as CoreBindings;
    const created = await submitRequest(bindings, {
      configuration: {
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: session.projectId,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        targetComputerId: session.computerId,
      },
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
      idempotencyKey: `resume-${fixture.suffix}`,
      nativeSessionId: session.nativeSessionId,
      organizationId: fixture.organizationId,
      profileName: "Release Reviewer",
      sessionStrategy: "resume",
      source: "web",
      targetOwnerUserId: fixture.targetUserId,
    });
    expect(created.request).toMatchObject({
      configuration: {
        agentControllerRef: "builtin:codex",
        defaultProjectId: session.projectId,
        targetComputerId: session.computerId,
      },
      nativeSessionId: session.nativeSessionId,
      sessionStrategy: "resume",
      status: "approved",
      targetOwnerUserId: fixture.targetUserId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."agent_activity_session_inventory" WHERE id = $1',
        values: [],
      },
      values: [`inventory-${fixture.suffix}`],
    });
    const replayed = await submitRequest(bindings, {
      ...created.request,
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
      idempotencyKey: `resume-${fixture.suffix}`,
    });
    expect(replayed).toMatchObject({
      replayed: true,
      request: { id: created.request.id },
    });
  });
  it("accepts a Fork request addressed to the Session's public Computer", async () => {
    const fixture = await seedFixture();
    const session = await seedResumeSession(fixture);
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as CoreBindings;
    const created = await submitRequest(bindings, {
      configuration: {
        agentControllerCollaborationMode: null,
        agentControllerPermissionMode: null,
        agentControllerRef: "builtin:codex",
        authorizeForOrganization: true,
        defaultProjectId: session.projectId,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        targetComputerId: session.computerId,
      },
      context: contextFor(fixture.targetUserId, fixture.targetProfileId),
      idempotencyKey: `fork-${fixture.suffix}`,
      nativeSessionId: session.nativeSessionId,
      organizationId: fixture.organizationId,
      profileName: "Release Fork",
      sessionStrategy: "fork",
      source: "web",
      targetOwnerUserId: fixture.targetUserId,
    });
    expect(created.request).toMatchObject({
      configuration: {
        agentControllerRef: "builtin:codex",
        targetComputerId: session.computerId,
      },
      nativeSessionId: session.nativeSessionId,
      sessionStrategy: "fork",
      status: "approved",
    });
  });
  it("rejects Resume when the selected Session is not current and matching", async () => {
    const fixture = await seedFixture();
    const bindings = {
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_CLI_RELEASES: env.OPENMELD_CLI_RELEASES,
    } as CoreBindings;
    await expect(
      rpcCreateAgentProfileCreationRequest(bindings, {
        configuration: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:codex",
          authorizeForOrganization: true,
          defaultProjectId: `project-${fixture.suffix}`,
          modelId: null,
          openCodePermission: null,
          reasoningLevel: null,
          targetComputerId: `computer-${fixture.suffix}`,
        },
        context: contextFor(fixture.targetUserId, fixture.targetProfileId),
        idempotencyKey: `resume-missing-${fixture.suffix}`,
        nativeSessionId: "native-codex-session-id",
        organizationId: fixture.organizationId,
        profileName: "Release Reviewer",
        sessionStrategy: "resume",
        source: "web",
        targetOwnerUserId: fixture.targetUserId,
      })
    ).rejects.toMatchObject({
      code: "agent_profile_creation_request.session_strategy_unavailable",
      status: 409,
    });
  });
});
function createModelGuardLocalRuntimes(): Awaited<
  ReturnType<typeof currentDeviceTargetService.listLocalRuntimesUseCase>
> {
  return {
    currentConnectedComputerId: null,
    currentDeviceId: "device-model-guard",
    currentRuntimeLane: "dev-local",
    legacyDeviceEvidence: [],
    localRuntimes: [
      {
        deviceDisplayName: "Model Guard Mac",
        deviceDisplayNameSource: "observed",
        deviceId: "device-model-guard",
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
                  checkedAt: "2026-08-27T00:00:00.000Z",
                  controllerId: "codex",
                  displayName: "Codex",
                  launch: {
                    argsPrefix: [],
                    commandPath: "/Applications/Codex.app/Contents/MacOS/Codex",
                    installChoiceCount: 1,
                    status: "ready",
                  },
                  message: null,
                  models: [{ displayName: "GPT-5.6 Luna", id: "gpt-5.6-luna" }],
                  nativeInterface: "codex-app-server",
                  schemaVersion: 1,
                  skills: [],
                  status: "ready",
                  version: "999.0.0",
                },
                agentControllerRef: "builtin:codex",
                enabled: true,
                reasonCodes: [],
                status: "ready",
              },
            ],
            deviceId: "device-model-guard",
            isCurrent: true,
            lastObservedAtMs: 1_788_000_000_000,
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
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime-model-guard",
            },
            reasonCodes: [],
            runtimeLane: "dev-local",
            status: "ready",
            userFacingCommand: "openmeld-dev",
          },
        ],
        firstSeenAtMs: 1_787_999_900_000,
        isCurrent: true,
        lastObservedAtMs: 1_788_000_000_000,
        osVersion: "15.6",
        platformFamily: "macOS",
      },
    ],
  };
}
function centerCreationCommand(
  fixture: Awaited<ReturnType<typeof seedFixture>>
) {
  return {
    configuration: {
      ...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
      agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
    },
    context: {
      activeOrganizationId: fixture.organizationId,
      actorContext: {
        callerPrincipalId: fixture.centerAgentProfileId,
        openMeldProfileId: fixture.centerAgentProfileId,
        profileKind: "agent" as const,
        profileName: "Center Agent",
        requestId: fixture.suffix,
      },
    },
    onBehalfOf: { profileId: fixture.requesterProfileId },
    profileName: "Research Partner",
    sessionStrategy: "new" as const,
    targetOwnerUserId: fixture.requesterUserId,
  };
}
function contextFor(userId: string, profileId: string) {
  return {
    activeOrganizationId: "ignored-by-explicit-route-scope",
    actorContext: {
      callerPrincipalId: userId,
      openMeldProfileId: profileId,
      ownerUserId: userId,
      profileKind: "human" as const,
      profileName: userId,
      requestId: crypto.randomUUID(),
    },
  };
}
async function seedFixture() {
  const suffix = crypto.randomUUID();
  const organizationId = `org-apcr-rpc-${suffix}`;
  const requesterUserId = `user-requester-${suffix}`;
  const targetUserId = `user-target-${suffix}`;
  const requesterProfileId = crypto.randomUUID();
  const targetProfileId = crypto.randomUUID();
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  const nowMs = 1_787_220_000_000;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
            values: [],
          },
          values: [
            organizationId,
            "Creation Request RPC Test",
            organizationId,
            nowMs,
          ],
        },
        ...[requesterUserId, targetUserId].map((userId) => ({
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, 1, $4, $5)',
            values: [],
          },
          values: [userId, userId, `${userId}@openmeld.invalid`, nowMs, nowMs],
        })),
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
            values: [],
          },
          values: [
            `member-requester-${suffix}`,
            organizationId,
            requesterUserId,
            nowMs,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
            values: [],
          },
          values: [
            `member-target-${suffix}`,
            organizationId,
            targetUserId,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES ($1, 'Requester', $2, 'human', 1, 'active', NULL, $3, $4,
          'auth_bootstrap', NULL, $5, $6)
      `,
            values: [],
          },
          values: [
            requesterProfileId,
            `requester-${suffix}`,
            requesterUserId,
            requesterUserId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4,
          'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            centerAgentProfileId,
            `center-agent-${suffix}`,
            organizationId,
            requesterUserId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, $3, $4)',
            values: [],
          },
          values: [
            organizationId,
            centerAgentProfileId,
            requesterUserId,
            nowMs,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    centerAgentProfileId,
    organizationId,
    requesterProfileId,
    requesterUserId,
    suffix,
    targetProfileId,
    targetUserId,
  };
}
async function seedResumeSession(
  fixture: Awaited<ReturnType<typeof seedFixture>>
) {
  const nowMs = Date.now();
  const projectId = `project-${fixture.suffix}`;
  const deviceId = `device-${fixture.suffix}`;
  const computerId = `computer-${fixture.suffix}`;
  const nativeSessionId = `native-session-${fixture.suffix}`;
  const sourceScopeKey = `source-${fixture.suffix}`;
  const localConnectionId = `sha256:${"a".repeat(64)}`;
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `INSERT INTO "openmeld"."projects" (
        id, organization_id, name, slug, created_by_user_id,
        created_at_ms, updated_at_ms
      ) VALUES ($1, $2, 'OpenMeld', $3, $4, $5, $6)`,
            values: [],
          },
          values: [
            projectId,
            fixture.organizationId,
            `openmeld-${fixture.suffix}`,
            fixture.targetUserId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `INSERT INTO "openmeld"."openMeldDaemon_owned_devices" (
        owner_user_id, device_id, connected_computer_id, user_display_name,
        first_seen_at_ms, last_observed_at_ms, updated_at_ms
      ) VALUES ($1, $2, $3, 'Target Mac', $4, $5, $6)`,
            values: [],
          },
          values: [
            fixture.targetUserId,
            deviceId,
            computerId,
            nowMs,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `INSERT INTO "openmeld"."agent_activity_session_inventory_sources" (
        source_scope_key, organization_id, owner_user_id, project_id,
        device_id, connected_computer_id, local_connection_id,
        agent_controller_ref, provider, state, current_reconciliation_id,
        next_page_index, problem_code, last_attempt_at_ms,
        last_complete_at_ms, updated_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'builtin:codex', 'codex', 'current',
        $8, 1, NULL, $9, $10, $11)`,
            values: [],
          },
          values: [
            sourceScopeKey,
            fixture.organizationId,
            fixture.targetUserId,
            projectId,
            deviceId,
            computerId,
            localConnectionId,
            `reconciliation-${fixture.suffix}`,
            nowMs,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `INSERT INTO "openmeld"."agent_activity_session_inventory" (
        id, organization_id, owner_user_id, agent_controller_ref,
        native_session_id, project_id, device_id, connected_computer_id,
        local_connection_id, source_scope_key, provider, native_session_title,
        status, last_active_at_ms, started_at_ms, origin, can_resume, can_fork,
        visible, source_reconciliation_id, observed_at_ms, published_at_ms,
        updated_at_ms
      ) VALUES ($1, $2, $3, 'builtin:codex', $4, $5, $6, $7, $8, $9, 'codex',
        'Existing release work', 'idle', $10, $11, 'local', 1, 1, 1, $12, $13, $14, $15)`,
            values: [],
          },
          values: [
            `inventory-${fixture.suffix}`,
            fixture.organizationId,
            fixture.targetUserId,
            nativeSessionId,
            projectId,
            deviceId,
            computerId,
            localConnectionId,
            sourceScopeKey,
            nowMs,
            nowMs - 60_000,
            `reconciliation-${fixture.suffix}`,
            nowMs,
            nowMs,
            nowMs,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return { computerId, deviceId, nativeSessionId, projectId };
}
