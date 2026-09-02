import { env, runInDurableObject, SELF } from "cloudflare:test";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
  buildRuntimeCoordinatorExecutionId,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportBaseCapabilitiesSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import releaseManifestJson from "../../../release/local-components.json";
import type { CoreBindings } from "../src/lib/bindings";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/d1/runtime-registry-repo";
import type { RuntimeTransportHub } from "../src/runtime-transport/transport/do/runtime-transport-hub";
import { CORE_LOG_EVENTS } from "../src/shared/observability/log-events";
import { quiesceRuntimeTransportShard } from "./runtime-transport-test-support";
import {
  waitForJsonMessage,
  waitForRawMessage,
} from "./test-support/ws-stream";

const BASE_URL = "http://localhost";
const DAEMON_TEST_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "req-runtime-transport-reconcile";
const SERVER_ROUTE_RECONCILIATION_REASON = "server_route_reconciliation";
const CURRENT_RELEASE_SERVICE_VERSION =
  releaseManifestJson.components.service.bundleVersion;

const touchedOwnerUserIds = new Set<string>();

afterEach(async () => {
  for (const ownerUserId of touchedOwnerUserIds) {
    await quiesceRuntimeTransportShard(getRuntimeTransportShard(ownerUserId));
  }
  touchedOwnerUserIds.clear();
});

async function fetchWithOpenMeldAuth(input: {
  path: string;
  ownerUserId: string;
  init?: RequestInit;
}): Promise<Response> {
  const headers = new Headers(input.init?.headers);
  headers.set("x-openmeld-request-id", REQUEST_ID);
  headers.set("x-openmeld-forwarded-by", "openmeld-gateway");
  headers.set("x-openmeld-profile-id", DAEMON_TEST_PROFILE_ID);
  headers.set("x-openmeld-profile-kind", "human");
  headers.set("x-openmeld-profile", DAEMON_TEST_PROFILE_ID);
  headers.set("x-openmeld-owner-user-id", input.ownerUserId);

  return await SELF.fetch(`${BASE_URL}${input.path}`, {
    ...(input.init ?? {}),
    headers,
  });
}

async function openDaemonStream(
  ownerUserId: string,
  options?: { computerFileAccess?: boolean; localFolderPicker?: boolean }
): Promise<WebSocket> {
  touchedOwnerUserIds.add(ownerUserId);
  const response = await fetchWithOpenMeldAuth({
    path: "/v1/daemon/stream",
    ownerUserId,
    init: {
      headers: {
        Upgrade: "websocket",
        ...(options?.computerFileAccess
          ? {
              "x-openmeld-runtime-capabilities": "computer-file-access-v1",
            }
          : {}),
        ...(options?.localFolderPicker
          ? {
              [OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER]:
                LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
            }
          : {}),
      },
    },
  });

  if (response.status !== 101) {
    throw new Error(
      `Failed to open daemon stream, expected status 101 but got ${String(response.status)}`
    );
  }
  if (!response.webSocket) {
    throw new Error("Missing WebSocket on daemon stream response");
  }

  response.webSocket.accept();
  return response.webSocket;
}

async function registerSession(input: {
  capabilities?: Record<string, unknown>;
  daemonSessionId: string;
  deviceId: string;
  lane?: string;
  localWakeRouteReport?: {
    includedProfileIds: string[];
    skippedProfiles: Array<{
      profileId: string;
      profileName: string | null;
      skipReason: "controller.launch.needs_repair";
    }>;
  };
  ownerUserId: string;
  profileIds: string[];
  serviceVersion?: string;
  socket: WebSocket;
}): Promise<{
  acceptedLeases: Array<{ leaseEpoch: number; profileId: string }>;
  connectionGeneration: number | undefined;
  rejectedProfiles: Array<{ profileId: string; reasonCode: string }>;
}> {
  input.socket.send(
    JSON.stringify({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.session.register",
      payload: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        deviceId: input.deviceId,
        lane: input.lane ?? "dev-local",
        daemonSessionId: input.daemonSessionId,
        connectionGeneration: 1,
        profileIds: input.profileIds,
        capabilities: input.capabilities ?? {},
        ...(input.serviceVersion
          ? { serviceVersion: input.serviceVersion }
          : {}),
        runtimeContract: {
          epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        },
        ...(input.localWakeRouteReport
          ? {
              localWakeRouteReport: {
                reportedAtMs: Date.now(),
                daemonSessionId: input.daemonSessionId,
                deviceId: input.deviceId,
                lane: input.lane ?? "dev-local",
                serviceVersion: "0.7.91",
                ...input.localWakeRouteReport,
              },
            }
          : {}),
        connectedAtMs: Date.now(),
      },
    })
  );

  const frame = await waitForJsonMessage(
    input.socket,
    (value) =>
      value.code === "daemon.session.register" || value.code === "daemon.error",
    5000
  );
  if (frame.code === "daemon.error") {
    throw new Error(`Daemon registration failed: ${JSON.stringify(frame)}`);
  }
  const payload = frame.payload as {
    acceptedLeases?: Array<{ leaseEpoch: number; profileId: string }>;
    connectionGeneration?: number;
    rejectedProfiles?: Array<{ profileId: string; reasonCode: string }>;
  };

  return {
    acceptedLeases: payload.acceptedLeases ?? [],
    connectionGeneration: payload.connectionGeneration,
    rejectedProfiles: payload.rejectedProfiles ?? [],
  };
}

async function sendHeartbeat(input: {
  capabilities?: Record<string, unknown>;
  daemonSessionId: string;
  deviceId: string;
  lane?: string;
  ownerUserId: string;
  leases: Array<{ leaseEpoch: number; profileId: string }>;
  serviceVersion?: string;
  socket: WebSocket;
}): Promise<{
  ok: boolean;
  staleLeases: Array<{ leaseEpoch: number; profileId: string }>;
}> {
  input.socket.send(
    JSON.stringify({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.session.heartbeat",
      payload: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        deviceId: input.deviceId,
        lane: input.lane ?? "dev-local",
        daemonSessionId: input.daemonSessionId,
        serviceVersion: input.serviceVersion ?? "0.7.91",
        ...(input.capabilities ? { capabilities: input.capabilities } : {}),
        leases: input.leases,
        runtimeContract: {
          epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        },
        sentAtMs: Date.now(),
      },
    })
  );

  const frame = await waitForJsonMessage(
    input.socket,
    (value) => value.code === "daemon.session.heartbeat",
    5000
  );
  const payload = frame.payload as {
    ok?: boolean;
    staleLeases?: Array<{ leaseEpoch: number; profileId: string }>;
  };

  return {
    ok: payload.ok === true,
    staleLeases: payload.staleLeases ?? [],
  };
}

async function seedExpectedRoute(input: {
  ownerUserId: string;
  deviceId: string;
  lane?: string;
  profileId: string;
  runtimeId: string;
}): Promise<void> {
  const lane = input.lane ?? "dev-local";
  const runtimeLookupInput = createRuntimeLookupInput({
    owner: { kind: "owner_account", id: input.ownerUserId },
    deviceId: input.deviceId,
    lane,
  });
  await registerRuntimeRegistryRecord({
    db: env.OPENMELD_DB,
    record: {
      nowMs: Date.now(),
      runtimeLookupInput,
      openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
        openMeldServiceRuntimeId: input.runtimeId,
        lookupInput: runtimeLookupInput,
        source: "runtime_registry_authority",
      }),
    },
  });
  const nowMs = Date.now();
  const organizationId = `org-route-reconciliation-${input.ownerUserId}`;
  await env.OPENMELD_DB.prepare(
    `
      INSERT OR IGNORE INTO users (
        id, name, email, email_verified, created_at, updated_at
      )
      VALUES (?, 'Route reconciliation owner', ?, 1, ?, ?)
    `
  )
    .bind(
      input.ownerUserId,
      `${input.ownerUserId}@route-reconciliation.test`,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES (?, 'Route reconciliation organization', ?, ?)
    `
  )
    .bind(organizationId, `route-reconciliation-${input.ownerUserId}`, nowMs)
    .run();
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
        source,
        created_at,
        updated_at
      )
      VALUES (?, 'Route reconciliation agent', ?, 'agent', 0, 'active', ?, ?, ?, 'cli_create', ?, ?)
    `
  )
    .bind(
      input.profileId,
      `route-reconciliation-${input.profileId}`,
      organizationId,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms,
        disabled_at_ms,
        created_by_profile_id,
        reason_code,
        agent_controller_permission_mode,
        model_id,
        reasoning_level
      )
      VALUES (?, 'owner_account', ?, ?, ?, 'builtin:codex', NULL, 'enabled_primary', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
    `
  )
    .bind(
      `binding-${input.profileId}`,
      input.ownerUserId,
      input.profileId,
      input.runtimeId,
      nowMs,
      nowMs
    )
    .run();
}

async function installAuthProfileResolver(input: {
  onResolveProfile?: (profileId: string) => void;
  ownerUserId: string;
  profileIds: readonly string[];
  shard: DurableObjectStub<RuntimeTransportHub>;
}): Promise<void> {
  const profileIds = new Set(input.profileIds);
  await runInDurableObject(input.shard, (instance) => {
    const internal = instance as unknown as { env: CoreBindings };
    internal.env.OPENMELD_AUTH_WORKER = {
      resolveProfileById: ({ openMeldProfileId }) => {
        const profileId = String(openMeldProfileId ?? "");
        input.onResolveProfile?.(profileId);
        if (!profileIds.has(profileId)) {
          return Promise.resolve({
            ok: false as const,
            code: "profile.not_found",
            message: "profile not found",
          });
        }
        return Promise.resolve({
          ok: true as const,
          profile: {
            ownerUserId: input.ownerUserId,
            profileHandle: profileId,
            profileId,
            profileKind: "agent" as const,
            profileName: `Agent ${profileId}`,
            status: "active" as const,
          },
        });
      },
    };
  });
}

async function expireRouteCatalogReconciliationThrottle(input: {
  shard: DurableObjectStub<RuntimeTransportHub>;
}): Promise<void> {
  await runInDurableObject(input.shard, (instance) => {
    const internal = instance as unknown as {
      routeCatalogReconciliationSignalsBySessionKey: Map<
        string,
        { notifiedAtMs: number }
      >;
    };
    for (const signal of internal.routeCatalogReconciliationSignalsBySessionKey.values()) {
      signal.notifiedAtMs = 0;
    }
  });
}

async function expectNoRouteCatalogChangedFrame(
  socket: WebSocket
): Promise<void> {
  try {
    const frame = await waitForJsonMessage(
      socket,
      (value) => value.code === "daemon.route_catalog.changed",
      300
    );
    throw new Error(
      `Expected no daemon.route_catalog.changed frame, but received ${JSON.stringify(frame)}`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Timed out waiting for WebSocket message")
    ) {
      return;
    }
    throw error;
  }
}

async function expectNoOpenMeldToolsControlRequestFrame(
  socket: WebSocket
): Promise<void> {
  try {
    const frame = await waitForJsonMessage(
      socket,
      (value) => value.code === "daemon.openmeld_tools_control.request",
      300
    );
    throw new Error(
      `Expected no daemon.openmeld_tools_control.request frame, but received ${JSON.stringify(frame)}`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Timed out waiting for WebSocket message")
    ) {
      return;
    }
    throw error;
  }
}

async function waitForAutomaticUpdateTarget(input: {
  computerKey: string;
  expectedTarget: string | null;
  shard: DurableObjectStub<RuntimeTransportHub>;
}): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const target = await runInDurableObject(input.shard, (instance) => {
      const internal = instance as unknown as {
        automaticToolsUpdateTargetByComputer: Map<string, string>;
      };
      return (
        internal.automaticToolsUpdateTargetByComputer.get(input.computerKey) ??
        null
      );
    });
    if (target === input.expectedTarget) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for automatic update target ${String(input.expectedTarget)}`
  );
}

async function lookupRoute(input: {
  ownerUserId: string;
  profileId: string;
}): Promise<{
  connectionGeneration?: number;
  online: boolean;
  reasonCode?: string;
  leaseEpoch?: number;
}> {
  const shard = getRuntimeTransportShard(input.ownerUserId);
  const response = await shard.fetch(
    "https://runtime-transport.internal/lookup-route",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        profileId: input.profileId,
      }),
    }
  );

  return (await response.json()) as {
    online: boolean;
    reasonCode?: string;
    leaseEpoch?: number;
  };
}

async function fetchRouteObservation(input: {
  ownerUserId: string;
  profileId: string;
}): Promise<{
  observedAt: string;
  profileId: string;
  route: {
    online: boolean;
    reasonCode?: string;
    daemonSessionId?: string;
    deviceId?: string;
    connectionGeneration?: number;
    leaseEpoch?: number;
    lastHeartbeatMs?: number;
  };
}> {
  const response = await fetchWithOpenMeldAuth({
    path: `/v1/daemon/routes/${encodeURIComponent(input.profileId)}`,
    ownerUserId: input.ownerUserId,
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected route observation status 200 but got ${String(response.status)}`
    );
  }

  return (await response.json()) as {
    observedAt: string;
    profileId: string;
    route: {
      online: boolean;
      reasonCode?: string;
      daemonSessionId?: string;
      deviceId?: string;
      connectionGeneration?: number;
      leaseEpoch?: number;
      lastHeartbeatMs?: number;
    };
  };
}

function getRuntimeTransportShard(
  ownerUserId: string
): DurableObjectStub<RuntimeTransportHub> {
  touchedOwnerUserIds.add(ownerUserId);
  const daemonEnv = env as unknown as {
    OPENMELD_RUNTIME_TRANSPORT: DurableObjectNamespace<RuntimeTransportHub>;
  };
  const namespace = daemonEnv.OPENMELD_RUNTIME_TRANSPORT;
  return namespace.get(namespace.idFromName(ownerUserId));
}

async function acceptRuntimeCoordinatorHead(input: {
  ownerUserId: string;
  dispatchId: string;
  spaceId: string;
  sourceEventId: string;
  targetProfileId: string;
}): Promise<void> {
  const shard = getRuntimeTransportShard(input.ownerUserId);
  const response = await shard.fetch(
    "https://runtime-transport.internal/runtime-coordinator/head/accept",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: input.ownerUserId,
        dispatchId: input.dispatchId,
        idempotencyKey: `head-${input.dispatchId}`,
        targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
          clientMessageId: null,
          dispatchId: input.dispatchId,
          sourceSignalId: input.sourceEventId,
          spaceId: input.spaceId,
          targetProfileId: input.targetProfileId,
        }),
      }),
    }
  );
  if (response.status !== 200) {
    throw new Error(
      `Expected head accept status 200 but got ${String(response.status)}`
    );
  }
}

async function deliverDispatch(input: {
  ownerUserId: string;
  dispatchId: string;
  attemptId: string;
  profileId: string;
  daemonSessionId: string;
  connectionGeneration: number;
  leaseEpoch: number;
  sourceMessageEnvelope?: {
    activationTargets: string[];
    referenceTargets: string[];
    text: string;
  };
}): Promise<{ accepted: boolean; reasonCode?: string }> {
  const spaceId = `space-${input.dispatchId}`;
  const sourceEventId = `evt-${input.dispatchId}`;
  await acceptRuntimeCoordinatorHead({
    ownerUserId: input.ownerUserId,
    dispatchId: input.dispatchId,
    spaceId,
    sourceEventId,
    targetProfileId: input.profileId,
  });

  const shard = getRuntimeTransportShard(input.ownerUserId);
  const response = await shard.fetch(
    "https://runtime-transport.internal/deliver-dispatch",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: input.dispatchId,
        attemptId: input.attemptId,
        ownerUserId: input.ownerUserId,
        profileId: input.profileId,
        daemonSessionId: input.daemonSessionId,
        connectionGeneration: input.connectionGeneration,
        leaseEpoch: input.leaseEpoch,
        payload: {
          runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId({
            dispatchId: input.dispatchId,
            spaceId,
            targetProfileId: input.profileId,
          }),
          executionIdentity: {
            authority: "core_runtime_registry_binding_route",
            core: {
              modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
              spaceId,
              dispatchId: input.dispatchId,
              targetProfileId: input.profileId,
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: `runtime-${input.ownerUserId}`,
              },
              bindingId: `binding-${input.profileId}`,
              agentControllerRef: "builtin:codex",
            },
          },
          attemptId: input.attemptId,
          dispatchId: input.dispatchId,
          taskId: `task-${input.dispatchId}`,
          spaceId,
          sourceEventId,
          sourceSignal: {
            profileId: DAEMON_TEST_PROFILE_ID,
            profileKind: "human",
            text: "hello from runtime transport lease reconcile test",
          },
          ...(input.sourceMessageEnvelope
            ? { sourceMessageEnvelope: input.sourceMessageEnvelope }
            : {}),
          targetProfileId: input.profileId,
          dispatchContractVersion: 2,
          dispatchPolicy: "mention_only",
          controllerSnapshot: {
            targetBindingState: "bound",
            targetBindingEnabled: true,
            agentControllerRef: "builtin:codex",
          },
          contextIdMappingSpec: null,
          dispatchRulesSnapshot: {
            dispatchPolicy: "mention_only",
            ruleSource: "registry",
            ruleId: "registry.default.all_members.v1",
            ruleReason: "default allow all members mention",
          },
          enqueuedAtMs: Date.now(),
          idempotencyKey: `idempotency-${input.dispatchId}`,
        },
      }),
    }
  );

  return (await response.json()) as {
    accepted: boolean;
    reasonCode?: string;
  };
}

type DeliveredDispatchPayload = {
  runtimeCoordinatorExecutionId: string;
  executionToken?: {
    executionToken: string;
    runId: string;
    tokenFingerprint: string;
    executionScope: { runtimeCoordinatorExecutionId: string };
  };
  executionIdentity: { core: Record<string, unknown> };
  taskId: string;
  sourceEventId: string;
  sourceMessageEnvelope?: {
    ccTargets?: string[];
  };
};

function buildSuccessTaskResultFrame(input: {
  dispatchId: string;
  attemptId: string;
  daemonSessionId: string;
  connectionGeneration: number;
  leaseEpoch: number;
  agentId: string;
  deliveredPayload: DeliveredDispatchPayload;
}) {
  const executionToken = input.deliveredPayload.executionToken;
  if (!executionToken) {
    throw new Error("Expected delivered dispatch to carry an execution token");
  }

  return {
    v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    code: "daemon.dispatch.result" as const,
    payload: {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId:
        input.deliveredPayload.runtimeCoordinatorExecutionId,
      executionTokenEcho: {
        executionToken: executionToken.executionToken,
        runId: executionToken.runId,
        runtimeCoordinatorExecutionId:
          executionToken.executionScope.runtimeCoordinatorExecutionId,
        tokenFingerprint: executionToken.tokenFingerprint,
      },
      executionIdentityEcho: {
        echoSource: "daemon_delivery_context" as const,
        core: input.deliveredPayload.executionIdentity.core,
      },
      dispatchId: input.dispatchId,
      attemptId: input.attemptId,
      daemonSessionId: input.daemonSessionId,
      connectionGeneration: input.connectionGeneration,
      leaseEpoch: input.leaseEpoch,
      taskResult: {
        v: OPENMELD_DAEMON_TASK_RESULT_SCHEMA_VERSION,
        code: "service.task_result" as const,
        payload: {
          status: "success" as const,
          attemptId: input.attemptId,
          taskId: input.deliveredPayload.taskId,
          sourceEventId: input.deliveredPayload.sourceEventId,
          agentId: input.agentId,
          deduped: false,
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: `ctx-${input.deliveredPayload.taskId}`,
          output: "ok",
        },
      },
    },
  };
}

describe("runtime transport lease reconciliation", () => {
  it("negotiates independent local capabilities without changing strict registration capabilities", async () => {
    const ownerUserId = "owner-computer-file-access-negotiation";
    const daemonSessionId = "daemon-session-computer-file-access-negotiation";
    const deviceId = "device-computer-file-access-negotiation";
    const shard = getRuntimeTransportShard(ownerUserId);
    const socket = await openDaemonStream(ownerUserId, {
      computerFileAccess: true,
      localFolderPicker: true,
    });

    try {
      await registerSession({
        daemonSessionId,
        deviceId,
        ownerUserId,
        profileIds: [],
        socket,
      });
      expect(
        await sendHeartbeat({
          daemonSessionId,
          deviceId,
          leases: [],
          ownerUserId,
          socket,
        })
      ).toMatchObject({ ok: true });

      await runInDurableObject(shard, (instance) => {
        const internal = instance as unknown as {
          state: {
            sessionsById: Map<
              string,
              { capabilities: Record<string, unknown> }
            >;
          };
        };
        expect(
          internal.state.sessionsById.get(daemonSessionId)?.capabilities
        ).toMatchObject({
          computerFileAccess: {
            readPolicy: true,
            updatePolicy: true,
          },
          localFolderPicker: {
            selectFolders: true,
          },
        });
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("keeps Computer file access absent for an older Service without negotiation", async () => {
    const ownerUserId = "owner-computer-file-access-legacy-service";
    const daemonSessionId =
      "daemon-session-computer-file-access-legacy-service";
    const deviceId = "device-computer-file-access-legacy-service";
    const shard = getRuntimeTransportShard(ownerUserId);
    const socket = await openDaemonStream(ownerUserId);

    try {
      await registerSession({
        daemonSessionId,
        deviceId,
        ownerUserId,
        profileIds: [],
        socket,
      });
      expect(
        await sendHeartbeat({
          daemonSessionId,
          deviceId,
          leases: [],
          ownerUserId,
          socket,
        })
      ).toMatchObject({ ok: true });

      await runInDurableObject(shard, (instance) => {
        const internal = instance as unknown as {
          state: {
            sessionsById: Map<
              string,
              { capabilities: Record<string, unknown> }
            >;
          };
        };
        expect(
          internal.state.sessionsById.get(daemonSessionId)?.capabilities
        ).not.toHaveProperty("computerFileAccess");
        expect(
          internal.state.sessionsById.get(daemonSessionId)?.capabilities
        ).not.toHaveProperty("localFolderPicker");
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("returns the exact OpenMeld Tools result from the current compatible Service", async () => {
    const ownerUserId = "owner-openmeld-tools-control";
    const daemonSessionId = "daemon-session-openmeld-tools-control";
    const deviceId = "device-openmeld-tools-control";
    const shard = getRuntimeTransportShard(ownerUserId);
    const socket = await openDaemonStream(ownerUserId);

    try {
      await registerSession({
        capabilities: {
          openMeldToolsControl: {
            requestUpdate: true,
            setAutomaticUpdates: true,
          },
        },
        daemonSessionId,
        deviceId,
        ownerUserId,
        profileIds: [],
        socket,
      });
      const responsePromise = shard.fetch(
        "https://runtime-transport.internal/openmeld-tools-control",
        {
          body: JSON.stringify({
            deviceId,
            lane: "dev-local",
            ownerUserId,
            request: {
              operation: "request_update",
              requestSource: "web",
            },
            requestId: "request-openmeld-tools-control",
            v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      const requestFrame = await waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.openmeld_tools_control.request",
        5000
      );
      expect(requestFrame).toMatchObject({
        code: "daemon.openmeld_tools_control.request",
        payload: {
          requestId: "request-openmeld-tools-control",
          request: {
            operation: "request_update",
            requestSource: "web",
          },
        },
      });
      socket.send(
        JSON.stringify({
          code: "daemon.openmeld_tools_control.result",
          payload: {
            requestId: "request-openmeld-tools-control",
            result: {
              operation: "request_update",
              result: { currentVersion: "0.3.104", status: "current" },
            },
          },
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        })
      );

      await expect(
        responsePromise.then((response) => response.json())
      ).resolves.toEqual({
        result: {
          operation: "request_update",
          result: { currentVersion: "0.3.104", status: "current" },
        },
        status: "accepted",
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("requests one automatic update from a capable production Service and coalesces the release", async () => {
    const ownerUserId = "owner-openmeld-tools-automatic-update";
    const daemonSessionId = "daemon-session-openmeld-tools-automatic-update";
    const deviceId = "device-openmeld-tools-automatic-update";
    const socket = await openDaemonStream(ownerUserId);
    const localComponents = createAutomaticUpdateLocalComponentsStatus();
    const capabilities = {
      localComponents,
      openMeldToolsControl: {
        requestAutomaticUpdate: true,
        requestUpdate: true,
        setAutomaticUpdates: true,
      },
    };
    const parsedCapabilities =
      runtimeTransportBaseCapabilitiesSchema.safeParse(capabilities);
    expect(
      parsedCapabilities.success,
      parsedCapabilities.success
        ? undefined
        : JSON.stringify(parsedCapabilities.error.issues)
    ).toBe(true);

    try {
      const automaticRequest = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.openmeld_tools_control.request",
        5000
      );
      await registerSession({
        capabilities,
        daemonSessionId,
        deviceId,
        lane: "prod",
        ownerUserId,
        profileIds: [],
        serviceVersion: "0.3.137",
        socket,
      });
      const requestFrame = await automaticRequest;
      expect(requestFrame).toMatchObject({
        code: "daemon.openmeld_tools_control.request",
        payload: {
          request: {
            operation: "request_update",
            requestSource: "automatic",
          },
        },
      });
      const requestId = (requestFrame.payload as { requestId: string })
        .requestId;
      socket.send(
        JSON.stringify({
          code: "daemon.openmeld_tools_control.result",
          payload: {
            requestId,
            result: {
              operation: "request_update",
              result: {
                currentVersion: CURRENT_RELEASE_SERVICE_VERSION,
                status: "current",
              },
            },
          },
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        })
      );

      await sendHeartbeat({
        capabilities,
        daemonSessionId,
        deviceId,
        lane: "prod",
        leases: [],
        ownerUserId,
        serviceVersion: "0.3.137",
        socket,
      });
      await expectNoOpenMeldToolsControlRequestFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("clears a failed automatic request so a replacement Service can retry", async () => {
    const ownerUserId = "owner-openmeld-tools-automatic-retry";
    const firstDaemonSessionId =
      "daemon-session-openmeld-tools-automatic-retry-1";
    const secondDaemonSessionId =
      "daemon-session-openmeld-tools-automatic-retry-2";
    const deviceId = "device-openmeld-tools-automatic-retry";
    const computerKey = `${ownerUserId}:${deviceId}:prod`;
    const shard = getRuntimeTransportShard(ownerUserId);
    const capabilities = {
      localComponents: createAutomaticUpdateLocalComponentsStatus(),
      openMeldToolsControl: {
        requestAutomaticUpdate: true,
        requestUpdate: true,
        setAutomaticUpdates: true,
      },
    };
    const firstSocket = await openDaemonStream(ownerUserId);
    let secondSocket: WebSocket | null = null;

    try {
      const firstAutomaticRequest = waitForJsonMessage(
        firstSocket,
        (value) => value.code === "daemon.openmeld_tools_control.request",
        5000
      );
      await registerSession({
        capabilities,
        daemonSessionId: firstDaemonSessionId,
        deviceId,
        lane: "prod",
        ownerUserId,
        profileIds: [],
        serviceVersion: "0.3.137",
        socket: firstSocket,
      });
      await expect(firstAutomaticRequest).resolves.toMatchObject({
        payload: {
          request: {
            operation: "request_update",
            requestSource: "automatic",
          },
        },
      });
      await waitForAutomaticUpdateTarget({
        computerKey,
        expectedTarget: CURRENT_RELEASE_SERVICE_VERSION,
        shard,
      });

      firstSocket.close(1000, "replace_service");
      await waitForAutomaticUpdateTarget({
        computerKey,
        expectedTarget: null,
        shard,
      });

      secondSocket = await openDaemonStream(ownerUserId);
      const retryRequest = waitForJsonMessage(
        secondSocket,
        (value) => value.code === "daemon.openmeld_tools_control.request",
        5000
      );
      await registerSession({
        capabilities,
        daemonSessionId: secondDaemonSessionId,
        deviceId,
        lane: "prod",
        ownerUserId,
        profileIds: [],
        serviceVersion: "0.3.137",
        socket: secondSocket,
      });
      const retryFrame = await retryRequest;
      expect(retryFrame).toMatchObject({
        payload: {
          request: {
            operation: "request_update",
            requestSource: "automatic",
          },
        },
      });
      const retryRequestId = (retryFrame.payload as { requestId: string })
        .requestId;
      secondSocket.send(
        JSON.stringify({
          code: "daemon.openmeld_tools_control.result",
          payload: {
            requestId: retryRequestId,
            result: {
              operation: "request_update",
              result: {
                currentVersion: CURRENT_RELEASE_SERVICE_VERSION,
                status: "current",
              },
            },
          },
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        })
      );
    } finally {
      firstSocket.close(1000, "test_done");
      secondSocket?.close(1000, "test_done");
    }
  }, 10_000);

  it("nudges a fresh daemon session to resync when expected routes are missing from register", async () => {
    const ownerUserId = "owner-route-reconcile-register";
    const deviceId = "device-route-reconcile-register";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-register",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const catalogChanged = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.route_catalog.changed",
        5000
      );
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-register",
        deviceId,
        profileIds: [],
      });
      expect(registered.rejectedProfiles).toEqual([]);

      await expect(catalogChanged).resolves.toMatchObject({
        code: "daemon.route_catalog.changed",
        payload: { reason: SERVER_ROUTE_RECONCILIATION_REASON },
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("does not immediately repeat route reconciliation when the expected lease is present", async () => {
    const ownerUserId = "owner-route-reconcile-present";
    const deviceId = "device-route-reconcile-present";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-present",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-present",
        deviceId,
        profileIds: [profileId],
      });
      expect(registered.acceptedLeases).toEqual([{ leaseEpoch: 1, profileId }]);
      await expectNoRouteCatalogChangedFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("narrows a scoped route-catalog change to the affected profile while still nudging the daemon", async () => {
    const ownerUserId = "owner-route-catalog-scoped";
    const deviceId = "device-route-catalog-scoped";
    const changedProfileId = `agt_${crypto.randomUUID()}`;
    const bystanderProfileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId: changedProfileId,
      runtimeId: "runtime-route-catalog-scoped",
    });
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId: bystanderProfileId,
      runtimeId: "runtime-route-catalog-scoped",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [changedProfileId, bystanderProfileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-catalog-scoped",
        deviceId,
        profileIds: [changedProfileId, bystanderProfileId],
      });
      expect(
        registered.acceptedLeases.map((lease) => lease.profileId).sort()
      ).toEqual([changedProfileId, bystanderProfileId].sort());

      // Drain the register-time invalidation buffer so the assertion below
      // observes only what the scoped notify contributes.
      await runInDurableObject(shard, (instance) => {
        const internal = instance as unknown as {
          agentReadinessInvalidationFlushTimer: ReturnType<
            typeof setTimeout
          > | null;
          pendingAgentReadinessInvalidationsByReason: Map<string, Set<string>>;
        };
        if (internal.agentReadinessInvalidationFlushTimer) {
          clearTimeout(internal.agentReadinessInvalidationFlushTimer);
          internal.agentReadinessInvalidationFlushTimer = null;
        }
        internal.pendingAgentReadinessInvalidationsByReason.clear();
      });

      const catalogChanged = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.route_catalog.changed",
        5000
      );
      const response = await shard.fetch(
        "https://runtime-transport.internal/route-catalog-changed",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
            ownerUserId,
            reason: "agent_profile_binding_changed",
            affectedProfileIds: [changedProfileId],
          }),
        }
      );
      expect(await response.json()).toEqual({
        ok: true,
        notifiedSessions: 1,
      });
      // The pull signal still reaches the daemon: scoping narrows only the
      // readiness invalidation, never the catalog re-sync nudge.
      await expect(catalogChanged).resolves.toMatchObject({
        code: "daemon.route_catalog.changed",
        payload: { reason: "agent_profile_binding_changed" },
      });

      await runInDurableObject(shard, (instance) => {
        const internal = instance as unknown as {
          agentReadinessInvalidationFlushTimer: ReturnType<
            typeof setTimeout
          > | null;
          pendingAgentReadinessInvalidationsByReason: Map<string, Set<string>>;
        };
        const pending =
          internal.pendingAgentReadinessInvalidationsByReason.get(
            "agent_profile_binding_changed"
          ) ?? new Set<string>();
        expect([...pending]).toEqual([changedProfileId]);
        // Keep the flush from racing test teardown.
        if (internal.agentReadinessInvalidationFlushTimer) {
          clearTimeout(internal.agentReadinessInvalidationFlushTimer);
          internal.agentReadinessInvalidationFlushTimer = null;
        }
        internal.pendingAgentReadinessInvalidationsByReason.clear();
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("re-registering the same catalog on the same socket publishes no readiness invalidation", async () => {
    const ownerUserId = "owner-reregister-delta";
    const deviceId = "device-reregister-delta";
    const steadyProfileId = `agt_${crypto.randomUUID()}`;
    const newcomerProfileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId: steadyProfileId,
      runtimeId: "runtime-reregister-delta",
    });
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId: newcomerProfileId,
      runtimeId: "runtime-reregister-delta",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [steadyProfileId, newcomerProfileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    const drainInvalidationBuffer = async (): Promise<string[]> =>
      await runInDurableObject(shard, (instance) => {
        const internal = instance as unknown as {
          agentReadinessInvalidationFlushTimer: ReturnType<
            typeof setTimeout
          > | null;
          pendingAgentReadinessInvalidationsByReason: Map<string, Set<string>>;
        };
        const pending = [
          ...internal.pendingAgentReadinessInvalidationsByReason.values(),
        ].flatMap((profileIds) => [...profileIds]);
        if (internal.agentReadinessInvalidationFlushTimer) {
          clearTimeout(internal.agentReadinessInvalidationFlushTimer);
          internal.agentReadinessInvalidationFlushTimer = null;
        }
        internal.pendingAgentReadinessInvalidationsByReason.clear();
        return pending;
      });

    try {
      const first = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-reregister-delta",
        deviceId,
        profileIds: [steadyProfileId],
      });
      expect(first.acceptedLeases.map((lease) => lease.profileId)).toEqual([
        steadyProfileId,
      ]);
      // The initial register is a new socket: full fan-out is expected.
      expect(await drainInvalidationBuffer()).toContain(steadyProfileId);

      const sameCatalog = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-reregister-delta",
        deviceId,
        profileIds: [steadyProfileId],
      });
      expect(
        sameCatalog.acceptedLeases.map((lease) => lease.profileId)
      ).toEqual([steadyProfileId]);
      // Same socket, same catalog: no readiness fact changed, no broadcast.
      expect(await drainInvalidationBuffer()).toEqual([]);

      const withNewcomer = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-reregister-delta",
        deviceId,
        profileIds: [steadyProfileId, newcomerProfileId],
      });
      expect(
        withNewcomer.acceptedLeases.map((lease) => lease.profileId).sort()
      ).toEqual([newcomerProfileId, steadyProfileId].sort());
      // Same socket, one new profile: only the newcomer is invalidated.
      expect(await drainInvalidationBuffer()).toEqual([newcomerProfileId]);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("throttles repeated route reconciliation while a heartbeat still reports the same missing route", async () => {
    const ownerUserId = "owner-route-reconcile-throttle";
    const deviceId = "device-route-reconcile-throttle";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-throttle",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const firstCatalogChanged = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.route_catalog.changed",
        5000
      );
      await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-throttle",
        deviceId,
        profileIds: [],
      });
      await expect(firstCatalogChanged).resolves.toMatchObject({
        code: "daemon.route_catalog.changed",
        payload: { reason: SERVER_ROUTE_RECONCILIATION_REASON },
      });

      const heartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-throttle",
        deviceId,
        leases: [],
      });
      expect(heartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("does not nudge when the daemon report already accounts for a skipped expected route", async () => {
    const ownerUserId = "owner-route-reconcile-skipped";
    const deviceId = "device-route-reconcile-skipped";
    const profileId = "agt_22222222-2222-4222-8222-222222222222";
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-skipped",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-skipped",
        deviceId,
        profileIds: [],
        localWakeRouteReport: {
          includedProfileIds: [],
          skippedProfiles: [
            {
              profileId,
              profileName: "Skipped Agent",
              skipReason: "controller.launch.needs_repair",
            },
          ],
        },
      });
      expect(registered.rejectedProfiles).toEqual([]);
      await expectNoRouteCatalogChangedFrame(socket);

      const heartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-skipped",
        deviceId,
        leases: [],
      });
      expect(heartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("does not nudge when rejected route registration already accounts for an expected route", async () => {
    const ownerUserId = "owner-route-reconcile-rejected";
    const deviceId = "device-route-reconcile-rejected";
    const leaseHolderDeviceId = "device-route-reconcile-rejected-holder";
    const profileId = "agt_33333333-3333-4333-8333-333333333333";
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-rejected",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const firstSocket = await openDaemonStream(ownerUserId);
    const secondSocket = await openDaemonStream(ownerUserId);

    try {
      const firstRegistered = await registerSession({
        socket: firstSocket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-rejected-a",
        deviceId: leaseHolderDeviceId,
        profileIds: [profileId],
      });
      expect(firstRegistered.acceptedLeases).toEqual([
        { leaseEpoch: 1, profileId },
      ]);
      await expectNoRouteCatalogChangedFrame(firstSocket);

      const secondRegistered = await registerSession({
        socket: secondSocket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-rejected-b",
        deviceId,
        profileIds: [profileId],
      });
      expect(secondRegistered.rejectedProfiles).toEqual([
        {
          profileId,
          reasonCode: "daemon.session.reject_conflict",
        },
      ]);
      await expectNoRouteCatalogChangedFrame(secondSocket);

      const heartbeat = await sendHeartbeat({
        socket: secondSocket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-rejected-b",
        deviceId,
        leases: [],
      });
      expect(heartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(secondSocket);
    } finally {
      firstSocket.close(1000, "test_done");
      secondSocket.close(1000, "test_done");
    }
  });

  it("does not re-signal after the throttle window when the daemon report fingerprint is unchanged", async () => {
    const ownerUserId = "owner-route-reconcile-fingerprint";
    const deviceId = "device-route-reconcile-fingerprint";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-fingerprint",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const firstCatalogChanged = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.route_catalog.changed",
        5000
      );
      await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-fingerprint",
        deviceId,
        profileIds: [],
      });
      await expect(firstCatalogChanged).resolves.toMatchObject({
        code: "daemon.route_catalog.changed",
        payload: { reason: SERVER_ROUTE_RECONCILIATION_REASON },
      });

      await expireRouteCatalogReconciliationThrottle({ shard });
      const heartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-fingerprint",
        deviceId,
        leases: [],
      });
      expect(heartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("skips the expected-routes read for consecutive heartbeats with the same fresh leases", async () => {
    const ownerUserId = "owner-route-reconcile-read-cache";
    const deviceId = "device-route-reconcile-read-cache";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    let profileResolveCount = 0;
    await seedExpectedRoute({
      ownerUserId,
      deviceId,
      profileId,
      runtimeId: "runtime-route-reconcile-read-cache",
    });
    await installAuthProfileResolver({
      ownerUserId,
      profileIds: [profileId],
      shard,
      onResolveProfile: () => {
        profileResolveCount += 1;
      },
    });
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-read-cache",
        deviceId,
        profileIds: [profileId],
      });
      expect(registered.acceptedLeases).toEqual([{ leaseEpoch: 1, profileId }]);
      await expectNoRouteCatalogChangedFrame(socket);
      profileResolveCount = 0;

      const firstHeartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-read-cache",
        deviceId,
        leases: registered.acceptedLeases,
      });
      expect(firstHeartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
      expect(profileResolveCount).toBe(1);

      const secondHeartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-read-cache",
        deviceId,
        leases: registered.acceptedLeases,
      });
      expect(secondHeartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
      expect(profileResolveCount).toBe(1);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("nudges an already registered daemon session when a new expected route appears before heartbeat", async () => {
    const ownerUserId = "owner-route-reconcile-heartbeat";
    const deviceId = "device-route-reconcile-heartbeat";
    const profileId = `agt_${crypto.randomUUID()}`;
    const shard = getRuntimeTransportShard(ownerUserId);
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-heartbeat",
        deviceId,
        profileIds: [],
      });
      expect(registered.rejectedProfiles).toEqual([]);
      await expectNoRouteCatalogChangedFrame(socket);

      await seedExpectedRoute({
        ownerUserId,
        deviceId,
        profileId,
        runtimeId: "runtime-route-reconcile-heartbeat",
      });
      await installAuthProfileResolver({
        ownerUserId,
        profileIds: [profileId],
        shard,
      });

      const catalogChanged = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.route_catalog.changed",
        5000
      );
      const heartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-heartbeat",
        deviceId,
        leases: [],
      });
      expect(heartbeat).toEqual({ ok: true, staleLeases: [] });
      await expect(catalogChanged).resolves.toMatchObject({
        code: "daemon.route_catalog.changed",
        payload: { reason: SERVER_ROUTE_RECONCILIATION_REASON },
      });

      const throttledHeartbeat = await sendHeartbeat({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-route-reconcile-heartbeat",
        deviceId,
        leases: [],
      });
      expect(throttledHeartbeat).toEqual({ ok: true, staleLeases: [] });
      await expectNoRouteCatalogChangedFrame(socket);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("exposes daemon route observation through the authenticated HTTP route", async () => {
    const ownerUserId = "owner-route-observation";
    const profileId = "agt-route-observation";
    const socket = await openDaemonStream(ownerUserId);
    const registered = await registerSession({
      daemonSessionId: "daemon-session-route-observation",
      deviceId: "device-route-observation",
      ownerUserId,
      profileIds: [profileId],
      socket,
    });

    const observation = await fetchRouteObservation({
      ownerUserId,
      profileId,
    });

    expect(observation.profileId).toBe(profileId);
    expect(typeof observation.observedAt).toBe("string");
    expect(observation.route).toMatchObject({
      online: true,
      daemonSessionId: "daemon-session-route-observation",
      deviceId: "device-route-observation",
      lane: "dev-local",
      connectionGeneration: registered.connectionGeneration,
      leaseEpoch: registered.acceptedLeases[0]?.leaseEpoch,
    });

    socket.close();
  });

  it("rejects mismatched register owner without poisoning the shard", async () => {
    const ownerUserId = "owner-daemon-reconcile-owner-match";
    const socket = await openDaemonStream(ownerUserId);

    try {
      const mismatched = await registerSession({
        socket,
        ownerUserId: "owner-daemon-reconcile-evil",
        daemonSessionId: "daemon-session-owner-match",
        deviceId: "device-owner-match",
        profileIds: ["agt-owner-match"],
      });
      expect(mismatched.acceptedLeases).toEqual([]);
      expect(mismatched.rejectedProfiles).toEqual([
        {
          profileId: "agt-owner-match",
          reasonCode: "daemon.session.reject_conflict",
        },
      ]);

      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-owner-match",
        deviceId: "device-owner-match",
        profileIds: ["agt-owner-match"],
      });
      expect(registered.rejectedProfiles).toEqual([]);
      await expect(
        sendHeartbeat({
          socket,
          ownerUserId,
          daemonSessionId: "daemon-session-owner-match",
          deviceId: "device-owner-match",
          leases: registered.acceptedLeases,
        })
      ).resolves.toEqual({ ok: true, staleLeases: [] });

      const route = await lookupRoute({
        ownerUserId,
        profileId: "agt-owner-match",
      });
      expect(route.online).toBe(true);

      const leaseEpoch = registered.acceptedLeases.find(
        (lease) => lease.profileId === "agt-owner-match"
      )?.leaseEpoch;
      const deliverResponse = await deliverDispatch({
        ownerUserId,
        dispatchId: "dispatch-owner-match",
        attemptId: "attempt-owner-match",
        profileId: "agt-owner-match",
        daemonSessionId: "daemon-session-owner-match",
        connectionGeneration: registered.connectionGeneration ?? 1,
        leaseEpoch: leaseEpoch ?? 1,
      });
      expect(deliverResponse).toEqual({
        accepted: true,
        status: "delivered",
      });
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("removes dropped profiles immediately for same session re-register", async () => {
    const ownerUserId = "owner-daemon-reconcile-1";
    const socket = await openDaemonStream(ownerUserId);

    try {
      const initial = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        profileIds: ["agt-remove-a", "agt-remove-b"],
      });
      expect(initial.rejectedProfiles).toEqual([]);

      const subset = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-1",
        deviceId: "device-1",
        profileIds: ["agt-remove-b"],
      });
      expect(subset.rejectedProfiles).toEqual([]);

      const removedRoute = await lookupRoute({
        ownerUserId,
        profileId: "agt-remove-a",
      });
      expect(removedRoute).toMatchObject({
        online: false,
        ownerService: {
          daemonSessionId: "daemon-session-1",
          deviceId: "device-1",
          lane: "dev-local",
        },
        reasonCode: "daemon.profile.pending_first_report",
      });

      const removedObservation = await fetchRouteObservation({
        ownerUserId,
        profileId: "agt-remove-a",
      });
      expect(removedObservation.route).toMatchObject({
        online: false,
        reasonCode: "daemon.profile.offline",
      });

      const keptRoute = await lookupRoute({
        ownerUserId,
        profileId: "agt-remove-b",
      });
      expect(keptRoute.online).toBe(true);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("adds new profiles immediately while keeping same-session lease epoch stable", async () => {
    const ownerUserId = "owner-daemon-reconcile-2";
    const socket = await openDaemonStream(ownerUserId);

    try {
      const initial = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-2",
        deviceId: "device-2",
        profileIds: ["agt-add-a"],
      });
      const initialEpoch = initial.acceptedLeases.find(
        (lease) => lease.profileId === "agt-add-a"
      )?.leaseEpoch;
      expect(initialEpoch).toBe(1);

      const expanded = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-2",
        deviceId: "device-2",
        profileIds: ["agt-add-a", "agt-add-b"],
      });

      const expandedEpoch = expanded.acceptedLeases.find(
        (lease) => lease.profileId === "agt-add-a"
      )?.leaseEpoch;
      expect(expandedEpoch).toBe(initialEpoch);

      const addedRoute = await lookupRoute({
        ownerUserId,
        profileId: "agt-add-b",
      });
      expect(addedRoute.online).toBe(true);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("logs stale lease rejection with structured event", async () => {
    const ownerUserId = "owner-daemon-reconcile-3";
    const daemonSessionId = "daemon-session-3";
    const profileId = "agt-stale-lease";
    const socket = await openDaemonStream(ownerUserId);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId,
        deviceId: "device-3",
        profileIds: [profileId],
      });
      const leaseEpoch = registered.acceptedLeases.find(
        (lease) => lease.profileId === profileId
      )?.leaseEpoch;
      const connectionGeneration = registered.connectionGeneration;
      expect(leaseEpoch).toBe(1);
      expect(connectionGeneration).toBe(1);
      await expect(
        sendHeartbeat({
          socket,
          ownerUserId,
          daemonSessionId,
          deviceId: "device-3",
          leases: registered.acceptedLeases,
        })
      ).resolves.toEqual({ ok: true, staleLeases: [] });

      const dispatchId = "dispatch-stale-lease-log-1";
      const attemptId = "attempt-stale-lease-log-1";
      const deliverFramePromise = waitForJsonMessage(
        socket,
        (value) => value.code === "daemon.dispatch.deliver",
        5000
      );
      const deliverResponse = await deliverDispatch({
        ownerUserId,
        dispatchId,
        attemptId,
        profileId,
        daemonSessionId,
        connectionGeneration: connectionGeneration ?? 1,
        leaseEpoch: leaseEpoch ?? 1,
        sourceMessageEnvelope: {
          activationTargets: [],
          referenceTargets: ["agt_44444444-4444-4444-8444-444444444444"],
          text: "@Observer(reference) Keep this as context.",
        },
      });
      expect(deliverResponse.accepted).toBe(true);

      const deliverFrame = await deliverFramePromise;
      const deliveredRequest = deliverFrame.payload as {
        payload: DeliveredDispatchPayload;
      };
      expect(deliveredRequest.payload.sourceMessageEnvelope?.ccTargets).toEqual(
        []
      );

      socket.send(
        JSON.stringify(
          buildSuccessTaskResultFrame({
            dispatchId,
            attemptId,
            daemonSessionId,
            connectionGeneration: connectionGeneration ?? 1,
            leaseEpoch: (leaseEpoch ?? 1) + 1,
            agentId: profileId,
            deliveredPayload: deliveredRequest.payload,
          })
        )
      );

      const acceptedFrame = await waitForJsonMessage(
        socket,
        (value) => {
          const payload = value.payload as { dispatchId?: string } | undefined;
          return (
            value.code === "daemon.dispatch.accepted" &&
            payload?.dispatchId === dispatchId
          );
        },
        5000
      );
      const acceptedPayload = acceptedFrame.payload as
        | { ok?: boolean }
        | undefined;
      expect(acceptedPayload?.ok).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.stale_lease_result_rejected]",
        expect.objectContaining({
          event: CORE_LOG_EVENTS.runtimeTransportStaleLeaseResultRejected,
          dispatchId,
          expectedLeaseEpoch: leaseEpoch,
          actualLeaseEpoch: (leaseEpoch ?? 1) + 1,
        })
      );
    } finally {
      warnSpy.mockRestore();
      socket.close(1000, "test_done");
    }
  });
});

function createAutomaticUpdateLocalComponentsStatus(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-01T12:54:00.000Z",
    entrypoint: "setup",
    summaryLabel: "Everything is up to date",
    summaryDescription: "OpenMeld Tools are ready.",
    setupAction: "none",
    setupActionLabel: "Everything is up to date",
    setupActionDescription: "OpenMeld Tools are ready.",
    maintenance: {
      automaticUpdatesEnabled: true,
      status: "ready",
    },
    cli: {
      commandContractVersion:
        "openmeld-cli-command-contract-2026-05-local-components-v1",
      latestPackageVersion: "0.3.137",
      packageVersion: "0.3.137",
      reasonCodes: [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    service: {
      expectedBundleHash: "c".repeat(64),
      expectedBundleVersion: "0.3.137",
      installedBundleHash: "c".repeat(64),
      installedBundleVersion: "0.3.137",
      reasonCodes: [],
      runtimeContractEpoch: "runtime-transport-epoch-2026-07-default-project",
      serviceContractVersion:
        "openmeld-service-contract-2026-09-codex-thread-model-v1",
      status: "ok",
    },
    skills: {
      expectedBundleHash: "d".repeat(64),
      installedBundleHash: "d".repeat(64),
      reasonCodes: [],
      skillContractVersion:
        "openmeld-skills-contract-2026-08-tool-owned-actions-v2",
      status: "ok",
      targetCount: 1,
    },
  };
}

describe("daemon stream keepalive", () => {
  it("answers a daemon-stream keepalive PING with PONG", async () => {
    const ownerUserId = "owner-daemon-keepalive-1";
    const socket = await openDaemonStream(ownerUserId);

    try {
      const pong = waitForRawMessage(
        socket,
        (raw) => raw === DAEMON_STREAM_KEEPALIVE_PONG,
        5000
      );
      socket.send(DAEMON_STREAM_KEEPALIVE_PING);
      expect(await pong).toBe(DAEMON_STREAM_KEEPALIVE_PONG);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("keepalive PING never changes the lease or emits an error frame", async () => {
    const ownerUserId = "owner-daemon-keepalive-2";
    const profileId = "agt-keepalive-lease";
    const socket = await openDaemonStream(ownerUserId);

    try {
      const registered = await registerSession({
        socket,
        ownerUserId,
        daemonSessionId: "daemon-session-keepalive-2",
        deviceId: "device-keepalive-2",
        profileIds: [profileId],
      });
      expect(
        registered.acceptedLeases.find((lease) => lease.profileId === profileId)
          ?.leaseEpoch
      ).toBe(1);

      const before = await lookupRoute({ ownerUserId, profileId });
      expect(before.online).toBe(true);

      // A keepalive PING is auto-answered with PONG (or by the webSocketMessage
      // fallback); either way it must never surface as an error frame or touch
      // the lease / readiness. Receiving PONG -- not a schema.invalid error
      // frame -- proves the PING was never parsed as a daemon frame.
      const pong = waitForRawMessage(
        socket,
        (raw) => raw === DAEMON_STREAM_KEEPALIVE_PONG,
        5000
      );
      socket.send(DAEMON_STREAM_KEEPALIVE_PING);
      expect(await pong).toBe(DAEMON_STREAM_KEEPALIVE_PONG);

      const after = await lookupRoute({ ownerUserId, profileId });
      expect(after.online).toBe(true);
      expect(after.leaseEpoch).toBe(before.leaseEpoch);
    } finally {
      socket.close(1000, "test_done");
    }
  });

  it("answers a keepalive PING through the webSocketMessage fallback without parsing it as a frame", async () => {
    // In production setWebSocketAutoResponse answers the PING below the handler,
    // so workerd never routes it to webSocketMessage. Drive the handler directly
    // to cover the fallback branch used in non-hibernation / local environments:
    // it must answer PONG and never emit a schema.invalid error frame.
    const ownerUserId = "owner-daemon-keepalive-fallback";
    const shard = getRuntimeTransportShard(ownerUserId);
    const sentRaw: string[] = [];
    const fakeSocket = {
      send: (data: string) => {
        sentRaw.push(data);
      },
    } as unknown as WebSocket;

    await runInDurableObject(shard, (instance) => {
      instance.webSocketMessage(fakeSocket, DAEMON_STREAM_KEEPALIVE_PING);
    });

    expect(sentRaw).toEqual([DAEMON_STREAM_KEEPALIVE_PONG]);
  });
});
