import { runInDurableObject, SELF } from "cloudflare:test";
import { exports, RpcStub, RpcTarget } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import {
  getPostgresDatabase,
  getPostgresRequestPool,
  type PoolClient,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_FILES_ORIGIN_VERSION,
  OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  MAX_PROFILE_ID_LENGTH,
  MAX_TEXT_LENGTH,
  parseEnvelope,
} from "@openmeld/protocol";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  messageReadQuerySchema,
} from "@openmeld/schemas";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  listSignalsQuerySchema,
  MAX_SPACE_NAME_LENGTH,
  postSpaceWakeStopResponseSchema,
  REMOTE_AGENT_FAILURE_PURPOSE,
  readListSignalsQueryRawValues,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER,
  SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
} from "@openmeld/schemas/schemas";
import type { UserTimeZoneObservation } from "@openmeld/schemas/types";
import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
} from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { ensurePrimaryAgentProfileBindingRecord } from "../src/agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import {
  cancelAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { writeDispatchResult } from "../src/dispatch/application/dispatch-result-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  markRemoteAgentPreAdmissionFailurePublished,
  persistRemoteAgentWorkerSubmitRequest,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  markFailedRoutineRunPublished,
  projectRoutineRunTerminal,
} from "../src/routines/routine-repository";
import {
  rpcAddSpaceMembers,
  rpcCenterAgentCreateSpace,
  rpcCenterAgentPostSpaceMessage,
  rpcCreateCenterAgentContextManifest,
  rpcCreateSpace,
  rpcGetSpaceBoard,
  rpcGetSpaceEntryResolution,
  rpcGetSpaceStatus,
  rpcGetSpaceWakeProgress,
  rpcListCenterAgentSessions,
  rpcOpenCenterAgentDirectMessageSpace,
  rpcOpenDirectMessageSpace,
  rpcPostSignal,
  rpcPostSpaceWakeStop,
  rpcPostStatusSignal,
  rpcPostSystemNoticeSignal,
} from "../src/rpc/methods";
import {
  rpcReadMessages,
  rpcRemoteAgentReadMessages,
} from "../src/search/message-read";
import { rpcSearchMessages } from "../src/search/message-search";
import { upsertJoinedSpaceMember } from "../src/space/application/space-members-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  markDispatchOutboxCancelled,
  markDispatchOutboxHandedOff,
  markDispatchOutboxPoisoned,
  recordDispatchOutboxCandidateFailure,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { SpaceFileRepository } from "../src/space/infrastructure/sql/space-file-repo";
import {
  readSpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { Space } from "../src/space/transport/do/space";
import {
  listAccountSpacesFromSpaceIndex,
  upsertSpaceIndexMembership,
} from "../src/space-index/space-index-repository";
import { readUserTimeContext } from "../src/user-time-context/user-time-context-repository";
import { env } from "../test-support/worker-env";
import { postgresFixtureOperator } from "./postgresql.test-support";
import { waitForJsonMessage } from "./test-support/ws-stream";

const memberAgentsFeature = vi.hoisted(() => ({ enabled: false }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => memberAgentsFeature.enabled,
  isRequestChainEnforced: () => memberAgentsFeature.enabled,
}));

const BASE_URL = "http://localhost";
const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;
const CURSOR_PATH_RE = /^\/v1\/spaces\/[^/]+\/cursors\/(.+)$/;
const SIGNALS_PATH_RE = /\/v1\/spaces\/[^/]+\/signals$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_PROFILE_ID_REGEX =
  /^agt_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBERSHIP_REQUIRED_RPC_ERROR_REGEX =
  /HTTP 403.*space\.membership_required/;
const ACTIVITY_FORBIDDEN_RPC_ERROR_REGEX =
  /HTTP 403.*space\.activity\.forbidden/;
const ACTIVITY_INVALID_RPC_ERROR_REGEX = /HTTP 400.*space\.activity\.invalid/;
const WAKE_STOP_FORBIDDEN_RPC_ERROR_REGEX =
  /HTTP 403.*space\.wake_stop\.forbidden/;
const DEFAULT_REQUEST_ID = "req-core-test";
const DEFAULT_HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_HUMAN_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const FOURTH_HUMAN_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const TEST_REPLY_TO = {
  signalId: "sig-reply-source-1",
  profileId: DEFAULT_HUMAN_PROFILE_ID,
  profileKind: "human" as const,
  profileName: "Test User",
  previewText: "Earlier message preview",
};
type TestAuthProfile = {
  profileId: string;
  profileKind: "human" | "agent" | "system";
  profileName?: string;
  ownerUserId?: string;
  openMeldProfileId?: string;
  agentControllerConversationId?: string;
  agentControllerRef?: string;
};
type OpenMeldRequestOptions = {
  activeOrganizationId?: string;
  spacePassword?: string;
  userTimeZoneObservation?: UserTimeZoneObservation;
};
const DEFAULT_TEST_ORGANIZATION_ID = "org-test-default";
const DEFAULT_TEST_AUTH_PROFILE: TestAuthProfile = {
  profileId: DEFAULT_HUMAN_PROFILE_ID,
  profileKind: "human",
  profileName: "Test User",
  ownerUserId: "owner-test-default",
  openMeldProfileId: DEFAULT_HUMAN_PROFILE_ID,
};
function createRpcContext(input: {
  activeOrganizationId?: string;
  requestId: string;
  profileId: string;
  profileKind: "human" | "agent" | "system";
  profileName?: string;
  ownerUserId?: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
}) {
  const openMeldProfileId = toCanonicalOpenMeldProfileId(
    input.profileId,
    input.profileKind
  );
  return {
    activeOrganizationId:
      input.activeOrganizationId ?? DEFAULT_TEST_ORGANIZATION_ID,
    actorContext: {
      requestId: input.requestId,
      callerPrincipalId: input.ownerUserId ?? openMeldProfileId,
      openMeldProfileId,
      profileKind: input.profileKind,
      ...(input.profileName ? { profileName: input.profileName } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.agentControllerRef
        ? { agentControllerRef: input.agentControllerRef }
        : {}),
    },
    ...(input.agentControllerConversationId
      ? { agentControllerConversationId: input.agentControllerConversationId }
      : {}),
  };
}
async function fetchWithOpenMeldAuth(
  input: string,
  init?: RequestInit,
  authProfile?: Partial<TestAuthProfile>,
  requestOptions?: OpenMeldRequestOptions
): Promise<Response> {
  const resolvedProfile = resolveTestAuthProfile(input, init, authProfile);
  await ensureTestOrganizationMembership({
    organizationId:
      requestOptions?.activeOrganizationId ?? DEFAULT_TEST_ORGANIZATION_ID,
    userId: resolveCallerPrincipalId(resolvedProfile),
  });
  return await SELF.fetch(input, {
    ...(init ?? {}),
    headers: buildOpenMeldAuthHeaders(input, init, authProfile, requestOptions),
  });
}
async function fetchSpaceDoWithOpenMeldAuth(
  input: {
    path: string;
    spaceId: string;
  },
  init?: RequestInit,
  authProfile?: Partial<TestAuthProfile>,
  requestOptions?: OpenMeldRequestOptions
): Promise<Response> {
  const url = new URL(`https://openmeld-core.internal${input.path}`);
  url.searchParams.set("space", input.spaceId);
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const stub = namespace.get(namespace.idFromString(input.spaceId));
  return await stub.fetch(
    new Request(url.toString(), {
      ...(init ?? {}),
      headers: buildOpenMeldAuthHeaders(
        `${BASE_URL}/v1/spaces/${input.spaceId}${input.path}`,
        init,
        authProfile,
        requestOptions
      ),
    })
  );
}
async function readCenterAgentDirectMessageHttpForbidden(
  response: Response
): Promise<{
  code: unknown;
  message: unknown;
  status: number;
}> {
  const payload = (await response.json()) as {
    code?: unknown;
    error?: {
      code?: unknown;
      message?: unknown;
    };
    message?: unknown;
  };
  return {
    code: payload.error?.code ?? payload.code,
    message: payload.error?.message ?? payload.message,
    status: response.status,
  };
}
function buildOpenMeldAuthHeaders(
  input: string,
  init?: RequestInit,
  authProfile?: Partial<TestAuthProfile>,
  requestOptions?: OpenMeldRequestOptions
): Headers {
  const resolvedProfile = resolveTestAuthProfile(input, init, authProfile);
  const headers = new Headers(init?.headers);
  const openMeldProfileId = toCanonicalOpenMeldProfileId(
    resolvedProfile.openMeldProfileId ?? resolvedProfile.profileId,
    resolvedProfile.profileKind
  );
  const callerPrincipalId = resolveCallerPrincipalId(resolvedProfile);
  applyOpenMeldRequestContextHeaders(
    headers,
    {
      requestContext: {
        ...(requestOptions?.userTimeZoneObservation
          ? { userTimeZoneObservation: requestOptions.userTimeZoneObservation }
          : {}),
        activeOrganizationId:
          requestOptions?.activeOrganizationId ?? DEFAULT_TEST_ORGANIZATION_ID,
        actorContext: {
          requestId: DEFAULT_REQUEST_ID,
          callerPrincipalId,
          openMeldProfileId,
          profileKind: resolvedProfile.profileKind,
          ...(resolvedProfile.profileName
            ? { profileName: resolvedProfile.profileName }
            : {}),
          ...(resolvedProfile.ownerUserId
            ? { ownerUserId: resolvedProfile.ownerUserId }
            : {}),
          ...(resolvedProfile.agentControllerRef
            ? { agentControllerRef: resolvedProfile.agentControllerRef }
            : {}),
        },
        ...(resolvedProfile.agentControllerConversationId
          ? {
              agentControllerConversationId:
                resolvedProfile.agentControllerConversationId,
            }
          : {}),
      },
    },
    OPENMELD_EXPECTED_FORWARDED_BY
  );
  if (requestOptions?.spacePassword !== undefined) {
    headers.set(OPENMELD_HEADER_SPACE_PASSWORD, requestOptions.spacePassword);
  }
  return headers;
}
function resolveTestAuthProfile(
  input: string,
  init?: RequestInit,
  authProfile?: Partial<TestAuthProfile>
): TestAuthProfile {
  const inferredProfile = inferAuthProfile(input, init);
  return {
    ...DEFAULT_TEST_AUTH_PROFILE,
    ...inferredProfile,
    ...(authProfile ?? {}),
  };
}
function resolveCallerPrincipalId(profile: TestAuthProfile): string {
  return (
    profile.ownerUserId ??
    toCanonicalOpenMeldProfileId(
      profile.openMeldProfileId ?? profile.profileId,
      profile.profileKind
    )
  );
}
async function ensureTestOrganizationMembership(input: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const nowMs = Date.now();
  const userSlug = input.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const organizationSlug = input.organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 1, $4, $5) ON CONFLICT DO NOTHING`,
      values: [],
    },
    values: [
      input.userId,
      `Test User ${userSlug}`,
      `${userSlug}@openmeld.test`,
      nowMs,
      nowMs,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."organizations" (
        id,
        name,
        slug,
        created_at
      )
      VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      values: [],
    },
    values: [
      input.organizationId,
      `Test Organization ${organizationSlug}`,
      organizationSlug,
      nowMs,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."members" (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, 'member', $4) ON CONFLICT DO NOTHING`,
      values: [],
    },
    values: [
      `${input.organizationId}:${input.userId}`,
      input.organizationId,
      input.userId,
      nowMs,
    ],
  });
}
async function ensureTestCenterAgentDesignation(input: {
  agentProfileId: string;
  agentProfileName: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  await ensureTestOrganizationMembership({
    organizationId: input.organizationId,
    userId: input.ownerUserId,
  });
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
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
        creator_profile_id,
        source,
        managed_role,
        last_used_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'agent', 0, 'active', $4, NULL, $5, NULL, 'auth_bootstrap', 'center_agent', NULL, $6, $7)
      ON CONFLICT(profile_id) DO UPDATE SET
        profile_name = excluded.profile_name,
        status = excluded.status,
        organization_id = excluded.organization_id,
        owner_user_id = excluded.owner_user_id,
        managed_role = excluded.managed_role,
        updated_at = excluded.updated_at
    `,
      values: [],
    },
    values: [
      input.agentProfileId,
      input.agentProfileName,
      `center-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      nowMs,
      nowMs,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      )
      VALUES ($1, $2, NULL, $3, $4)
      ON CONFLICT(organization_id) DO UPDATE SET
        agent_profile_id = excluded.agent_profile_id,
        duty = NULL,
        designated_by = excluded.designated_by,
        created_at = excluded.created_at
    `,
      values: [],
    },
    values: [
      input.organizationId,
      input.agentProfileId,
      input.ownerUserId,
      nowMs,
    ],
  });
}
describe("Delegated Space initialization", () => {
  it.each([
    false,
    true,
  ])("commits owner membership and metadata together (password: %s)", async (passwordProtected) => {
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerProfileId = randomUUID();
    const creatorProfileId = `agt_${randomUUID()}`;
    await ensureTestOrganizationMembership({
      organizationId,
      userId: ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: ownerProfileId,
    });
    await ensureTestCenterAgentDesignation({
      agentProfileId: creatorProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const agentContext = createRpcContext({
      activeOrganizationId: organizationId,
      profileId: creatorProfileId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: randomUUID(),
    });
    const created = await rpcCenterAgentCreateSpace(env as CoreBindings, {
      context: agentContext,
      name: "Delegated Room",
      onBehalfOf: { profileId: ownerProfileId },
      ...(passwordProtected ? { password: "owner-test-password" } : {}),
      visibility: "private",
    });
    const spaceId = created.spaceId;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const state = await runInDurableObject(stub, (_instance, doState) => ({
      ownerStatus:
        [
          ...doState.storage.sql.exec<{
            status: string;
          }>(
            "SELECT status FROM space_members WHERE profile_id = ?",
            ownerProfileId
          ),
        ][0]?.status ?? null,
      creatorStatus:
        [
          ...doState.storage.sql.exec<{
            status: string;
          }>(
            "SELECT status FROM space_members WHERE profile_id = ?",
            creatorProfileId
          ),
        ][0]?.status ?? null,
    }));
    expect(state).toEqual({
      ownerStatus: "active",
      creatorStatus: "active",
    });
    const meta = await stub.rpcGetMeta({
      context: createRpcContext({
        activeOrganizationId: organizationId,
        profileId: ownerProfileId,
        profileKind: "human",
        ownerUserId,
        requestId: randomUUID(),
      }),
      spaceId,
    });
    expect(meta.ownerUserIds).toContain(ownerUserId);
    expect(meta.creator?.profileId).toBe(creatorProfileId);
    expect(meta.visibility).toBe("private");
    expect(meta.accessMode).toBe(
      passwordProtected ? "protected" : "members_only"
    );
    expect(
      await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."space_owner_member_references" WHERE space_id = $1',
            values: [],
          },
          values: [spaceId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toMatchObject({ count: 1 });
    const responseLostEnv = {
      ...env,
      OPENMELD_SPACES: {
        newUniqueId: () => namespace.idFromString(spaceId),
        idFromString: (id: string) => namespace.idFromString(id),
        get: () => ({
          rpcPatchMeta: () =>
            Promise.reject(new Error("simulated response loss")),
          rpcPatchMetaWithPasswordAtomic: () =>
            Promise.reject(new Error("simulated response loss")),
          rpcCheckSpaceOwnerDeparture: (
            input: Parameters<Space["rpcCheckSpaceOwnerDeparture"]>[0]
          ) => stub.rpcCheckSpaceOwnerDeparture(input),
        }),
      } as unknown as DurableObjectNamespace<Space>,
    } as CoreBindings;
    await expect(
      rpcCenterAgentCreateSpace(responseLostEnv, {
        context: agentContext,
        name: "Delegated Room",
        onBehalfOf: { profileId: ownerProfileId },
        ...(passwordProtected ? { password: "owner-test-password" } : {}),
        visibility: "private",
      })
    ).rejects.toThrow("simulated response loss");
    expect(
      await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."space_owner_member_references" WHERE space_id = $1',
            values: [],
          },
          values: [spaceId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toMatchObject({ count: 1 });
  });
  it("rolls back metadata when the initial owner member write fails", async () => {
    const organizationId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerProfileId = randomUUID();
    const creatorProfileId = `agt_${randomUUID()}`;
    await ensureTestOrganizationMembership({
      organizationId,
      userId: ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: ownerProfileId,
    });
    await ensureTestCenterAgentDesignation({
      agentProfileId: creatorProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      profileId: creatorProfileId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: randomUUID(),
    });
    const testEnv = {
      ...env,
      OPENMELD_SPACES: {
        newUniqueId: () => namespace.idFromString(spaceId),
        idFromString: (id: string) => namespace.idFromString(id),
        get: (id: DurableObjectId) => namespace.get(id),
      } as DurableObjectNamespace<Space>,
    } as CoreBindings;
    // Fail the actual Space SQL insert, after metadata initialization begins.
    await runInDurableObject(stub, (_instance, doState) => {
      doState.storage.sql.exec(`CREATE TRIGGER fail_initial_owner BEFORE INSERT ON space_members
        WHEN NEW.profile_id = '${ownerProfileId}'
        BEGIN SELECT RAISE(ABORT, 'injected initial owner failure'); END`);
    });
    const failure = await rpcCenterAgentCreateSpace(testEnv, {
      context,
      name: "Delegated Room",
      onBehalfOf: { profileId: ownerProfileId },
      visibility: "private",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      "injected initial owner failure"
    );
    const freshStub = namespace.get(namespace.idFromString(spaceId));
    const failedState = await runInDurableObject(
      freshStub,
      (_instance, doState) => {
        const state = {
          metaCount:
            [
              ...doState.storage.sql.exec<{
                count: number;
              }>("SELECT COUNT(*) AS count FROM space_meta"),
            ][0]?.count ?? 0,
          memberCount:
            [
              ...doState.storage.sql.exec<{
                count: number;
              }>("SELECT COUNT(*) AS count FROM space_members"),
            ][0]?.count ?? 0,
        };
        doState.storage.sql.exec("DROP TRIGGER fail_initial_owner");
        return state;
      }
    );
    expect(failedState).toEqual({ metaCount: 0, memberCount: 0 });
    expect(
      await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."space_owner_member_references" WHERE space_id = $1',
            values: [],
          },
          values: [spaceId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toMatchObject({ count: 0 });
    await rpcCenterAgentCreateSpace(testEnv, {
      context,
      name: "Delegated Room",
      onBehalfOf: { profileId: ownerProfileId },
      visibility: "private",
    });
    const retried = await runInDurableObject(
      freshStub,
      (_instance, doState) => ({
        meta:
          [
            ...doState.storage.sql.exec<{
              count: number;
            }>("SELECT COUNT(*) AS count FROM space_meta"),
          ][0]?.count ?? 0,
        ownerStatus:
          [
            ...doState.storage.sql.exec<{
              status: string;
            }>(
              "SELECT status FROM space_members WHERE profile_id = ?",
              ownerProfileId
            ),
          ][0]?.status ?? null,
      })
    );
    expect(retried).toEqual({ meta: 1, ownerStatus: "active" });
    expect(
      await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."space_owner_member_references" WHERE space_id = $1',
            values: [],
          },
          values: [spaceId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toMatchObject({ count: 1 });
  });
});
async function insertTestManagedCenterAgentProfile(input: {
  agentProfileId: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
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
        creator_profile_id,
        source,
        managed_role,
        last_used_at,
        created_at,
        updated_at
      )
      VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, NULL, 'auth_bootstrap', 'center_agent', NULL, $5, $6)
    `,
      values: [],
    },
    values: [
      input.agentProfileId,
      `center-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      nowMs,
      nowMs,
    ],
  });
}
async function insertTestOrganizationAgentProfile(input: {
  agentProfileId: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
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
        creator_profile_id,
        source,
        managed_role,
        last_used_at,
        created_at,
        updated_at
      )
      VALUES ($1, 'Research Agent', $2, 'agent', 0, 'active', $3, $4, $5, NULL, 'web_create', NULL, NULL, $6, $7)
    `,
      values: [],
    },
    values: [
      input.agentProfileId,
      `research-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs,
    ],
  });
}
async function insertTestPrimaryHumanProfile(input: {
  ownerUserId: string;
  profileId: string;
}): Promise<void> {
  const nowMs = Date.now();
  await getPostgresDatabase(env).query({
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
        creator_profile_id,
        source,
        managed_role,
        last_used_at,
        created_at,
        updated_at
      )
      VALUES ($1, 'Fresh Owner', $2, 'human', 1, 'active', NULL, $3, $4, NULL, 'auth_bootstrap', NULL, NULL, $5, $6)
    `,
      values: [],
    },
    values: [
      input.profileId,
      `fresh-owner-${randomUUID()}`,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs,
    ],
  });
}
function inferAuthProfile(
  input: string,
  init?: RequestInit
): Partial<TestAuthProfile> {
  const url = new URL(input);
  const path = url.pathname;
  const method = String(init?.method ?? "GET").toUpperCase();
  const body = parseJsonObject(init?.body);
  const cursorMatch = CURSOR_PATH_RE.exec(path);
  if (cursorMatch?.[1]) {
    const profileId = decodeURIComponent(cursorMatch[1]).trim();
    if (profileId && profileId.length <= MAX_PROFILE_ID_LENGTH) {
      return {
        profileId,
        openMeldProfileId: profileId,
      };
    }
  }
  if (method === "POST" && path === "/v1/spaces") {
    const creator = (
      body as {
        creator?: unknown;
      } | null
    )?.creator;
    if (creator && typeof creator === "object") {
      const creatorObj = creator as {
        profileId?: unknown;
        profileName?: unknown;
        kind?: unknown;
        profile?: unknown;
      };
      const profileId =
        typeof creatorObj.profileId === "string"
          ? creatorObj.profileId.trim()
          : "";
      if (profileId && profileId.length <= MAX_PROFILE_ID_LENGTH) {
        const profileKind =
          creatorObj.kind === "human" ||
          creatorObj.kind === "agent" ||
          creatorObj.kind === "system"
            ? creatorObj.kind
            : "human";
        return {
          profileId,
          profileKind,
          ...(typeof creatorObj.profileName === "string"
            ? { profileName: creatorObj.profileName.trim() || undefined }
            : {}),
          ...(typeof creatorObj.profile === "string"
            ? { openMeldProfileId: creatorObj.profile.trim() || profileId }
            : { openMeldProfileId: profileId }),
        };
      }
    }
  }
  if (method === "POST" && SIGNALS_PATH_RE.test(path)) {
    const profile = (
      body as {
        profile?: unknown;
      } | null
    )?.profile;
    if (profile && typeof profile === "object") {
      const profileObj = profile as {
        profileId?: unknown;
        profileName?: unknown;
        kind?: unknown;
        owner?: unknown;
        agentControllerConversationId?: unknown;
        agentControllerRef?: unknown;
      };
      const profileId =
        typeof profileObj.profileId === "string"
          ? profileObj.profileId.trim()
          : "";
      if (profileId && profileId.length <= MAX_PROFILE_ID_LENGTH) {
        const profileKind =
          profileObj.kind === "human" ||
          profileObj.kind === "agent" ||
          profileObj.kind === "system"
            ? profileObj.kind
            : "human";
        return {
          profileId,
          profileKind,
          ...(typeof profileObj.profileName === "string"
            ? { profileName: profileObj.profileName.trim() || undefined }
            : {}),
          ...(profileKind === "agent" && typeof profileObj.owner === "string"
            ? { ownerUserId: profileObj.owner.trim() || undefined }
            : {}),
          ...(profileKind === "agent" &&
          typeof profileObj.agentControllerConversationId === "string"
            ? {
                agentControllerConversationId:
                  profileObj.agentControllerConversationId.trim() || undefined,
              }
            : {}),
          ...(profileKind === "agent" &&
          typeof profileObj.agentControllerRef === "string"
            ? {
                agentControllerRef:
                  profileObj.agentControllerRef.trim() || undefined,
              }
            : {}),
          openMeldProfileId: profileId,
        };
      }
    }
  }
  return {};
}
function parseJsonObject(body: RequestInit["body"]): object | null {
  if (typeof body !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
function toCanonicalOpenMeldProfileId(
  profileId: string,
  profileKind: TestAuthProfile["profileKind"]
): string {
  const normalized = profileId.trim();
  if (profileKind === "system" && normalized === "openmeld-system") {
    return normalized;
  }
  if (isUuid(normalized)) {
    return normalized;
  }
  if (isAgentProfileId(normalized)) {
    return normalized;
  }
  const digest = createHash("sha256")
    .update(`${profileKind}:${normalized}`)
    .digest("hex");
  const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return profileKind === "agent" ? `agt_${uuid}` : uuid;
}
function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}
function isAgentProfileId(value: string): boolean {
  return AGENT_PROFILE_ID_REGEX.test(value);
}
async function createSpace(
  body?: Record<string, unknown>,
  authProfile?: Partial<TestAuthProfile>,
  requestOptions?: OpenMeldRequestOptions
): Promise<string> {
  const requestBody = {
    ...(body?.accessMode === undefined && body?.password === undefined
      ? { accessMode: "public" }
      : {}),
    visibility: "private",
    ...(body ?? {}),
  };
  const response = await fetchWithOpenMeldAuth(
    `${BASE_URL}/v1/spaces`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    },
    authProfile,
    requestOptions
  );
  if (response.status !== 200) {
    throw new Error(`Expected 200 from create space, got ${response.status}`);
  }
  const data = (await response.json()) as {
    spaceId?: unknown;
  };
  if (
    typeof data.spaceId !== "string" ||
    !SPACE_ID_HEX_REGEX.test(data.spaceId)
  ) {
    throw new Error("Expected response to include a 64-hex spaceId");
  }
  return data.spaceId;
}
async function readDrainedResponseStatus(response: Response): Promise<number> {
  const status = response.status;
  await response.text();
  return status;
}
async function readResponseStatusAndCode(response: Response): Promise<{
  code?: string;
  status: number;
}> {
  const status = response.status;
  const payload = (await response.json()) as {
    code?: string;
  };
  return {
    status,
    ...(payload.code === undefined ? {} : { code: payload.code }),
  };
}
async function postTextSignal(
  spaceId: string,
  text: string,
  clientMessageId?: string
): Promise<SignalEnvelope & { type: "signal.text" }> {
  const response = await fetchWithOpenMeldAuth(
    `${BASE_URL}/v1/spaces/${spaceId}/signals`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(clientMessageId ? { clientMessageId } : {}),
        profile: {
          kind: "human",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileName: "alice",
        },
        type: "signal.text",
        data: { text },
      }),
    }
  );
  if (response.status !== 200) {
    throw new Error(
      `Expected POST /signals to return 200, got ${response.status}: ${await response.text()}`
    );
  }
  const payload = parseEnvelope(await response.json());
  if (!isTextSignalEnvelope(payload)) {
    throw new Error("Expected signal.text envelope from POST /signals");
  }
  return payload;
}
async function openSpaceSocket(
  spaceId: string,
  profile: {
    kind: string;
    profileId: string;
    profileName: string;
    owner?: string;
    agentControllerConversationId?: string;
    agentControllerRef?: string;
  },
  requestOptions?: OpenMeldRequestOptions,
  authProfile?: Partial<TestAuthProfile>,
  beforeHello?: (socket: WebSocket) => void
) {
  const socket = await openPendingSpaceSocket(
    spaceId,
    profile,
    requestOptions,
    authProfile
  );
  beforeHello?.(socket);
  const ack = waitForJsonMessage(
    socket,
    (data) => data.type === "system.hello.ack"
  );
  socket.send(JSON.stringify({ type: "hello", profile }));
  await ack;
  return socket;
}
async function openPendingSpaceSocket(
  spaceId: string,
  profile: {
    kind: string;
    profileId: string;
    profileName: string;
    owner?: string;
    agentControllerConversationId?: string;
    agentControllerRef?: string;
  },
  requestOptions?: OpenMeldRequestOptions,
  authProfile?: Partial<TestAuthProfile>
) {
  const baseAuthProfile: Partial<TestAuthProfile> = {
    profileId: profile.profileId,
    profileKind:
      profile.kind === "agent" || profile.kind === "system"
        ? profile.kind
        : "human",
    profileName: profile.profileName,
    ...(profile.owner ? { ownerUserId: profile.owner } : {}),
    ...(profile.agentControllerConversationId
      ? { agentControllerConversationId: profile.agentControllerConversationId }
      : {}),
    ...(profile.agentControllerRef
      ? { agentControllerRef: profile.agentControllerRef }
      : {}),
    openMeldProfileId: profile.profileId,
  };
  const response = await fetchWithOpenMeldAuth(
    `${BASE_URL}/v1/spaces/${spaceId}/stream`,
    {
      headers: {
        Upgrade: "websocket",
      },
    },
    {
      ...baseAuthProfile,
      ...(authProfile ?? {}),
    },
    requestOptions
  );
  if (response.status !== 101) {
    throw new Error(
      `Expected 101 Switching Protocols from openSpaceSocket, got ${response.status}`
    );
  }
  const socket = response.webSocket;
  if (!socket) {
    throw new Error("Missing WebSocket on response");
  }
  socket.accept();
  return socket;
}
describe("OpenMeld Core", () => {
  it.each([
    "space",
    "direct_message",
  ] as const)("creates a composer task through the ordinary signal RPC exactly once in %s", async (kind) => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId =
      kind === "space"
        ? await createSpace({ name: "Composer task RPC" })
        : namespace.newUniqueId().toString();
    const context = createRpcContext({
      requestId: "composer-task-rpc",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const stub = namespace.get(namespace.idFromString(spaceId));
    if (kind === "direct_message") {
      await stub.rpcInitializeDirectMessageMeta({
        creator: {
          kind: "human",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileName: "Test User",
          ownerUserId: "owner-test-default",
          ownerName: "Test User",
        },
        guide: "",
        name: "Private task RPC",
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        pairKey: `${DEFAULT_HUMAN_PROFILE_ID}:${SECOND_HUMAN_PROFILE_ID}`,
        purpose: "openmeld_dm_space",
        spaceId,
        visibility: "private",
      });
      await stub.rpcPostMembers({
        spaceId,
        context,
        members: [
          {
            agentControllerRef: null,
            ownerName: "Test User",
            ownerUserId: "owner-test-default",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Test User",
          },
        ],
      });
    }
    const taskMessageId = randomUUID();
    const input = {
      spaceId,
      context,
      authoringPolicy: "user_authored" as const,
      profile: {
        kind: "human" as const,
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileName: "Test User",
      },
      text: "Check loading and retry states.",
      clientMessageId: taskMessageId,
      meta: { clientMessageId: taskMessageId },
      taskDraft: {
        title: "Review image uploads",
        assigneeProfileId: DEFAULT_HUMAN_PROFILE_ID,
      },
    };
    const first = await stub.rpcPostSignalOnceByClientMessageId(input);
    const repeated = await stub.rpcPostSignalOnceByClientMessageId(input);
    expect(repeated.id).toBe(first.id);
    const list = await stub.rpcListTasks({ spaceId, context });
    expect(list.tasks).toHaveLength(1);
    expect(list.tasks[0]).toMatchObject({
      title: "Review image uploads",
      sourceSignalId: first.id,
      phase: "to_do",
      assignee: { profileId: DEFAULT_HUMAN_PROFILE_ID },
    });
    const invalidMessageId = randomUUID();
    const invalidDraftError = await stub
      .rpcPostSignalOnceByClientMessageId({
        ...input,
        clientMessageId: invalidMessageId,
        meta: { clientMessageId: invalidMessageId },
        taskDraft: {
          title: "Invalid owner",
          assigneeProfileId: SECOND_HUMAN_PROFILE_ID,
        },
      })
      .then(
        () => null,
        (error: Error) => error.message
      );
    expect(invalidDraftError).toContain("space_task.invalid_draft");
    expect((await stub.rpcListTasks({ spaceId, context })).tasks).toHaveLength(
      1
    );
    if (kind === "direct_message") {
      const outsider = createRpcContext({
        requestId: "private-task-outsider",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Outsider",
        ownerUserId: "outside-owner",
      });
      const readError = await stub
        .rpcListTasks({ spaceId, context: outsider })
        .then(
          () => null,
          (error: Error) => error.message
        );
      expect(readError).toContain("space.membership_required");
      const outsiderMessageId = randomUUID();
      const writeError = await stub
        .rpcPostSignalOnceByClientMessageId({
          ...input,
          context: outsider,
          profile: {
            kind: "human",
            profileId: SECOND_HUMAN_PROFILE_ID,
            profileName: "Outsider",
          },
          clientMessageId: outsiderMessageId,
          meta: { clientMessageId: outsiderMessageId },
        })
        .then(
          () => null,
          (error: Error) => error.message
        );
      expect(writeError).toContain("space.membership_required");
    }
  });

  it("authorizes manual summary recovery only for a current matching human member", async () => {
    const spaceId = await createSpace({
      name: "summary-recovery-access",
      accessMode: "members_only",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const input = {
      spaceId,
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      ownerUserId: DEFAULT_TEST_AUTH_PROFILE.ownerUserId as string,
    };
    await expect(
      stub.rpcCheckTaskSummaryRecoveryAccess(input)
    ).resolves.toEqual({ allowed: true });
    await expect(
      stub.rpcCheckTaskSummaryRecoveryAccess({
        ...input,
        ownerUserId: "another-owner",
      })
    ).resolves.toEqual({ allowed: false });
    await expect(
      stub.rpcCheckTaskSummaryRecoveryAccess({
        ...input,
        profileId: SECOND_HUMAN_PROFILE_ID,
      })
    ).resolves.toEqual({ allowed: false });
  });
  it("creates a new space", async () => {
    const spaceId = await createSpace({ accessMode: undefined });
    const metaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`
    );
    expect(metaResponse.status).toBe(200);
    await expect(metaResponse.json()).resolves.toMatchObject({
      accessMode: "members_only",
      visibility: "private",
    });
  });
  it("rejects unauthenticated HTTP requests with 401", async () => {
    const spaceId = await createSpace();
    const response = await SELF.fetch(`${BASE_URL}/v1/spaces/${spaceId}/meta`);
    expect(response.status).toBe(401);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("auth.unauthenticated");
    expect(payload.message).toBe("authentication required");
  });
  it("rejects unauthenticated websocket upgrades with 401", async () => {
    const spaceId = await createSpace();
    const response = await SELF.fetch(
      `${BASE_URL}/v1/spaces/${spaceId}/stream`,
      {
        headers: { Upgrade: "websocket" },
      }
    );
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeNull();
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("auth.unauthenticated");
    expect(payload.message).toBe("authentication required");
  });
  it.each([
    "human",
    "agent",
  ] as const)("authorizes %s-requested Wake Stop through Auth RPC for the requester or agent owner only", async (sourceKind) => {
    // The unrelated account creates the Space: creation must not grant Stop.
    const spaceId = await createSpace(undefined, {
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      ownerUserId: "unrelated-owner",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await runInDurableObject(stub, async (_instance, state) => {
      const sourceSignalId = `wake-stop-source-${randomUUID()}`;
      const targetProfileId = `agt_${randomUUID()}`;
      const sourceProfileId =
        sourceKind === "agent"
          ? `agt_${randomUUID()}`
          : DEFAULT_HUMAN_PROFILE_ID;
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: sourceSignalId,
        spaceId,
        ts: Date.now(),
        type: "signal.text",
        profile: {
          kind: sourceKind,
          profileId: sourceProfileId,
          profileName: sourceKind === "agent" ? "Center Agent" : "Requester",
        },
        data: { text: "Run this task." },
      });
      // Use workerd's RPC proxy: ordinary function mocks incorrectly support .bind().
      class AuthProfiles extends RpcTarget {
        resolveProfileById({
          openMeldProfileId,
        }: {
          openMeldProfileId: string;
        }) {
          const sourceOwnerUserId =
            sourceKind === "agent"
              ? "center-agent-owner"
              : "owner-test-default";
          return {
            ok: true as const,
            profile: {
              profileId: openMeldProfileId,
              profileKind:
                openMeldProfileId === targetProfileId ||
                (sourceKind === "agent" &&
                  openMeldProfileId === sourceProfileId)
                  ? ("agent" as const)
                  : ("human" as const),
              profileName: "Test profile",
              profileHandle: "test-profile",
              status: "active" as const,
              ownerUserId:
                openMeldProfileId === targetProfileId
                  ? "agent-owner"
                  : sourceOwnerUserId,
            },
          };
        }
      }
      using auth = new RpcStub(new AuthProfiles());
      const space = new Space(state, {
        ...env,
        OPENMELD_AUTH_WORKER: auth,
      } as unknown as CoreBindings);
      const stop = {
        ok: true as const,
        status: "cancelled" as const,
        targetProfileId,
        runtimeCoordinatorExecutionId: null,
        stopMode: "openmeld_owned_pre_agent" as const,
        cancellationState: {
          status: "cancelled" as const,
          observedAtMs: Date.now(),
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
        },
      };
      const nativeStop = vi.fn(async () => null as typeof stop | null);
      const preAgentStop = vi.fn(async () => stop);
      const item = {
        clientMessageId: "stop-permission-test",
        dispatchId: "stop-permission-dispatch",
        sourceSignalId,
        targetProfileId,
        targetLabel: "Test agent",
        phase: "running" as const,
        message: "Working",
        updatedAtMs: Date.now(),
        terminal: false,
        wakeStopEligibility: {
          status: "eligible" as const,
          controlMode: "cancel" as const,
          reliability: "native_cancel" as const,
          reasonCode: null,
        },
      };
      Object.defineProperties(space, {
        readWakeStopDispatchLookup: {
          value: async () => ({
            matches: [
              { dispatchId: item.dispatchId, sourceSignalId, targetProfileId },
            ],
          }),
        },
        requestRemoteAgentNativeDeliveryStop: { value: nativeStop },
        requestPreAgentWakeStop: { value: preAgentStop },
        readSpaceWakeProgress: {
          value: async () => ({
            query: {
              spaceId,
              clientMessageId: item.clientMessageId,
              targetProfileId: null,
            },
            items: [item],
          }),
        },
        readActiveSpaceWakeProgress: {
          value: async () => ({
            query: { spaceId, targetProfileId: null },
            items: [item],
          }),
        },
      });
      for (const native of [false, true]) {
        nativeStop.mockResolvedValue(native ? stop : null);
        for (const by of ["source_signal", "client_message"] as const) {
          for (const [profileId, ownerUserId, allowed] of [
            [
              DEFAULT_HUMAN_PROFILE_ID,
              "owner-test-default",
              sourceKind === "human",
            ],
            [SECOND_HUMAN_PROFILE_ID, "agent-owner", true],
            [THIRD_HUMAN_PROFILE_ID, "unrelated-owner", false],
            [
              FOURTH_HUMAN_PROFILE_ID,
              "owner-test-default",
              sourceKind === "human",
            ],
          ] as const) {
            nativeStop.mockClear();
            preAgentStop.mockClear();
            const context = createRpcContext({
              profileId,
              ownerUserId,
              profileKind: "human",
              requestId: "stop-authorization-test",
            });
            const request = space.rpcPostWakeStop({
              spaceId,
              context,
              body: {
                target:
                  by === "source_signal"
                    ? { by, sourceSignalId, targetProfileId }
                    : {
                        by,
                        clientMessageId: item.clientMessageId,
                        targetProfileId,
                      },
              },
            });
            if (allowed) {
              await expect(request).resolves.toMatchObject({ ok: true });
              expect(nativeStop).toHaveBeenCalledOnce();
              expect(preAgentStop).toHaveBeenCalledTimes(native ? 0 : 1);
            } else {
              await expect(request).rejects.toThrow(
                WAKE_STOP_FORBIDDEN_RPC_ERROR_REGEX
              );
              expect(nativeStop).not.toHaveBeenCalled();
              expect(preAgentStop).not.toHaveBeenCalled();
            }
            for (const progress of [
              await space.rpcGetWakeProgress({
                spaceId,
                context,
                clientMessageId: item.clientMessageId,
                includeWakeStopEligibility: true,
              }),
              await space.rpcGetActiveWakeProgress({
                spaceId,
                context,
                includeWakeStopEligibility: true,
              }),
            ]) {
              expect(progress.items[0]?.wakeStopEligibility).toEqual(
                allowed ? item.wakeStopEligibility : null
              );
              expect(progress.items[0]?.phase).toBe("running");
            }
          }
        }
      }
      nativeStop.mockClear();
      preAgentStop.mockClear();
      const anonymousAccess = createAnonymousViewerSpaceAccessContext({
        spaceId,
        requestId: "anonymous-stop",
      });
      await expect(
        space.rpcPostWakeStop({
          spaceId,
          spaceAccess: anonymousAccess,
          body: {
            target: { by: "source_signal", sourceSignalId, targetProfileId },
          },
        })
      ).rejects.toThrow("space.access.read_only");
      const anonymousProgress = await space.rpcGetActiveWakeProgress({
        spaceId,
        spaceAccess: anonymousAccess,
        includeWakeStopEligibility: true,
      });
      expect(anonymousProgress.items[0]?.wakeStopEligibility).toBeNull();
      expect(nativeStop).not.toHaveBeenCalled();
      expect(preAgentStop).not.toHaveBeenCalled();
    });
  });
  it.each([
    ["public", "allowed"],
    ["protected", "password_required"],
    ["members_only", "unavailable"],
  ] as const)("resolves anonymous %s entry through the authorized metadata read", async (accessMode, state) => {
    const spaceId = await createSpace({
      accessMode,
      ...(accessMode === "protected" ? { password: "entry-secret" } : {}),
    });
    const result = await rpcGetSpaceEntryResolution(
      env as unknown as CoreBindings,
      {
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "entry-resolution-test",
        }),
      }
    );
    expect(result.view.state).toBe(state);
    if (state !== "allowed") {
      expect(result.safeContext).toEqual({});
    }
  });
  it("reads entry participation from current Space membership after authorization", async () => {
    const spaceId = await createSpace({ accessMode: "public" });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const context = createRpcContext({
      requestId: "entry-participation",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    expect(await stub.rpcGetEntryAccess({ spaceId, context })).toMatchObject({
      meta: { spaceId, accessMode: "public" },
      activeMember: true,
    });
    expect(
      await stub.rpcGetEntryAccess({
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "entry-anonymous",
        }),
      })
    ).toMatchObject({ activeMember: false });
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_members SET status = 'removed' WHERE owner_user_id_snapshot = ?",
        "owner-test-default"
      );
    });
    expect(await stub.rpcGetEntryAccess({ spaceId, context })).toMatchObject({
      activeMember: false,
    });
  });
  it("routes Wake Stop POST requests to a typed response instead of 404", async () => {
    const spaceId = await createSpace();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/wake-stop`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target: {
            by: "source_signal",
            sourceSignalId: "sig-missing-wake",
            targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
          },
        }),
      }
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    const parsed = postSpaceWakeStopResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("Wake Stop response should match the shared schema");
    }
    expect(parsed.data).toMatchObject({
      ok: false,
      runtimeCoordinatorExecutionId: null,
      status: "not_found",
      reasonCode: "space.wake_stop_target_not_found",
      cancellationState: {
        status: "not_requested",
        reasonCode: "space.wake_stop_target_not_found",
      },
    });
  });
  it("asks the user to retry when the agent interaction projection cannot be read", async () => {
    const spaceId = await createSpace();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const nativeQuery = PostgresDatabase.prototype.query;
    const fault = vi
      .spyOn(PostgresDatabase.prototype, "query")
      .mockImplementation(async function (
        this: PostgresDatabase,
        query,
        values
      ) {
        const text = typeof query === "string" ? query : query.text;
        if (text.includes('"openMeldDaemon_runtime_coordinator_executions"')) {
          throw new Error("PostgreSQL unavailable");
        }
        return await nativeQuery.call(this, query, values);
      });
    const result = await runInDurableObject(stub, async (_instance, state) => {
      const restarted = new Space(state, {
        ...(env as unknown as CoreBindings),
      });
      return await restarted.rpcRespondToAgentInteraction({
        body: {
          interactionId: "interaction-read-failure",
          response: {
            kind: "permission",
            optionId: "allow-once",
          },
          runtimeCoordinatorExecutionId: "rce-read-failure",
        },
        context: createRpcContext({
          requestId: "req-interaction-read-failure",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Test User",
          ownerUserId: "owner-test-default",
        }),
        spaceId,
      });
    });
    fault.mockRestore();
    expect(result).toEqual({
      message: "OpenMeld could not read this Wake right now. Please try again.",
      ok: false,
      status: "retry_later",
    });
  });
  it("reports not found only when the agent interaction projection is actually absent", async () => {
    const spaceId = await createSpace();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const result = await runInDurableObject(stub, async (_instance, state) => {
      const restarted = new Space(state, {
        ...(env as unknown as CoreBindings),
      });
      return await restarted.rpcRespondToAgentInteraction({
        body: {
          interactionId: "interaction-not-found",
          response: {
            kind: "permission",
            optionId: "allow-once",
          },
          runtimeCoordinatorExecutionId: "rce-not-found",
        },
        context: createRpcContext({
          requestId: "req-interaction-not-found",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Test User",
          ownerUserId: "owner-test-default",
        }),
        spaceId,
      });
    });
    expect(result).toEqual({
      message: "This local agent request is no longer available.",
      ok: false,
      status: "not_found",
    });
  });

  it("stops only the selected native continuation of the original request", async () => {
    const spaceId = await createSpace({
      name: `continuation-stop-${randomUUID()}`,
    });
    const source = await postTextSignal(
      spaceId,
      "Delegate and then summarize."
    );
    const unrelatedSource = await postTextSignal(spaceId, "Another request.");
    const targetProfileId = `agt_${randomUUID()}`;
    const nowMs = Date.now();
    const deliveries = await Promise.all(
      ["parent", "continuation", "unrelated"].map(async (kind) => {
        const idempotencyKey = `${kind}-${randomUUID()}`;
        const dispatchId = `dispatch-${randomUUID()}`;
        const submissionId = `submission-${randomUUID()}`;
        await upsertRemoteAgentNativeDeliveryRecord({
          attemptId: null,
          bindingId: `binding-${randomUUID()}`,
          db: getPostgresDatabase(env),
          dispatchId,
          idempotencyKey,
          nowMs,
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          profileId: targetProfileId,
          spaceId,
          status: "submitted",
          triggerMessageId:
            kind === "unrelated" ? unrelatedSource.id : source.id,
        });
        await markRemoteAgentNativeDeliveryAck({
          accepted: true,
          db: getPostgresDatabase(env),
          idempotencyKey,
          nowMs,
          submissionId,
          workerRequestId: `request-${randomUUID()}`,
        });
        if (kind === "parent") {
          await markRemoteAgentNativeDeliveryCompleted({
            db: getPostgresDatabase(env),
            submissionId,
            publishedSignalId: null,
            nowMs,
          });
        }
        return { dispatchId, idempotencyKey, submissionId };
      })
    );
    const [parent, continuation, unrelated] = deliveries;
    if (!(parent && continuation && unrelated)) {
      throw new Error("Missing native delivery fixture");
    }
    const cancelExecution = vi.fn(async (_input: { submissionId: string }) => ({
      execution: {
        acceptedAtMs: nowMs,
        cancellationReason: "User stopped this Wake.",
        completedAtMs: nowMs,
        idempotencyKey: continuation.idempotencyKey,
        lastProgressAtMs: nowMs,
        lastProgressKind: "aborted" as const,
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        spaceId,
        status: "aborted" as const,
        submissionId: continuation.submissionId,
        v: 1 as const,
      },
      status: "already_cancelled" as const,
    }));
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await runInDurableObject(stub, async (_instance, state) => {
      const space = new Space(state, {
        ...env,
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      } as unknown as CoreBindings);
      const stop = (
        dispatchId: string,
        sourceSignalId = source.id,
        profileId = targetProfileId
      ) =>
        space.rpcPostWakeStop({
          spaceId,
          context: createRpcContext({
            requestId: "native-continuation-stop",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileKind: "human",
            ownerUserId: "owner-test-default",
          }),
          body: {
            target: {
              by: "source_signal",
              sourceSignalId,
              dispatchId,
              targetProfileId: profileId,
            },
          },
        });
      await expect(stop(unrelated.dispatchId)).resolves.toMatchObject({
        status: "not_found",
      });
      await expect(
        stop(continuation.dispatchId, unrelatedSource.id)
      ).resolves.toMatchObject({ status: "not_found" });
      await expect(
        stop(continuation.dispatchId, source.id, `agt_${randomUUID()}`)
      ).resolves.toMatchObject({ status: "not_found" });
      await expect(stop(parent.dispatchId)).resolves.toMatchObject({
        status: "not_stoppable",
      });
      expect(cancelExecution).not.toHaveBeenCalled();
      await expect(stop(continuation.dispatchId)).resolves.toMatchObject({
        ok: true,
        status: "cancelled",
      });
      expect(cancelExecution).toHaveBeenCalledOnce();
      expect(cancelExecution.mock.calls[0]?.[0]).toMatchObject({
        submissionId: continuation.submissionId,
      });
      await expect(stop(continuation.dispatchId)).resolves.toMatchObject({
        status: "already_cancelled",
      });
      expect(cancelExecution).toHaveBeenCalledOnce();
    });
    await expect(
      readRemoteAgentNativeDeliveryBySubmissionId({
        db: getPostgresDatabase(env),
        submissionId: unrelated.submissionId,
      })
    ).resolves.toMatchObject({ status: "accepted" });
  });

  it("settles Core delivery state when Remote confirms the execution is already cancelled", async () => {
    const idempotencyKey = `space-stop-confirmed-${randomUUID()}`;
    const dispatchId = `dispatch-stop-confirmed-${randomUUID()}`;
    const attemptId = `attempt-stop-confirmed-${randomUUID()}`;
    const submissionId = `submission-stop-confirmed-${randomUUID()}`;
    const nativeDeliverySpaceId = await createSpace({
      name: `confirmed-stop-${Date.now()}`,
    });
    const source = await postTextSignal(
      nativeDeliverySpaceId,
      "Check existing results."
    );
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const cancelExecution = vi.fn(async () => ({
      execution: {
        acceptedAtMs: 1100,
        cancellationReason: "User stopped this Wake.",
        completedAtMs: 1200,
        idempotencyKey,
        lastProgressAtMs: 1200,
        lastProgressKind: "aborted" as const,
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        spaceId: nativeDeliverySpaceId,
        status: "aborted" as const,
        submissionId,
        v: 1 as const,
      },
      status: "already_cancelled" as const,
    }));
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (
          idempotency_key,
          dispatch_id,
          space_id,
          source_event_id,
          source_client_message_id,
          target_profile_id,
          status,
          first_seen_at_ms,
          last_attempt_at_ms,
          attempt_count,
          latest_attempt_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
        values: [],
      },
      values: [
        idempotencyKey,
        dispatchId,
        nativeDeliverySpaceId,
        source.id,
        "client-stop-confirmed",
        targetProfileId,
        "dispatching",
        1000,
        1100,
        1,
        attemptId,
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts" (
          attempt_id,
          dispatch_id,
          idempotency_key,
          attempt_no,
          status,
          task_id,
          target_profile_id,
          created_at_ms,
          started_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        values: [],
      },
      values: [
        attemptId,
        dispatchId,
        idempotencyKey,
        1,
        "waiting_result",
        `task-stop-confirmed-${randomUUID()}`,
        targetProfileId,
        1000,
        1100,
      ],
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId,
      bindingId: `binding-stop-confirmed-${randomUUID()}`,
      db: getPostgresDatabase(env),
      dispatchId,
      idempotencyKey,
      nowMs: 1000,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: targetProfileId,
      spaceId: nativeDeliverySpaceId,
      status: "submitted",
      triggerMessageId: source.id,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: getPostgresDatabase(env),
      idempotencyKey,
      nowMs: 1100,
      submissionId,
      workerRequestId: `request-stop-confirmed-${randomUUID()}`,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(nativeDeliverySpaceId));
    await runInDurableObject(stub, async (instance, state) => {
      const space = instance as unknown as {
        bindings: CoreBindings;
        requestRemoteAgentNativeDeliveryStop(input: {
          body: {
            reason: string;
            target: {
              by: "source_signal";
              sourceSignalId: string;
              targetProfileId: string;
            };
          };
          lookupMatch: {
            dispatchId: string;
            targetProfileId: string;
          };
        }): Promise<unknown>;
      };
      const originalBindings = space.bindings;
      // Exercise explicit Stop and replay here; alarm recovery has its own
      // lifetime tests and must not race this request's call-count assertion.
      const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
      const alarmSpy = vi
        .spyOn(state.storage, "setAlarm")
        .mockImplementation((time) =>
          nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
        );
      await state.storage.deleteAlarm();
      space.bindings = {
        ...originalBindings,
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      } as CoreBindings;
      try {
        await expect(
          space.requestRemoteAgentNativeDeliveryStop({
            body: {
              reason: "User stopped this Wake.",
              target: {
                by: "source_signal",
                sourceSignalId: source.id,
                targetProfileId,
              },
            },
            lookupMatch: { dispatchId, targetProfileId },
          })
        ).resolves.toMatchObject({
          cancellationState: {
            reasonCode: "remote_agent.execution_cancelled",
            status: "cancelled",
          },
          ok: true,
          status: "cancelled",
          stopMode: "remote_agent_native_delivery",
        });
        expect(
          state.storage.sql
            .exec<{
              status: string;
            }>(
              "SELECT status FROM openMeldDaemon_outbox WHERE dispatch_id = ?",
              dispatchId
            )
            .toArray()
        ).toEqual([{ status: "cancelled" }]);
        await expect(
          space.requestRemoteAgentNativeDeliveryStop({
            body: {
              reason: "User stopped this Wake.",
              target: {
                by: "source_signal",
                sourceSignalId: source.id,
                targetProfileId,
              },
            },
            lookupMatch: { dispatchId, targetProfileId },
          })
        ).resolves.toMatchObject({
          cancellationState: {
            reasonCode: "remote_agent.already_cancelled",
            status: "cancelled",
          },
          status: "already_cancelled",
        });
        expect(cancelExecution).toHaveBeenCalledOnce();
      } finally {
        space.bindings = originalBindings;
        await state.storage.deleteAlarm();
        alarmSpy.mockRestore();
      }
    });
    await expect(
      readRemoteAgentNativeDeliveryBySubmissionId({
        db: getPostgresDatabase(env),
        submissionId,
      })
    ).resolves.toMatchObject({
      failureCode: "runtime_coordinator.pre_agent_stop_requested",
      status: "failed",
    });
    await expect(
      getPostgresDatabase(env)
        .query({
          ...{
            text: `
          SELECT
            ledger.status,
            attempt.status AS attempt_status,
            attempt.error_code AS attempt_error_code
          FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
          JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempt
            ON attempt.attempt_id = ledger.latest_attempt_id
          WHERE ledger.idempotency_key = $1
        `,
            values: [],
          },
          values: [idempotencyKey],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toMatchObject({
      attempt_error_code: "runtime_coordinator.pre_agent_stop_requested",
      attempt_status: "superseded",
      status: "cancelled",
    });
  });
  it("returns websocket error frames with clientMessageId when text payload validation fails", async () => {
    const spaceId = await createSpace();
    const socket = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileName: "Test User",
    });
    const errorFrame = waitForJsonMessage(
      socket,
      (data) =>
        data.error === "Expected signal.text" &&
        data.clientMessageId === "client-send-1"
    );
    socket.send(
      JSON.stringify({
        type: "not-signal.text",
        data: {
          meta: {
            clientMessageId: "client-send-1",
          },
        },
      })
    );
    await expect(errorFrame).resolves.toMatchObject({
      error: "Expected signal.text",
      clientMessageId: "client-send-1",
    });
    socket.close(1000, "done");
  });
  it("omits invalid non-string clientMessageId values from websocket error frames", async () => {
    const spaceId = await createSpace();
    const socket = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileName: "Test User",
    });
    const errorFrame = waitForJsonMessage(
      socket,
      (data) =>
        data.error === "Expected signal.text" && !("clientMessageId" in data)
    );
    socket.send(
      JSON.stringify({
        type: "not-signal.text",
        data: {
          meta: {
            clientMessageId: 123,
          },
        },
      })
    );
    await expect(errorFrame).resolves.toEqual({
      error: "Expected signal.text",
    });
    socket.close(1000, "done");
  });
  it("lists the creator in the space members snapshot", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-1",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace({ name: "members-room" }, creatorProfile);
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      summary?: {
        totalCount?: number;
        humanCount?: number;
        agentCount?: number;
        liveNowCount?: number;
        checkingAgentCount?: number;
        offlineAgentCount?: number;
        unavailableAgentCount?: number;
        wakeableAgentCount?: number;
      };
      humans?: Array<{
        profileId?: string;
        memberSource?: string;
        memberSourceLabel?: string;
        ownerUserId?: string | null;
        ownerName?: string | null;
      }>;
      agents?: unknown[];
    };
    expect(payload.summary).toEqual({
      totalCount: 1,
      humanCount: 1,
      agentCount: 0,
      liveNowCount: 0,
      checkingAgentCount: 0,
      offlineAgentCount: 0,
      unavailableAgentCount: 0,
      wakeableAgentCount: 0,
    });
    expect(payload.humans).toEqual([
      expect.objectContaining({
        profileId: SECOND_HUMAN_PROFILE_ID,
        memberSource: "space_creator",
        memberSourceLabel: "Creator",
        ownerUserId: "owner-members-creator-1",
      }),
    ]);
    expect(payload.agents).toEqual([]);
  });
  it("deletes personal Direct Message history without erasing the other member's history", async () => {
    const organizationId = "org-personal-history-deletion";
    const first = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human" as const,
      profileName: "Avery",
      ownerUserId: "personal-history-avery",
    };
    const second = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human" as const,
      profileName: "Jordan",
      ownerUserId: "personal-history-jordan",
    };
    for (const profile of [first, second]) {
      await ensureTestOrganizationMembership({
        organizationId,
        userId: profile.ownerUserId,
      });
    }
    const context = createRpcContext({
      ...first,
      activeOrganizationId: organizationId,
      requestId: "personal-delete",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      spaceId,
      organizationId,
      pairKey: `${first.profileId}:${second.profileId}`,
      purpose: "openmeld_dm_space",
      visibility: "private",
      guide: "",
      name: "Jordan",
      creator: {
        kind: "human",
        profileId: first.profileId,
        profileName: first.profileName,
        ownerUserId: first.ownerUserId,
      },
    });
    await stub.rpcPostMembers({
      spaceId,
      context,
      members: [first, second].map((profile) => ({
        profileId: profile.profileId,
        profileKind: profile.profileKind,
        profileName: profile.profileName,
        ownerUserId: profile.ownerUserId,
        ownerName: profile.profileName,
        agentControllerRef: null,
      })),
    });
    const request = (path: string, profile = first, init?: RequestInit) =>
      fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/${path}`,
        init,
        profile,
        { activeOrganizationId: organizationId }
      );
    const post = async (text: string) => {
      const response = await request("signals", second, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: second.profileId,
            profileName: second.profileName,
          },
          type: "signal.text",
          data: { text },
        }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as SignalEnvelope;
    };
    const old = await post("Original invoice discussion");
    const threadResponse = await request("threads", first, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rootSignalId: old.id,
        clientMutationId: randomUUID(),
      }),
    });
    expect(threadResponse.status).toBe(200);
    const thread = (await threadResponse.json()) as {
      thread: { threadId: string };
    };
    const deletion = await stub.rpcDeleteConversationForMe({
      spaceId,
      context,
    });
    expect(
      await (
        await request("signals?includePersonalHistoryBoundary=true")
      ).json()
    ).toMatchObject({
      signals: [],
      personalHistoryDeletedAt: deletion.deletedAt,
    });
    expect(await (await request("signals")).json()).not.toHaveProperty(
      "personalHistoryDeletedAt"
    );
    expect(
      (await request(`updates?afterSignalId=${old.id}&limit=20`)).status
    ).toBe(404);
    expect((await (await request("signals")).json()) as unknown).toMatchObject({
      signals: [],
    });
    expect(
      (await (await request("signals?q=invoice")).json()) as unknown
    ).toMatchObject({ signals: [] });
    expect(
      (
        await request(
          `signals?aroundSignalId=${old.id}&beforeCount=1&afterCount=1`
        )
      ).status
    ).toBe(404);
    expect((await request(`threads/${thread.thread.threadId}`)).status).toBe(
      404
    );
    expect(
      (await stub.rpcGetHistoryNavigation({ spaceId, context })).entries
    ).toEqual([]);
    expect(
      JSON.stringify(await (await request("signals", second)).json())
    ).toContain("Original invoice discussion");
    await post("New invoice discussion");
    const fresh = JSON.stringify(await (await request("signals")).json());
    expect(fresh).toContain("New invoice discussion");
    expect(fresh).not.toContain("Original invoice discussion");
    expect(
      (
        await request(
          `signals?aroundSignalId=${old.id}&beforeCount=1&afterCount=1`
        )
      ).status
    ).toBe(404);
    const search = JSON.stringify(
      await (await request("signals?q=invoice")).json()
    );
    expect(search).toContain("New invoice discussion");
    expect(search).not.toContain("Original invoice discussion");
    expect(
      JSON.stringify(await (await request("signals", second)).json())
    ).toContain("Original invoice discussion");
  });
  it("never reuses a retained signal position after retention empties history", async () => {
    const spaceId = await createSpace({ name: "Signal retention boundary" });
    await postTextSignal(spaceId, "Before retention");
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const before = await runInDurableObject(stub, (_instance, state) => {
      const position = state.storage.sql
        .exec<{ position: number }>(
          "SELECT MAX(rowid) AS position FROM space_signals"
        )
        .one().position;
      state.storage.sql.exec("DELETE FROM space_signals");
      return position;
    });
    await postTextSignal(spaceId, "After retention");
    const after = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ position: number }>(
            "SELECT MAX(rowid) AS position FROM space_signals"
          )
          .one().position
    );
    expect(after).toBeGreaterThan(before);
  });
  it("previews Organization-public history without joining or granting write access", async () => {
    const host: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Host",
      ownerUserId: "preview-host",
    };
    const viewer: Partial<TestAuthProfile> = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Colleague",
      ownerUserId: "preview-colleague",
    };
    const spaceId = await createSpace(
      {
        name: "Preview history",
        visibility: "public",
        accessMode: "members_only",
      },
      host
    );
    const posted = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: SECOND_HUMAN_PROFILE_ID,
            profileName: "Host",
          },
          type: "signal.text",
          data: { text: "Planning is ready for review." },
        }),
      },
      host
    );
    expect(posted.status).toBe(200);
    for (const path of ["meta", "status", "signals", "members", "threads"]) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/${path}`,
        undefined,
        viewer
      );
      expect(response.status, path).toBe(200);
      if (path === "signals") {
        expect(JSON.stringify(await response.json())).toContain(
          "Planning is ready for review."
        );
      } else {
        await response.json();
      }
    }
    const blocked = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: THIRD_HUMAN_PROFILE_ID,
            profileName: "Colleague",
          },
          type: "signal.text",
          data: { text: "Must not publish" },
        }),
      },
      viewer
    );
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "space.membership_required",
    });
    const stream = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/stream`,
      { headers: { Upgrade: "websocket" } },
      viewer
    );
    expect(stream.status).toBe(403);
    const members = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      host
    );
    await expect(members.json()).resolves.toMatchObject({
      summary: { totalCount: 1 },
    });
    const privateId = await createSpace(
      { visibility: "private", accessMode: "members_only" },
      host
    );
    const hidden = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${privateId}/signals`,
      undefined,
      viewer
    );
    expect(hidden.status).toBe(403);
  });
  it("preserves activity errors and marks joined profiles live", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-2",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const joinerProfile: Partial<TestAuthProfile> = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Joined Human",
      ownerUserId: "owner-members-joiner-1",
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "members-live-room" },
      creatorProfile
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const space = namespace.get(namespace.idFromString(spaceId));
    await expect(
      Promise.resolve(
        space.rpcRecordMemberWebActivity({
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          profileId: THIRD_HUMAN_PROFILE_ID,
          userId: "owner-members-joiner-1",
          lastActiveAt: new Date().toISOString(),
        })
      )
    ).rejects.toThrow(ACTIVITY_FORBIDDEN_RPC_ERROR_REGEX);
    await expect(
      Promise.resolve(space.rpcRecordMemberWebActivity({}))
    ).rejects.toThrow(ACTIVITY_INVALID_RPC_ERROR_REGEX);
    const socket = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: THIRD_HUMAN_PROFILE_ID,
        profileName: "Joined Human",
      },
      undefined,
      joinerProfile
    );
    await space.rpcRecordMemberWebActivity({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: THIRD_HUMAN_PROFILE_ID,
      userId: "owner-members-joiner-1",
      lastActiveAt: new Date().toISOString(),
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      summary?: {
        totalCount?: number;
        liveNowCount?: number;
      };
      humans?: Array<{
        profileId?: string;
        memberSource?: string;
        liveNow?: boolean;
        ownerUserId?: string | null;
        ownerName?: string | null;
      }>;
    };
    expect(payload.summary?.totalCount).toBe(2);
    expect(payload.summary?.liveNowCount).toBe(1);
    expect(payload.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: THIRD_HUMAN_PROFILE_ID,
          memberSource: "joined_directly",
          liveNow: true,
          ownerUserId: "owner-members-joiner-1",
        }),
      ])
    );
    socket.close(1000, "done");
  });
  it("adds resolved members through POST /members and keeps the add source", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-3",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "members-add-room" },
      creatorProfile
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileName: "Added Human",
              profileKind: "human",
              ownerUserId: null,
              ownerName: null,
              agentControllerRef: null,
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addResponse.status).toBe(200);
    const addPayload = (await addResponse.json()) as {
      addedMemberIds?: string[];
      alreadyMemberIds?: string[];
      items?: Array<{
        profileId?: string;
        memberSource?: string;
        memberSourceLabel?: string;
      }>;
    };
    expect(addPayload.addedMemberIds).toEqual([THIRD_HUMAN_PROFILE_ID]);
    expect(addPayload.alreadyMemberIds).toEqual([]);
    expect(addPayload.items).toEqual([
      expect.objectContaining({
        profileId: THIRD_HUMAN_PROFILE_ID,
        memberSource: "added_by_member",
        memberSourceLabel: "Added by Space Host",
      }),
    ]);
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    const listPayload = (await listResponse.json()) as {
      summary?: {
        totalCount?: number;
        humanCount?: number;
      };
      humans?: Array<{
        profileId?: string;
        memberSource?: string;
      }>;
    };
    expect(listPayload.summary?.totalCount).toBe(2);
    expect(listPayload.summary?.humanCount).toBe(2);
    expect(listPayload.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: THIRD_HUMAN_PROFILE_ID,
          memberSource: "added_by_member",
        }),
      ])
    );
  });
  it("enforces invite-only link joining at the member admission boundary", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-invite-only-host",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const outsiderProfile: Partial<TestAuthProfile> = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Outside Visitor",
      ownerUserId: "owner-invite-only-outsider",
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "invite-only-link-room" },
      ownerProfile
    );
    const guestAccessResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowGuests: true }),
      },
      ownerProfile
    );
    expect(guestAccessResponse.status).toBe(200);
    await guestAccessResponse.json();
    const joinBody = JSON.stringify({
      members: [
        {
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileName: "Outside Visitor",
          profileKind: "human",
          ownerUserId: "owner-invite-only-outsider",
          ownerName: "Outside Visitor",
          agentControllerRef: null,
        },
      ],
    });
    const blocked = await fetchSpaceDoWithOpenMeldAuth(
      { path: "/members", spaceId },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: joinBody,
      },
      outsiderProfile
    );
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "space.membership_required",
    });
    const enableLinkJoin = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/access-mode`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessMode: "public",
          linkJoinPolicy: "access_mode",
        }),
      },
      ownerProfile
    );
    expect(enableLinkJoin.status).toBe(200);
    await enableLinkJoin.json();
    const admitted = await fetchSpaceDoWithOpenMeldAuth(
      { path: "/members", spaceId },
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: joinBody,
      },
      outsiderProfile
    );
    expect(admitted.status).toBe(200);
    await expect(admitted.json()).resolves.toMatchObject({
      addedMemberIds: [THIRD_HUMAN_PROFILE_ID],
    });
  });
  it("atomically requires actor membership for protected member batches", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-protected",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "protected-members-room", visibility: "public" },
      creatorProfile
    );
    await expect(
      rpcAddSpaceMembers(env as CoreBindings, {
        context: createRpcContext({
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Unjoined Member",
          requestId: "req-protected-member-batch",
          ownerUserId: "owner-members-unjoined",
        }),
        members: [
          {
            agentControllerRef: null,
            ownerName: "Test User",
            ownerUserId: "owner-test-default",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileKind: "human",
            profileName: "Test User",
          },
        ],
        requireActorMembership: true,
        spaceId,
      })
    ).rejects.toThrow(MEMBERSHIP_REQUIRED_RPC_ERROR_REGEX);
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    const listPayload = (await listResponse.json()) as {
      summary?: {
        totalCount?: number;
      };
      humans?: Array<{
        profileId?: string;
      }>;
    };
    expect(listPayload.summary?.totalCount).toBe(1);
    expect(listPayload.humans).toEqual([
      expect.objectContaining({ profileId: SECOND_HUMAN_PROFILE_ID }),
    ]);
  });
  it("rejects direct HTTP member adds for Center Agent Direct Messages", async () => {
    const organizationId = "org-center-agent-dm-http-members";
    const memberProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Center Agent DM Member",
      ownerUserId: "owner-ca-dm-http-member",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-ca-dm-http-member",
    });
    await ensureTestCenterAgentDesignation({
      agentProfileId: centerAgentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId: "owner-ca-dm-http-agent",
    });
    const opened = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      {
        context: createRpcContext({
          activeOrganizationId: organizationId,
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Center Agent DM Member",
          requestId: "req-ca-dm-http-member-add",
          ownerUserId: "owner-ca-dm-http-member",
        }),
      }
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${opened.spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileName: "Added Human",
              profileKind: "human",
              ownerUserId: null,
              ownerName: null,
              agentControllerRef: null,
            },
          ],
        }),
      },
      memberProfile,
      { activeOrganizationId: organizationId }
    );
    expect(addResponse.status).toBe(403);
    await expect(addResponse.json()).resolves.toMatchObject({
      error: {
        code: "space.forbidden",
        message: "Center Agent Direct Messages cannot add additional members.",
      },
    });
  });
  it.each([
    false,
    true,
  ])("requires confirmation before an ordinary Direct Message becomes a members-only Space (member snapshots: %s)", async (includeMemberSnapshots) => {
    const organizationId = "org-direct-message-conversion";
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "DM Creator",
      ownerUserId: "owner-dm-conversion-creator",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-dm-conversion-creator",
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "DM Creator",
      requestId: "req-dm-conversion",
      ownerUserId: "owner-dm-conversion-creator",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      creator: {
        kind: "human",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileName: "DM Creator",
        ownerUserId: "owner-dm-conversion-creator",
        ownerName: "DM Creator",
      },
      guide: "",
      name: "DM Creator and Test User",
      organizationId,
      pairKey: `${DEFAULT_HUMAN_PROFILE_ID}:${SECOND_HUMAN_PROFILE_ID}`,
      purpose: "openmeld_dm_space",
      spaceId,
      visibility: "private",
    });
    await stub.rpcPostMembers({
      context,
      members: [
        {
          agentControllerRef: null,
          ownerName: "DM Creator",
          ownerUserId: "owner-dm-conversion-creator",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "DM Creator",
        },
        {
          agentControllerRef: null,
          ownerName: "Test User",
          ownerUserId: "owner-test-default",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Test User",
        },
      ],
      spaceId,
    });
    const outsiderStatusResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`,
      undefined,
      {
        profileId: FOURTH_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Outside Member",
        ownerUserId: "owner-dm-conversion-outsider",
        openMeldProfileId: FOURTH_HUMAN_PROFILE_ID,
      },
      { activeOrganizationId: organizationId }
    );
    expect(outsiderStatusResponse.status).toBe(403);
    await expect(outsiderStatusResponse.json()).resolves.toMatchObject({
      code: "space.membership_required",
    });
    const unconfirmedAddResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              agentControllerRef: null,
              ownerName: "Third Member",
              ownerUserId: "owner-dm-conversion-third",
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileKind: "human",
              profileName: "Third Member",
            },
          ],
        }),
      },
      creatorProfile,
      { activeOrganizationId: organizationId }
    );
    expect(unconfirmedAddResponse.status).toBe(409);
    await expect(unconfirmedAddResponse.json()).resolves.toMatchObject({
      code: "direct_message.conversion_required",
    });
    const sameOwnerDifferentHumanContext = createRpcContext({
      activeOrganizationId: organizationId,
      profileId: FOURTH_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Another Human Profile",
      requestId: "req-dm-conversion-same-owner-different-profile",
      ownerUserId: "owner-dm-conversion-creator",
    });
    const sameOwnerDifferentHumanError = await runInDurableObject(
      stub,
      async (instance) => {
        try {
          await instance.rpcConvertDirectMessageToSpace({
            context: sameOwnerDifferentHumanContext,
            members: [
              {
                agentControllerRef: null,
                ownerName: "Third Member",
                ownerUserId: "owner-dm-conversion-third",
                profileId: THIRD_HUMAN_PROFILE_ID,
                profileKind: "human",
                profileName: "Third Member",
              },
            ],
            name: "Must not convert through another profile",
            spaceId,
          });
          return null;
        } catch (error) {
          return {
            code: (
              error as {
                code?: unknown;
              }
            ).code,
            status: (
              error as {
                status?: unknown;
              }
            ).status,
          };
        }
      }
    );
    expect(sameOwnerDifferentHumanError).toEqual({
      code: "space.membership_required",
      status: 403,
    });
    const converted = await stub.rpcConvertDirectMessageToSpace({
      context,
      includeMemberSnapshots,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Third Member",
          ownerUserId: "owner-dm-conversion-third",
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Third Member",
        },
      ],
      name: "DM Creator, Test User, and Third Member",
      spaceId,
    });
    expect(converted).toMatchObject({
      accessMode: "members_only",
      addedMemberIds: [THIRD_HUMAN_PROFILE_ID],
      name: "DM Creator, Test User, and Third Member",
      spaceId,
    });
    const status = await stub.rpcGetStatus({ context, spaceId });
    if (includeMemberSnapshots) {
      expect(converted.items).toEqual([
        expect.objectContaining({
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Third Member",
          status: "active",
          addedAt: converted.convertedAt,
        }),
      ]);
    } else {
      expect(converted).not.toHaveProperty("items");
    }
    expect(status).toMatchObject({
      accessMode: "members_only",
      directMessageConvertedAt: converted.convertedAt,
      members: { totalCount: 3 },
    });
    const secondConversionError = await runInDurableObject(
      stub,
      async (instance) => {
        try {
          await instance.rpcConvertDirectMessageToSpace({
            context,
            members: [],
            name: "Should not convert twice",
            spaceId,
          });
          return null;
        } catch (error) {
          return {
            code: (
              error as {
                code?: unknown;
              }
            ).code,
            status: (
              error as {
                status?: unknown;
              }
            ).status,
          };
        }
      }
    );
    expect(secondConversionError).toEqual({
      code: "direct_message.conversion_required",
      status: 409,
    });
  });
  it("requires confirmation when one Direct Message member adds two people at once", async () => {
    const organizationId = "org-direct-message-batch-conversion";
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "DM Creator",
      ownerUserId: "owner-dm-batch-conversion-creator",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-dm-batch-conversion-creator",
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "DM Creator",
      requestId: "req-dm-batch-conversion",
      ownerUserId: "owner-dm-batch-conversion-creator",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      creator: {
        kind: "human",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileName: "DM Creator",
        ownerUserId: "owner-dm-batch-conversion-creator",
        ownerName: "DM Creator",
      },
      guide: "",
      name: "DM Creator",
      organizationId,
      pairKey: `${DEFAULT_HUMAN_PROFILE_ID}:${SECOND_HUMAN_PROFILE_ID}`,
      purpose: "openmeld_dm_space",
      spaceId,
      visibility: "private",
    });
    await stub.rpcPostMembers({
      context,
      members: [
        {
          agentControllerRef: null,
          ownerName: "DM Creator",
          ownerUserId: "owner-dm-batch-conversion-creator",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "DM Creator",
        },
      ],
      spaceId,
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              agentControllerRef: null,
              ownerName: "Test User",
              ownerUserId: "owner-test-default",
              profileId: DEFAULT_HUMAN_PROFILE_ID,
              profileKind: "human",
              profileName: "Test User",
            },
            {
              agentControllerRef: null,
              ownerName: "Third Member",
              ownerUserId: "owner-dm-batch-conversion-third",
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileKind: "human",
              profileName: "Third Member",
            },
          ],
        }),
      },
      creatorProfile,
      { activeOrganizationId: organizationId }
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "direct_message.conversion_required",
    });
    const status = await stub.rpcGetStatus({ context, spaceId });
    expect(status).toMatchObject({ members: { totalCount: 1 } });
    expect(status.directMessageConvertedAt).toBeUndefined();
  });

  it("keeps two-Agent DMs private, retries one message, and admits both owners through explicit conversion", async () => {
    const organizationId = "org-two-agent-dm";
    const firstAgent = "agt_59595959-5959-4595-8595-595959595959";
    const secondAgent = "agt_60606060-6060-4060-8060-606060606060";
    const pairKey = [firstAgent, secondAgent].sort().join(":");
    const agents = [
      {
        profileId: firstAgent,
        profileKind: "agent" as const,
        profileName: "Writer",
        ownerUserId: "dm-writer-owner",
        ownerName: "Writer Owner",
        agentControllerRef: "builtin:codex",
      },
      {
        profileId: secondAgent,
        profileKind: "agent" as const,
        profileName: "Reviewer",
        ownerUserId: "dm-reviewer-owner",
        ownerName: "Reviewer Owner",
        agentControllerRef: "builtin:codex",
      },
    ];
    for (const agent of agents) {
      await ensureTestOrganizationMembership({
        organizationId,
        userId: agent.ownerUserId,
      });
      await insertTestOrganizationAgentProfile({
        organizationId,
        agentProfileId: agent.profileId,
        ownerUserId: agent.ownerUserId,
      });
    }
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: "dm-writer-owner",
      profileId: firstAgent,
      profileKind: "agent",
      profileName: "Writer",
      requestId: "dm-writer",
    });
    const ownerContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: "dm-reviewer-owner",
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Reviewer Owner",
      requestId: "dm-reader",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const opened = await rpcOpenDirectMessageSpace(env as CoreBindings, {
      context,
      targetProfileId: secondAgent,
      message: {
        clientMessageId: "00000000-0000-4000-8000-000000000077",
        text: "The review is ready.",
        wake: false,
      },
    });
    const spaceId = opened.spaceId;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const message = {
      spaceId,
      organizationId,
      pairKey,
      context,
      authoringPolicy: "user_authored" as const,
      profile: {
        kind: "agent" as const,
        profileId: firstAgent,
        profileName: "Writer",
      },
      clientMessageId: "00000000-0000-4000-8000-000000000077",
      meta: { clientMessageId: "00000000-0000-4000-8000-000000000077" },
      text: "The review is ready.",
      messageEnvelope: {
        text: "The review is ready.",
        activationTargets: [],
        referenceTargets: [secondAgent],
      },
    };
    expect(opened.signal?.profile.profileId).toBe(firstAgent);
    expect((await stub.rpcPostDirectMessageSignal(message)).id).toBe(
      opened.signal?.id
    );
    const conflict = await stub
      .rpcPostDirectMessageSignal({ ...message, text: "Different work" })
      .then(
        () => null,
        (error: Error) => error.message
      );
    expect(conflict).toContain("direct_message.message_conflict");
    await expect(
      stub.rpcGetStatus({ context: ownerContext, spaceId })
    ).resolves.toMatchObject({ members: { totalCount: 2 } });
    const readOnlyError = await stub
      .rpcPostSignal({
        ...message,
        context: ownerContext,
        profile: {
          kind: "human",
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileName: "Reviewer Owner",
        },
      })
      .then(
        () => null,
        (error: Error) => error.message
      );
    expect(readOnlyError).toContain("space.access.read_only");
    const clientMessageId = "00000000-0000-4000-8000-000000000078";
    await expect(
      rpcPostSpaceWakeStop(env as CoreBindings, {
        context,
        spaceId,
        body: {
          target: {
            by: "client_message",
            clientMessageId,
            targetProfileId: secondAgent,
          },
        },
      })
    ).resolves.toMatchObject({ status: "cancelled" });
    const pinnedRequest = {
      context,
      spaceId,
      targetProfileId: secondAgent,
      message: { clientMessageId, text: "Please review this.", wake: true },
    };
    const stoppedSend = await rpcOpenDirectMessageSpace(
      env as CoreBindings,
      pinnedRequest
    );
    expect(stoppedSend.spaceId).toBe(spaceId);
    expect(stoppedSend.signal?.profile.profileId).toBe(firstAgent);
    await expect(
      rpcGetSpaceWakeProgress(env as CoreBindings, {
        context,
        spaceId,
        clientMessageId,
      })
    ).resolves.toMatchObject({
      items: [{ targetProfileId: secondAgent, phase: "stopped" }],
    });
    const wrongOrganization = await stub
      .rpcPostDirectMessageSignal({
        ...message,
        organizationId: "another-org",
      })
      .then(
        () => null,
        (error: Error) => error.message
      );
    expect(wrongOrganization).toContain("direct_message.conversation_changed");
    const converted = await stub.rpcConvertDirectMessageToSpace({
      context: ownerContext,
      spaceId,
      name: "Review team",
      members: [
        {
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Writer Owner",
          ownerUserId: "dm-writer-owner",
          ownerName: "Writer Owner",
          agentControllerRef: null,
        },
        {
          profileId: THIRD_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Reviewer Owner",
          ownerUserId: "dm-reviewer-owner",
          ownerName: "Reviewer Owner",
          agentControllerRef: null,
        },
      ],
    });
    expect(converted.addedMemberIds.sort()).toEqual(
      [SECOND_HUMAN_PROFILE_ID, THIRD_HUMAN_PROFILE_ID].sort()
    );
    const convertedError = await stub.rpcPostDirectMessageSignal(message).then(
      () => null,
      (error: Error) => error.message
    );
    expect(convertedError).toContain("direct_message.conversion_required");
    await expect(
      rpcOpenDirectMessageSpace(env as CoreBindings, pinnedRequest)
    ).rejects.toThrow("direct_message.conversion_required");
  });

  it("keeps an Agent owner read-only until they explicitly join and convert the Direct Message", async () => {
    const organizationId = "org-agent-owner-observer";
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-dm-participant",
    });
    const participantProfileId = SECOND_HUMAN_PROFILE_ID;
    const agentProfileId = "agt_55555555-5555-4555-8555-555555555555";
    const ownerHumanProfileId = THIRD_HUMAN_PROFILE_ID;
    const participantContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: "owner-dm-participant",
      profileId: participantProfileId,
      profileKind: "human",
      profileName: "Participant",
      requestId: "req-agent-owner-observer-participant",
    });
    const ownerContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: "owner-dm-agent",
      profileId: ownerHumanProfileId,
      profileKind: "human",
      profileName: "Agent Owner",
      requestId: "req-agent-owner-observer-owner",
    });
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-dm-agent",
    });
    await insertTestOrganizationAgentProfile({
      agentProfileId,
      organizationId,
      ownerUserId: "owner-dm-agent",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      creator: {
        kind: "human",
        ownerName: "Participant",
        ownerUserId: "owner-dm-participant",
        profileId: participantProfileId,
        profileName: "Participant",
      },
      guide: "",
      name: "Participant and Research Agent",
      organizationId,
      pairKey: `${participantProfileId}:${agentProfileId}`,
      purpose: "openmeld_dm_space",
      spaceId,
      visibility: "private",
    });
    await stub.rpcPostMembers({
      context: participantContext,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Participant",
          ownerUserId: "owner-dm-participant",
          profileId: participantProfileId,
          profileKind: "human",
          profileName: "Participant",
        },
        {
          agentControllerRef: "builtin:codex",
          ownerName: "Agent Owner",
          ownerUserId: "owner-dm-agent",
          profileId: agentProfileId,
          profileKind: "agent",
          profileName: "Research Agent",
        },
      ],
      spaceId,
    });
    await expect(
      stub.rpcGetStatus({ context: ownerContext, spaceId })
    ).resolves.toMatchObject({
      members: { totalCount: 2 },
      spacePurpose: "openmeld_dm_space",
    });
    const ownerSpaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: ownerContext,
      spaceId,
    });
    await expect(
      stub.rpcListSpaceFiles({ spaceAccess: ownerSpaceAccess, spaceId })
    ).resolves.toBeDefined();
    const readOnlyFileWriteError = await stub
      .rpcCreateSpaceFolder({
        body: {
          clientMutationId: "agent-owner-read-only-folder",
          name: "Should not be created",
        },
        spaceAccess: ownerSpaceAccess,
        spaceId,
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect((readOnlyFileWriteError as Error).message).toContain(
      "space.access.read_only"
    );
    const readOnlyWriteError = await stub
      .rpcPostSignal({
        authoringPolicy: "user_authored",
        context: ownerContext,
        profile: {
          kind: "human",
          profileId: ownerHumanProfileId,
          profileName: "Agent Owner",
        },
        spaceId,
        text: "I should not be able to write yet",
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(readOnlyWriteError).toBeInstanceOf(Error);
    expect((readOnlyWriteError as Error).message).toContain(
      "space.access.read_only"
    );
    const invalidConversionError = await runInDurableObject(
      stub,
      async (instance) => {
        try {
          await instance.rpcConvertDirectMessageToSpace({
            context: ownerContext,
            members: [
              {
                agentControllerRef: null,
                ownerName: "Someone Else",
                ownerUserId: "owner-someone-else",
                profileId: FOURTH_HUMAN_PROFILE_ID,
                profileKind: "human",
                profileName: "Someone Else",
              },
            ],
            name: "Invalid owner conversion",
            spaceId,
          });
          return null;
        } catch (error) {
          return {
            code: (
              error as {
                code?: unknown;
              }
            ).code,
            status: (
              error as {
                status?: unknown;
              }
            ).status,
          };
        }
      }
    );
    expect(invalidConversionError).toEqual({
      code: "space.membership_required",
      status: 403,
    });
    const converted = await stub.rpcConvertDirectMessageToSpace({
      context: ownerContext,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Agent Owner",
          ownerUserId: "owner-dm-agent",
          profileId: ownerHumanProfileId,
          profileKind: "human",
          profileName: "Agent Owner",
        },
      ],
      name: "Participant, Agent Owner, and Research Agent",
      spaceId,
    });
    expect(converted.addedMemberIds).toEqual([ownerHumanProfileId]);
    await expect(
      stub.rpcPostSignal({
        authoringPolicy: "user_authored",
        context: ownerContext,
        profile: {
          kind: "human",
          profileId: ownerHumanProfileId,
          profileName: "Agent Owner",
        },
        spaceId,
        text: "I can participate after joining",
      })
    ).resolves.toMatchObject({
      data: { text: "I can participate after joining" },
    });
    const blockedLeaveError = await stub
      .rpcLeaveSpace({ context: ownerContext, spaceId })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect((blockedLeaveError as Error).message).toContain(
      "space.agent_owner_membership_required"
    );
    const blockedRemovalError = await stub
      .rpcRemoveMembers({
        context: participantContext,
        memberProfileIds: [ownerHumanProfileId],
        spaceId,
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect((blockedRemovalError as Error).message).toContain(
      "space.agent_owner_membership_required"
    );
    await expect(
      stub.rpcRemoveMembers({
        context: participantContext,
        memberProfileIds: [agentProfileId],
        spaceId,
      })
    ).resolves.toMatchObject({ removedMemberIds: [agentProfileId] });
    const membersAfterAgentRemoval = await stub.rpcGetMembers({
      context: ownerContext,
      spaceId,
    });
    expect(membersAfterAgentRemoval.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: ownerHumanProfileId,
          status: "active",
        }),
      ])
    );
    await expect(
      stub.rpcLeaveSpace({ context: ownerContext, spaceId })
    ).resolves.toMatchObject({ leftProfileId: ownerHumanProfileId });
  });
  it("reconciles an existing Agent owner after another member converts the Direct Message", async () => {
    const organizationId = "org-agent-owner-member-conversion";
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-member-conversion-participant",
    });
    const participantProfileId = SECOND_HUMAN_PROFILE_ID;
    const agentProfileId = "agt_58585858-5858-4585-8585-585858585858";
    const ownerHumanProfileId = THIRD_HUMAN_PROFILE_ID;
    const addedHumanProfileId = FOURTH_HUMAN_PROFILE_ID;
    const participantContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: "owner-member-conversion-participant",
      profileId: participantProfileId,
      profileKind: "human",
      profileName: "Participant",
      requestId: "req-agent-owner-member-conversion",
    });
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-member-conversion-agent",
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId: "owner-member-conversion-agent",
      profileId: ownerHumanProfileId,
    });
    await insertTestOrganizationAgentProfile({
      agentProfileId,
      organizationId,
      ownerUserId: "owner-member-conversion-agent",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const spaceId = namespace.newUniqueId().toString();
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcInitializeDirectMessageMeta({
      creator: {
        kind: "human",
        ownerName: "Participant",
        ownerUserId: "owner-member-conversion-participant",
        profileId: participantProfileId,
        profileName: "Participant",
      },
      guide: "",
      name: "Participant and Research Agent",
      organizationId,
      pairKey: `${participantProfileId}:${agentProfileId}`,
      purpose: "openmeld_dm_space",
      spaceId,
      visibility: "private",
    });
    await stub.rpcPostMembers({
      context: participantContext,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Participant",
          ownerUserId: "owner-member-conversion-participant",
          profileId: participantProfileId,
          profileKind: "human",
          profileName: "Participant",
        },
        {
          agentControllerRef: "builtin:codex",
          ownerName: "Agent Owner",
          ownerUserId: "owner-member-conversion-agent",
          profileId: agentProfileId,
          profileKind: "agent",
          profileName: "Research Agent",
        },
      ],
      spaceId,
    });
    await stub.rpcGetStatus({ context: participantContext, spaceId });
    await stub.rpcConvertDirectMessageToSpace({
      context: participantContext,
      members: [
        {
          agentControllerRef: null,
          ownerName: "Added Member",
          ownerUserId: "owner-member-conversion-added",
          profileId: addedHumanProfileId,
          profileKind: "human",
          profileName: "Added Member",
        },
      ],
      name: "Participant, Research Agent, and Added Member",
      spaceId,
    });
    const members = await stub.rpcGetMembers({
      context: participantContext,
      spaceId,
    });
    expect(members.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: ownerHumanProfileId,
          status: "active",
        }),
      ])
    );
    expect(members.summary).toMatchObject({
      agentCount: 1,
      humanCount: 3,
      totalCount: 4,
    });
  });
  it("reconciles ordinary Agent owners into existing Spaces without adding managed Agent owners", async () => {
    const organizationId = "org-agent-owner-reconciliation";
    const participantOwnerUserId = "owner-reconciliation-participant";
    const ordinaryAgentOwnerUserId = "owner-reconciliation-agent";
    const managedAgentOwnerUserId = "owner-reconciliation-managed-agent";
    const participantProfileId = SECOND_HUMAN_PROFILE_ID;
    const ordinaryAgentProfileId = "agt_66666666-6666-4666-8666-666666666666";
    const managedAgentProfileId = "agt_77777777-7777-4777-8777-777777777777";
    const ownerHumanProfileId = FOURTH_HUMAN_PROFILE_ID;
    const participantContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: participantOwnerUserId,
      profileId: participantProfileId,
      profileKind: "human",
      profileName: "Participant",
      requestId: "req-agent-owner-reconciliation-participant",
    });
    const ownerContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: ordinaryAgentOwnerUserId,
      profileId: ownerHumanProfileId,
      profileKind: "human",
      profileName: "Fresh Owner",
      requestId: "req-agent-owner-reconciliation-owner",
    });
    for (const userId of [
      participantOwnerUserId,
      ordinaryAgentOwnerUserId,
      managedAgentOwnerUserId,
    ]) {
      await ensureTestOrganizationMembership({ organizationId, userId });
    }
    await insertTestPrimaryHumanProfile({
      ownerUserId: ordinaryAgentOwnerUserId,
      profileId: ownerHumanProfileId,
    });
    await insertTestOrganizationAgentProfile({
      agentProfileId: ordinaryAgentProfileId,
      organizationId,
      ownerUserId: ordinaryAgentOwnerUserId,
    });
    await ensureTestCenterAgentDesignation({
      agentProfileId: managedAgentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId: managedAgentOwnerUserId,
    });
    const created = await rpcCreateSpace(env as unknown as CoreBindings, {
      context: participantContext,
      name: "Existing Agent Space",
      visibility: "private",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(created.spaceId));
    await stub.rpcPostMembers({
      context: participantContext,
      members: [
        {
          agentControllerRef: "builtin:codex",
          ownerName: "Fresh Owner",
          ownerUserId: ordinaryAgentOwnerUserId,
          profileId: ordinaryAgentProfileId,
          profileKind: "agent",
          profileName: "Research Agent",
        },
        {
          agentControllerRef: "remote:openmeld-center-agent",
          ownerName: "Managed Agent Owner",
          ownerUserId: managedAgentOwnerUserId,
          profileId: managedAgentProfileId,
          profileKind: "agent",
          profileName: "Center Agent",
        },
      ],
      spaceId: created.spaceId,
    });
    const firstSnapshot = await stub.rpcGetMembers({
      context: ownerContext,
      spaceId: created.spaceId,
    });
    expect(firstSnapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerUserId: ordinaryAgentOwnerUserId,
          profileId: ownerHumanProfileId,
          status: "active",
        }),
      ])
    );
    expect(firstSnapshot.humans).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerUserId: managedAgentOwnerUserId }),
      ])
    );
    await expect(
      stub.rpcPostSignal({
        authoringPolicy: "user_authored",
        context: ownerContext,
        profile: {
          kind: "human",
          profileId: ownerHumanProfileId,
          profileName: "Fresh Owner",
        },
        spaceId: created.spaceId,
        text: "I can participate after the existing Space is reconciled",
      })
    ).resolves.toMatchObject({
      data: {
        text: "I can participate after the existing Space is reconciled",
      },
    });
    const secondSnapshot = await stub.rpcGetMembers({
      context: ownerContext,
      spaceId: created.spaceId,
    });
    expect(
      secondSnapshot.humans.filter(
        (human) => human.profileId === ownerHumanProfileId
      )
    ).toHaveLength(1);
  });
  it("rejects direct HTTP and Space DO mutations for Center Agent Direct Messages", async () => {
    const organizationId = "org-center-agent-dm-http-locked";
    const memberProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Center Agent DM Member",
      ownerUserId: "owner-ca-dm-http-locked-member",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const centerAgentProfileId = "agt_55555555-5555-4555-8555-555555555555";
    await ensureTestOrganizationMembership({
      organizationId,
      userId: "owner-ca-dm-http-locked-member",
    });
    await ensureTestCenterAgentDesignation({
      agentProfileId: centerAgentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId: "owner-ca-dm-http-locked-agent",
    });
    const opened = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      {
        context: createRpcContext({
          activeOrganizationId: organizationId,
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Center Agent DM Member",
          requestId: "req-ca-dm-http-locked",
          ownerUserId: "owner-ca-dm-http-locked-member",
        }),
      }
    );
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/members/remove`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              memberProfileIds: [SECOND_HUMAN_PROFILE_ID],
            }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot remove members.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchSpaceDoWithOpenMeldAuth(
          { path: "/leave", spaceId: opened.spaceId },
          { method: "POST" },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot be left.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}`,
          { method: "DELETE" },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot be deleted.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/access-mode`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              accessMode: "public_view_join_password",
              password: "join-password",
            }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change access settings.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/password`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "join-password" }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change access passwords.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/password`,
          { method: "DELETE" },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change access passwords.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/contract`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ publicationMode: "raw_context_sharing" }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change publication mode.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ guide: "Change the system guide." }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change metadata.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Renamed Center Agent DM" }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change metadata.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ purpose: "ordinary_space" }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change metadata.",
      status: 403,
    });
    await expect(
      readCenterAgentDirectMessageHttpForbidden(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${opened.spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ visibility: "public" }),
          },
          memberProfile,
          { activeOrganizationId: organizationId }
        )
      )
    ).resolves.toEqual({
      code: "space.forbidden",
      message: "Center Agent Direct Messages cannot change metadata.",
      status: 403,
    });
  });
  it("removes active members through POST /members/remove and hides them from snapshots", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-4",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "members-remove-room" },
      creatorProfile
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileName: "Added Human",
              profileKind: "human",
              ownerUserId: null,
              ownerName: null,
              agentControllerRef: null,
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addResponse.status).toBe(200);
    await addResponse.json();
    const messageResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: THIRD_HUMAN_PROFILE_ID,
            profileName: "Departing member",
          },
          type: "signal.text",
          data: { text: "Retain this shared work record after I leave." },
        }),
      },
      {
        profileId: THIRD_HUMAN_PROFILE_ID,
        openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
        profileKind: "human",
      }
    );
    expect(messageResponse.status).toBe(200);
    const retainedMessage = (await messageResponse.json()) as { id: string };
    const removeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [THIRD_HUMAN_PROFILE_ID, THIRD_HUMAN_PROFILE_ID],
        }),
      },
      creatorProfile
    );
    expect(removeResponse.status).toBe(200);
    const removePayload = (await removeResponse.json()) as {
      removedMemberIds?: string[];
      alreadyAbsentMemberIds?: string[];
    };
    expect(removePayload).toEqual({
      removedMemberIds: [THIRD_HUMAN_PROFILE_ID],
      alreadyAbsentMemberIds: [],
    });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      creatorProfile
    );
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({
          id: retainedMessage.id,
          data: expect.objectContaining({
            text: "Retain this shared work record after I leave.",
          }),
        }),
      ]),
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    const listPayload = (await listResponse.json()) as {
      humans?: Array<{
        profileId?: string;
      }>;
    };
    expect(listPayload.humans).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: THIRD_HUMAN_PROFILE_ID }),
      ])
    );
  });
  it("rejects member removal by a human who is not a Space owner", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-4b",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const targetProfileId = "44444444-4444-4444-8444-444444444444";
    const spaceId = await createSpace(
      { name: "members-remove-denied-room" },
      creatorProfile
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: targetProfileId,
              profileName: "Added Human",
              profileKind: "human",
              ownerUserId: "owner-members-target-4b",
              ownerName: "Target Owner",
              agentControllerRef: null,
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addResponse.status).toBe(200);
    await addResponse.json();
    const removeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [targetProfileId],
        }),
      },
      {
        profileId: "55555555-5555-4555-8555-555555555555",
        profileKind: "human",
        profileName: "Other Human",
        ownerUserId: "owner-members-other-4b",
        openMeldProfileId: "55555555-5555-4555-8555-555555555555",
      }
    );
    expect(removeResponse.status).toBe(403);
    const removePayload = (await removeResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(removePayload.code).toBe("space.forbidden");
    expect(removePayload.message).toBe(
      "Only a Space owner can manage members."
    );
  });
  it("rejects removing an active owner through POST /members/remove", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-members-creator-5",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "members-remove-creator-room" },
      creatorProfile
    );
    const operatorProfile: Partial<TestAuthProfile> = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Operator",
      ownerUserId: "owner-members-creator-5",
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
    };
    const addOperatorResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileName: "Operator",
              profileKind: "human",
              ownerUserId: "owner-members-creator-5",
              ownerName: "Operator Owner",
              agentControllerRef: null,
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addOperatorResponse.status).toBe(200);
    await addOperatorResponse.json();
    const removeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [SECOND_HUMAN_PROFILE_ID],
        }),
      },
      operatorProfile
    );
    expect(removeResponse.status).toBe(400);
    const removePayload = (await removeResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(removePayload.code).toBe("space.members.owner_forbidden");
    expect(removePayload.message).toContain("owner");
  });
  it("enforces space password on http routes and websocket stream", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: "hum-pass-owner-1",
      profileKind: "human",
      profileName: "Password Owner",
      ownerUserId: "owner-pass-owner-1",
      openMeldProfileId: "hum-pass-owner-1",
    };
    const creatorRuntimeProfileId = toCanonicalOpenMeldProfileId(
      creatorProfile.openMeldProfileId ?? creatorProfile.profileId ?? "",
      creatorProfile.profileKind ?? "human"
    );
    const protectedAgentProfile: Partial<TestAuthProfile> = {
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileKind: "agent",
      profileName: "Password Agent",
      ownerUserId: "owner-pass-agent-1",
      openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      agentControllerRef: "builtin:codex",
    };
    const protectedAgentProfileId = toCanonicalOpenMeldProfileId(
      protectedAgentProfile.openMeldProfileId ??
        protectedAgentProfile.profileId ??
        "",
      protectedAgentProfile.profileKind ?? "agent"
    );
    const sameOwnerAgentProfile: Partial<TestAuthProfile> = {
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
      profileName: "Same Owner Agent",
      ownerUserId: "owner-pass-owner-1",
      openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
      agentControllerRef: "builtin:codex",
    };
    const unrelatedProfile: Partial<TestAuthProfile> = {
      profileId: "agt_33333333-3333-4333-8333-333333333333",
      profileKind: "agent",
      profileName: "Unrelated Agent",
      ownerUserId: "owner-pass-unrelated-1",
      openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      agentControllerRef: "builtin:codex",
    };
    const createResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "password-space",
          visibility: "private",
          password: "abc123",
        }),
      },
      creatorProfile
    );
    expect(createResponse.status).toBe(200);
    const createPayload = (await createResponse.json()) as {
      spaceId?: string;
      meta?: {
        passwordProtected?: boolean;
      };
    };
    const spaceId = String(createPayload.spaceId ?? "");
    expect(SPACE_ID_HEX_REGEX.test(spaceId)).toBe(true);
    expect(createPayload.meta?.passwordProtected).toBe(true);
    const noPasswordMeta = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      creatorProfile
    );
    expect(noPasswordMeta.status).toBe(200);
    await noPasswordMeta.json();
    const wrongPasswordMeta = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      unrelatedProfile,
      { spacePassword: "wrong123" }
    );
    expect(wrongPasswordMeta.status).toBe(403);
    const wrongPasswordPayload = (await wrongPasswordMeta.json()) as {
      code?: string;
      message?: string;
    };
    expect(wrongPasswordPayload.code).toBe("space.password_invalid");
    expect(wrongPasswordPayload.message).toBe("space password invalid");
    const okMeta = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      unrelatedProfile,
      { spacePassword: "abc123" }
    );
    expect(okMeta.status).toBe(200);
    const okMetaPayload = (await okMeta.json()) as {
      passwordProtected?: boolean;
    };
    expect(okMetaPayload.passwordProtected).toBe(true);
    const noPasswordSignals = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      creatorProfile
    );
    expect(noPasswordSignals.status).toBe(200);
    await noPasswordSignals.json();
    const sameOwnerNoPasswordSignals = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      sameOwnerAgentProfile
    );
    expect(sameOwnerNoPasswordSignals.status).toBe(200);
    await sameOwnerNoPasswordSignals.json();
    const wrongPasswordSignals = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      unrelatedProfile,
      { spacePassword: "wrong123" }
    );
    expect(wrongPasswordSignals.status).toBe(403);
    const wrongPasswordSignalsPayload = (await wrongPasswordSignals.json()) as {
      code?: string;
    };
    expect(wrongPasswordSignalsPayload.code).toBe("space.password_invalid");
    const okSignals = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      unrelatedProfile,
      { spacePassword: "abc123" }
    );
    expect(okSignals.status).toBe(200);
    await okSignals.json();
    const noPasswordCursor = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${creatorRuntimeProfileId}`,
      undefined,
      creatorProfile
    );
    expect(noPasswordCursor.status).toBe(200);
    await noPasswordCursor.json();
    const addProtectedAgentMember = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: protectedAgentProfileId,
              profileName: "Password Agent",
              profileKind: "agent",
              ownerUserId: "owner-pass-agent-1",
              ownerName: null,
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addProtectedAgentMember.status).toBe(200);
    await addProtectedAgentMember.json();
    const activeMemberNoPasswordSignals = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      protectedAgentProfile
    );
    expect(activeMemberNoPasswordSignals.status).toBe(200);
    await activeMemberNoPasswordSignals.json();
    const noPasswordDelete = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      unrelatedProfile
    );
    expect(noPasswordDelete.status).toBe(401);
    const noPasswordDeletePayload = (await noPasswordDelete.json()) as {
      code?: string;
    };
    expect(noPasswordDeletePayload.code).toBe("space.password_required");
    const noPasswordStream = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/stream`,
      { headers: { Upgrade: "websocket" } },
      unrelatedProfile
    );
    expect(noPasswordStream.status).toBe(401);
    expect(noPasswordStream.webSocket).toBeNull();
    const noPasswordStreamPayload = (await noPasswordStream.json()) as {
      code?: string;
    };
    expect(noPasswordStreamPayload.code).toBe("space.password_required");
    const wrongPasswordStream = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/stream`,
      { headers: { Upgrade: "websocket" } },
      unrelatedProfile,
      { spacePassword: "wrong123" }
    );
    expect(wrongPasswordStream.status).toBe(403);
    expect(wrongPasswordStream.webSocket).toBeNull();
    const wrongPasswordStreamPayload = (await wrongPasswordStream.json()) as {
      code?: string;
    };
    expect(wrongPasswordStreamPayload.code).toBe("space.password_invalid");
  });
  it("checks protected route passwords before unsupported method dispatch", async () => {
    const password = "route-pass-123";
    const spaceId = await createSpace({
      name: "protected-route-method-order",
      password,
    });
    const unaffiliatedProfile: Partial<TestAuthProfile> = {
      profileId: "agt_44444444-4444-4444-8444-444444444444",
      profileKind: "agent",
      profileName: "Unaffiliated Agent",
      ownerUserId: "owner-route-unaffiliated-1",
      openMeldProfileId: "agt_44444444-4444-4444-8444-444444444444",
      agentControllerRef: "builtin:codex",
    };
    const routes = ["/meta", "/result?dispatchId=missing-dispatch"];
    for (const route of routes) {
      await expect(
        readResponseStatusAndCode(
          await fetchSpaceDoWithOpenMeldAuth(
            { path: route, spaceId },
            { method: "POST" },
            unaffiliatedProfile
          )
        )
      ).resolves.toEqual({ code: "space.password_required", status: 401 });
      await expect(
        readResponseStatusAndCode(
          await fetchSpaceDoWithOpenMeldAuth(
            { path: route, spaceId },
            { method: "POST" },
            unaffiliatedProfile,
            {
              spacePassword: "wrong-pass",
            }
          )
        )
      ).resolves.toEqual({ code: "space.password_invalid", status: 403 });
      const authorizedUnsupportedMethod = await fetchSpaceDoWithOpenMeldAuth(
        { path: route, spaceId },
        { method: "POST" },
        unaffiliatedProfile,
        { spacePassword: password }
      );
      expect(authorizedUnsupportedMethod.status).toBe(405);
      await authorizedUnsupportedMethod.text();
    }
  });
  it("routes every password-protected read/update handler for allowed methods", async () => {
    const password = "route-pass-123";
    const spaceId = await createSpace({
      name: "protected-route-wiring",
      password,
    });
    const passwordOptions = { spacePassword: password };
    const contractBody = {
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    };
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/meta`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "protected-route-wiring-renamed" }),
          },
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/contract`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/contract`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(contractBody),
          },
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/contract`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ entryBrief: "none" }),
          },
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/dispatches/dispatch-route-smoke/trace`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/dispatches/lookup?sourceSignalId=missing-source`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/result?dispatchId=dispatch-route-smoke`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/wake-progress?clientMessageId=client-route-smoke`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/active-wake-progress`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/wake-trace-waterfall?clientMessageId=client-route-smoke`,
          undefined,
          undefined,
          passwordOptions
        )
      )
    ).resolves.not.toBe(405);
  });
  it("routes protected member removal without method dispatch drift", async () => {
    const password = "route-pass-123";
    const spaceId = await createSpace({
      name: "protected-remove-route-wiring",
      password,
    });
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              memberProfileIds: [SECOND_HUMAN_PROFILE_ID],
            }),
          },
          undefined,
          { spacePassword: password }
        )
      )
    ).resolves.not.toBe(405);
  });
  it("reads Message Details through the protected Space route", async () => {
    const spaceId = await createSpace({ name: "message-details-route" });
    const signal = await postTextSignal(spaceId, "Message Details route smoke");
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/message-details?signalId=${encodeURIComponent(signal.id)}`
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      agentContext?: {
        state?: unknown;
      };
      diagnostics?: {
        signalId?: unknown;
      };
      message?: {
        actor?: {
          displayName?: unknown;
        };
        signalId?: unknown;
      };
      wakeContext?: {
        state?: unknown;
      };
    };
    expect(payload.message?.signalId).toBe(signal.id);
    expect(payload.message?.actor?.displayName).toBe("alice");
    expect(payload.agentContext?.state).toBe("not_applicable");
    expect(payload.wakeContext?.state).toBe("not_applicable");
    expect(payload.diagnostics?.signalId).toBe(signal.id);
    expect(payload).not.toHaveProperty("threadContext");
    const detailsUrl = (signalId: string) =>
      `${BASE_URL}/v1/spaces/${spaceId}/message-details?signalId=${encodeURIComponent(signalId)}&includeThreadContext=true`;
    const unthreaded = await fetchWithOpenMeldAuth(detailsUrl(signal.id));
    expect(unthreaded.status).toBe(200);
    expect(await unthreaded.json()).toMatchObject({ threadContext: null });
    const created = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rootSignalId: signal.id,
          clientMutationId: crypto.randomUUID(),
        }),
      }
    );
    expect(created.status).toBe(200);
    const { thread } = (await created.json()) as {
      thread: { threadId: string };
    };
    const reply = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads/${thread.threadId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "A reply inside the thread",
          clientMessageId: crypto.randomUUID(),
        }),
      }
    );
    expect(reply.status).toBe(200);
    const replyBody = (await reply.json()) as { signal: { id: string } };
    for (const targetId of [signal.id, replyBody.signal.id]) {
      const details = await fetchWithOpenMeldAuth(detailsUrl(targetId));
      expect(details.status).toBe(200);
      expect(await details.json()).toMatchObject({
        threadContext: { threadId: thread.threadId, rootSignalId: signal.id },
      });
    }
    const missing = await fetchWithOpenMeldAuth(
      detailsUrl(crypto.randomUUID())
    );
    expect(missing.status).toBe(404);
    await missing.body?.cancel();
  });
  it("routes protected leave without method dispatch drift", async () => {
    const password = "route-pass-123";
    const spaceId = await createSpace({
      name: "protected-leave-route-wiring",
      password,
    });
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/leave`,
          { method: "POST" },
          undefined,
          { spacePassword: password }
        )
      )
    ).resolves.not.toBe(405);
  });
  it("routes protected space deletion without method dispatch drift", async () => {
    const password = "route-pass-123";
    const spaceId = await createSpace({
      name: "protected-delete-route-wiring",
      password,
    });
    await expect(
      readDrainedResponseStatus(
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          undefined,
          { spacePassword: password }
        )
      )
    ).resolves.not.toBe(405);
  });
  it("supports password upsert/clear and enforces owner rules", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-manage-owner-1",
      profileKind: "human",
      profileName: "Manage Owner",
      ownerUserId: "owner-manage-1",
      openMeldProfileId: "hum-manage-owner-1",
    };
    const otherProfile: Partial<TestAuthProfile> = {
      profileId: "hum-manage-other-1",
      profileKind: "human",
      profileName: "Manage Other",
      ownerUserId: "owner-manage-2",
      openMeldProfileId: "hum-manage-other-1",
    };
    const spaceId = await createSpace(
      { name: "manage-password-space" },
      ownerProfile
    );
    const tooShort = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "12345" }),
      },
      ownerProfile
    );
    expect(tooShort.status).toBe(400);
    const tooShortPayload = (await tooShort.json()) as {
      code?: string;
      message?: string;
    };
    expect(tooShortPayload.code).toBe("space.password_too_short");
    expect(tooShortPayload.message).toContain("at least");
    const upsert = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "123456" }),
      },
      ownerProfile
    );
    expect(upsert.status).toBe(200);
    const upsertPayload = (await upsert.json()) as {
      passwordProtected?: boolean;
    };
    expect(upsertPayload.passwordProtected).toBe(true);
    const denied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "abcdef" }),
      },
      otherProfile
    );
    expect(denied.status).toBe(403);
    const deniedPayload = (await denied.json()) as {
      code?: string;
    };
    expect(deniedPayload.code).toBe("space.forbidden");
    const clearDenied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      { method: "DELETE" },
      otherProfile
    );
    expect(clearDenied.status).toBe(403);
    const clearDeniedPayload = (await clearDenied.json()) as {
      code?: string;
    };
    expect(clearDeniedPayload.code).toBe("space.forbidden");
    const clear = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      { method: "DELETE" },
      ownerProfile
    );
    expect(clear.status).toBe(200);
    const clearPayload = (await clear.json()) as {
      passwordProtected?: boolean;
    };
    expect(clearPayload.passwordProtected).toBe(false);
  });
  it("allows only owner human to manage password for agent-created spaces", async () => {
    const agentCreator: Partial<TestAuthProfile> = {
      profileId: "agt-space-owner-rule-1",
      profileKind: "agent",
      profileName: "Agent Creator",
      ownerUserId: "owner-agent-space-1",
      openMeldProfileId: "agt-space-owner-rule-1",
    };
    const ownerHuman: Partial<TestAuthProfile> = {
      profileId: "hum-agent-owner-1",
      profileKind: "human",
      profileName: "Owner Human",
      ownerUserId: "owner-agent-space-1",
      openMeldProfileId: "hum-agent-owner-1",
    };
    const otherHuman: Partial<TestAuthProfile> = {
      profileId: "hum-agent-owner-2",
      profileKind: "human",
      profileName: "Other Human",
      ownerUserId: "owner-agent-space-2",
      openMeldProfileId: "hum-agent-owner-2",
    };
    const createResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "agent-created-space",
          visibility: "private",
        }),
      },
      agentCreator
    );
    expect(createResponse.status).toBe(200);
    const createPayload = (await createResponse.json()) as {
      spaceId?: string;
    };
    const spaceId = String(createPayload.spaceId ?? "");
    expect(SPACE_ID_HEX_REGEX.test(spaceId)).toBe(true);
    const otherDenied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "owner66" }),
      },
      otherHuman
    );
    expect(otherDenied.status).toBe(403);
    const otherDeniedPayload = (await otherDenied.json()) as {
      code?: string;
    };
    expect(otherDeniedPayload.code).toBe("space.forbidden");
    const ownerAllowed = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "owner66" }),
      },
      ownerHuman
    );
    expect(ownerAllowed.status).toBe(200);
    const ownerAllowedPayload = (await ownerAllowed.json()) as {
      passwordProtected?: boolean;
    };
    expect(ownerAllowedPayload.passwordProtected).toBe(true);
  });
  it("keeps password protection after patch meta update", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-meta-owner-1",
      profileKind: "human",
      profileName: "Meta Owner",
      ownerUserId: "owner-meta-1",
      openMeldProfileId: "hum-meta-owner-1",
    };
    const createResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "meta-pass-space",
          visibility: "private",
          password: "ab#123",
        }),
      },
      ownerProfile
    );
    expect(createResponse.status).toBe(200);
    const createPayload = (await createResponse.json()) as {
      spaceId?: string;
      meta?: {
        passwordProtected?: boolean;
      };
    };
    const spaceId = String(createPayload.spaceId ?? "");
    expect(createPayload.meta?.passwordProtected).toBe(true);
    const patchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guide: "updated-guide" }),
      },
      ownerProfile,
      { spacePassword: "ab#123" }
    );
    expect(patchResponse.status).toBe(200);
    const patchPayload = (await patchResponse.json()) as {
      passwordProtected?: boolean;
    };
    expect(patchPayload.passwordProtected).toBe(true);
    const metaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      ownerProfile,
      { spacePassword: "ab#123" }
    );
    expect(metaResponse.status).toBe(200);
    const metaPayload = (await metaResponse.json()) as {
      passwordProtected?: boolean;
    };
    expect(metaPayload.passwordProtected).toBe(true);
  });
  it("rejects create when password is shorter than minimum length", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-create-short-password-1",
      profileKind: "human",
      profileName: "Create Short Password",
      ownerUserId: "owner-create-short-password-1",
      openMeldProfileId: "hum-create-short-password-1",
    };
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "short-password-space",
          visibility: "private",
          password: "12345",
        }),
      },
      ownerProfile
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      spaceId?: string;
    };
    expect(payload.code).toBe("space.password_too_short");
    expect(payload.message).toContain("at least");
    expect(payload.spaceId).toBeUndefined();
  });
  it("returns 404 for non-existent spaces on join-related endpoints", async () => {
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const missingSpace = namespace.newUniqueId().toString();
    const metaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${missingSpace}/meta`
    );
    expect(metaResponse.status).toBe(404);
    const metaPayload = (await metaResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(metaPayload.code).toBe("space.not_found");
    expect(metaPayload.message).toBe("space not found");
    const signalsResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${missingSpace}/signals`
    );
    expect(signalsResponse.status).toBe(404);
    const signalsPayload = (await signalsResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(signalsPayload.code).toBe("space.not_found");
    expect(signalsPayload.message).toBe("space not found");
    const streamResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${missingSpace}/stream`,
      {
        headers: { Upgrade: "websocket" },
      }
    );
    expect(streamResponse.status).toBe(404);
    expect(streamResponse.webSocket).toBeNull();
    const streamPayload = (await streamResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(streamPayload.code).toBe("space.not_found");
    expect(streamPayload.message).toBe("space not found");
  });
  it.each([
    "cancelled",
    "poisoned",
  ] as const)("blocks Space deletion until Wake work settles, including %s outbox history", async (outboxOutcome) => {
    const creatorProfile = {
      profileId: "hum-delete-creator",
      profileKind: "human" as const,
      profileName: "Delete Creator",
      openMeldProfileId: "hum-delete-creator",
      ownerUserId: "owner-delete-creator",
    };
    const spaceId = await createSpace(
      { name: "delete-target" },
      creatorProfile
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const dispatch = await runInDurableObject(stub, (_instance, state) => {
      const record = createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        nowMs: Date.now(),
        ruleId: "wake_explicit_activation",
        ruleReason: "Explicit Wake target",
        ruleSource: "registry",
        senderProfileId: creatorProfile.profileId,
        sourceEventId: "source-before-delete",
        sourceSignalSnapshot: {
          profileId: creatorProfile.profileId,
          profileKind: "human",
          text: "Work that must not be orphaned.",
        },
        spaceId,
        targetProfileId: "agt_99999999-9999-4999-8999-999999999999",
      });
      insertDispatchOutboxRecord(state.storage.sql, record);
      return record;
    });
    const blocked = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      creatorProfile
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "space.wakes_pending" });
    const retainedMeta = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      creatorProfile
    );
    expect(retainedMeta.status).toBe(200);
    await runInDurableObject(stub, (_instance, state) => {
      if (outboxOutcome === "cancelled") {
        markDispatchOutboxCancelled(state.storage.sql, {
          dispatchId: dispatch.dispatchId,
        });
      } else {
        // The poison owner retains this seed after publishing terminal failure.
        recordDispatchOutboxCandidateFailure(state.storage.sql, {
          dispatchId: dispatch.dispatchId,
        });
        markDispatchOutboxPoisoned(state.storage.sql, {
          dispatchId: dispatch.dispatchId,
          poisonAfterFailureCount: 1,
          poisonedAtMs: Date.now(),
          reasonCode: "dispatch.failed",
        });
      }
    });
    // Native submission can exist without a workstation outbox entry.
    const nativeKey = `delete-native-${randomUUID()}`;
    const observerDeliveryId = `delete-observer-${randomUUID()}`;
    const submissionId = `delete-submission-${randomUUID()}`;
    await upsertRemoteAgentNativeDeliveryRecord({
      deliveryId: observerDeliveryId,
      attemptId: null,
      bindingId: `binding-${randomUUID()}`,
      db: getPostgresDatabase(env),
      dispatchId: `dispatch-${randomUUID()}`,
      idempotencyKey: nativeKey,
      nowMs: Date.now(),
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: dispatch.targetProfileId,
      spaceId,
      status: "submitted",
      triggerMessageId: "source-before-delete",
    });
    expect(
      (
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          creatorProfile
        )
      ).status
    ).toBe(409);
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: getPostgresDatabase(env),
      idempotencyKey: nativeKey,
      nowMs: Date.now(),
      submissionId,
      workerRequestId: `request-${randomUUID()}`,
    });
    expect(
      (
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          creatorProfile
        )
      ).status
    ).toBe(409);
    await markRemoteAgentNativeDeliveryCompleted({
      db: getPostgresDatabase(env),
      submissionId,
      publishedSignalId: null,
      nowMs: Date.now(),
    });
    const subscription = await registerAgentTaskCompletionSubscription({
      db: getPostgresDatabase(env),
      nowMs: Date.now(),
      completionCondition: "terminal",
      continuation: {
        kind: "resume_agent",
        delegationId: `delegation-${randomUUID()}`,
        instruction: "Summarize the result.",
      },
      observerTask: {
        v: 1,
        kind: "native_delivery",
        deliveryId: observerDeliveryId,
      },
      watchedTask: {
        v: 1,
        kind: "native_delivery",
        deliveryId: `child-${randomUUID()}`,
      },
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      idempotencyKey: `subscription-${randomUUID()}`,
      subscriptionId: `subscription-${randomUUID()}`,
    });
    expect(
      (
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          creatorProfile
        )
      ).status
    ).toBe(409);
    await cancelAgentTaskCompletionSubscription({
      db: getPostgresDatabase(env),
      nowMs: Date.now(),
      subscriptionId: subscription.subscriptionId,
    });
    const runId = `delete-run-${randomUUID()}`;
    await getPostgresDatabase(env).query({
      text: `INSERT INTO "openmeld"."routine_runs" (id, routine_id, organization_id, scheduled_for, status, routine_name_snapshot, destination_kind_snapshot, target_space_id_snapshot)
        VALUES ($1, $2, $3, $4, 'claimed', 'Daily check', 'space', $5)`,
      values: [
        runId,
        `routine-${randomUUID()}`,
        DEFAULT_TEST_ORGANIZATION_ID,
        Date.now(),
        spaceId,
      ],
    });
    expect(
      (
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          creatorProfile
        )
      ).status
    ).toBe(409);
    await projectRoutineRunTerminal({
      db: getPostgresDatabase(env),
      nowMs: Date.now(),
      runId,
      status: "failed",
      failureCode: "remote_agent.worker_unavailable",
      failureDetail: "Worker unavailable.",
    });
    expect(
      (
        await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}`,
          { method: "DELETE" },
          creatorProfile
        )
      ).status
    ).toBe(409);
    await markFailedRoutineRunPublished({
      db: getPostgresDatabase(env),
      runId,
      publishedSignalId: "routine-failure-published",
    });
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      creatorProfile
    );
    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as {
      spaceId?: string;
      deleted?: boolean;
    };
    expect(deletePayload.spaceId).toBe(spaceId);
    expect(deletePayload.deleted).toBe(true);
    const metaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      creatorProfile
    );
    expect(metaResponse.status).toBe(200);
    expect(await metaResponse.json()).toMatchObject({
      spaceId,
      deletedAt: expect.any(String),
    });
  });
  it("retains deleted Space history for original members and rejects new participation", async () => {
    const spaceId = await createSpace({
      name: "retained-team-history",
      visibility: "public",
    });
    const message = await postTextSignal(
      spaceId,
      "Retained project decision: launch next week."
    );
    const memberProfileId = randomUUID();
    const member = {
      profileId: memberProfileId,
      openMeldProfileId: memberProfileId,
      profileKind: "human" as const,
      profileName: "Team Member",
      ownerUserId: "owner-retained-history-member",
    };
    const added = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: member.profileId,
              profileName: member.profileName,
              profileKind: member.profileKind,
              ownerUserId: member.ownerUserId,
              ownerName: member.profileName,
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(added.status).toBe(200);
    await added.text();
    const socket = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: member.profileId,
        profileName: member.profileName,
        owner: member.ownerUserId,
      },
      undefined,
      member
    );
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" }
    );
    expect(deleteResponse.status).toBe(200);
    await deleteResponse.text();
    socket.close(1000, "done");
    for (const viewer of [DEFAULT_TEST_AUTH_PROFILE, member]) {
      if (!viewer.ownerUserId) {
        throw new Error("Expected an account owner for the history reader.");
      }
      const history = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        undefined,
        viewer
      );
      expect(history.status).toBe(200);
      expect(await history.json()).toMatchObject({
        signals: expect.arrayContaining([
          expect.objectContaining({ id: message.id }),
        ]),
      });
      const status = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/status`,
        undefined,
        viewer
      );
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        deletedAt: expect.any(String),
        allowedActions: [],
      });
      const list = await listAccountSpacesFromSpaceIndex({
        db: getPostgresDatabase(env),
        gatewayHost: "localhost",
        ownerUserId: viewer.ownerUserId,
        selectedProfileId: viewer.profileId,
        scope: "account",
        limit: 500,
        includeDeletedSpaces: true,
      });
      expect([...list.pinnedItems, ...list.spaceItems]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ spaceId, deletedAt: expect.any(String) }),
        ])
      );
    }
    const writes = [
      {
        path: "signals",
        method: "POST",
        body: {
          type: "signal.text",
          data: { text: "Should not send" },
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "alice",
          },
        },
      },
      { path: "meta", method: "PATCH", body: { name: "Should not rename" } },
      {
        path: "members",
        method: "POST",
        body: {
          members: [
            {
              profileId: DEFAULT_HUMAN_PROFILE_ID,
              profileName: "Test User",
              profileKind: "human",
              ownerUserId: "owner-test-default",
              ownerName: null,
              agentControllerRef: null,
            },
          ],
        },
      },
    ];
    for (const write of writes) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/${write.path}`,
        {
          method: write.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(write.body),
        }
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "space.deleted" });
    }
    const outsider = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      ownerUserId: "owner-history-outsider",
    };
    const denied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      outsider
    );
    expect(denied.status).toBe(403);
    await denied.text();
    const remove = await fetchSpaceDoWithOpenMeldAuth(
      { spaceId, path: "/leave" },
      { method: "POST" },
      member
    );
    expect(remove.status).toBe(200);
    await remove.text();
    const remainingHistory = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(remainingHistory.status).toBe(200);
    await remainingHistory.text();
    const ownerRemove = await fetchSpaceDoWithOpenMeldAuth(
      { spaceId, path: "/leave" },
      { method: "POST" }
    );
    expect(ownerRemove.status).toBe(200);
    await ownerRemove.text();
  });
  it("rejects deletion by a profile without Space ownership", async () => {
    const creatorProfileId = "hum-space-owner-1";
    const spaceId = await createSpace(
      { name: "owner-only-delete" },
      {
        profileId: creatorProfileId,
        profileKind: "human",
        profileName: "Owner One",
        openMeldProfileId: creatorProfileId,
        ownerUserId: "owner-space-owner-1",
      }
    );
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      {
        profileId: "hum-space-owner-2",
        profileKind: "human",
        profileName: "Owner Two",
        openMeldProfileId: "hum-space-owner-2",
        ownerUserId: "owner-space-owner-2",
      }
    );
    expect(deleteResponse.status).toBe(403);
    const payload = (await deleteResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("space.forbidden");
    expect(payload.message).toBe("Only a Space owner can delete this Space.");
  });
  it("requires human confirmation for agent-created space deletion", async () => {
    const agentProfileId = "agt-space-owner-agent";
    const spaceId = await createSpace(
      { name: "agent-created-space" },
      {
        profileId: agentProfileId,
        profileKind: "agent",
        profileName: "Owner Agent",
        openMeldProfileId: agentProfileId,
        ownerUserId: "owner-space-agent",
      }
    );
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      {
        profileId: agentProfileId,
        profileKind: "agent",
        profileName: "Owner Agent",
        openMeldProfileId: agentProfileId,
        ownerUserId: "owner-space-agent",
      }
    );
    expect(deleteResponse.status).toBe(403);
    const payload = (await deleteResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("space.human_confirmation_required");
    expect(payload.message).toBe("A Space owner must confirm deletion.");
  });
  it("allows owner human to delete agent-created space", async () => {
    const agentProfileId = "agt-space-owner-agent-allow";
    const ownerUserId = "owner-space-agent-allow";
    const spaceId = await createSpace(
      { name: "agent-created-owner-human-delete" },
      {
        profileId: agentProfileId,
        profileKind: "agent",
        profileName: "Owner Agent",
        openMeldProfileId: agentProfileId,
        ownerUserId,
      }
    );
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      {
        profileId: "hum-space-owner-agent-allow",
        profileKind: "human",
        profileName: "Owner Human",
        openMeldProfileId: "hum-space-owner-agent-allow",
        ownerUserId,
      }
    );
    expect(deleteResponse.status).toBe(200);
    const payload = (await deleteResponse.json()) as {
      spaceId?: string;
      deleted?: boolean;
    };
    expect(payload.spaceId).toBe(spaceId);
    expect(payload.deleted).toBe(true);
  });
  it("rejects non-owner human deleting agent-created space", async () => {
    const agentProfileId = "agt-space-owner-agent-deny";
    const spaceId = await createSpace(
      { name: "agent-created-owner-human-deny" },
      {
        profileId: agentProfileId,
        profileKind: "agent",
        profileName: "Owner Agent",
        openMeldProfileId: agentProfileId,
        ownerUserId: "owner-space-agent-allow",
      }
    );
    const deleteResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}`,
      { method: "DELETE" },
      {
        profileId: "hum-space-owner-agent-deny",
        profileKind: "human",
        profileName: "Other Human",
        openMeldProfileId: "hum-space-owner-agent-deny",
        ownerUserId: "owner-space-agent-deny",
      }
    );
    expect(deleteResponse.status).toBe(403);
    const payload = (await deleteResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("space.forbidden");
    expect(payload.message).toBe("Only a Space owner can delete this Space.");
  });
  it("rejects unauthenticated signals requests with 401", async () => {
    const spaceId = await createSpace();
    const listResponse = await SELF.fetch(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(401);
    const listPayload = (await listResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(listPayload.code).toBe("auth.unauthenticated");
    expect(listPayload.message).toBe("authentication required");
    const postResponse = await SELF.fetch(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "hello" },
        }),
      }
    );
    expect(postResponse.status).toBe(401);
    const postPayload = (await postResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(postPayload.code).toBe("auth.unauthenticated");
    expect(postPayload.message).toBe("authentication required");
  });
  it("rejects unauthenticated meta updates with 401", async () => {
    const spaceId = await createSpace();
    const response = await SELF.fetch(`${BASE_URL}/v1/spaces/${spaceId}/meta`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guide: "unauthorized update" }),
    });
    expect(response.status).toBe(401);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("auth.unauthenticated");
    expect(payload.message).toBe("authentication required");
  });
  it("lets the creator change directory visibility without changing link access and rejects other actors", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "visibility-owner",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      {
        name: "Directory visibility",
        visibility: "private",
        accessMode: "members_only",
      },
      creatorProfile
    );
    const request = {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    };
    const denied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      request,
      {
        profileId: THIRD_HUMAN_PROFILE_ID,
        profileKind: "human",
        ownerUserId: "visibility-other",
        openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
      }
    );
    expect(denied.status).toBe(403);
    const saved = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      request,
      creatorProfile
    );
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      visibility: "public",
      accessMode: "members_only",
    });
    const status = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`,
      undefined,
      creatorProfile
    );
    await expect(status.json()).resolves.toMatchObject({
      organizationVisibility: "public",
      accessMode: "members_only",
    });
  });
  it("lets the creator rename a Space, rejects other actors, and broadcasts metadata invalidation", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-space-rename-host",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const otherProfile: Partial<TestAuthProfile> = {
      profileId: THIRD_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Other Member",
      ownerUserId: "owner-space-rename-other",
      openMeldProfileId: THIRD_HUMAN_PROFILE_ID,
    };
    const spaceId = await createSpace(
      { name: "Original Room" },
      creatorProfile
    );
    const unauthorizedResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Hijacked Room" }),
      },
      otherProfile
    );
    expect(unauthorizedResponse.status).toBe(403);
    await expect(unauthorizedResponse.json()).resolves.toMatchObject({
      code: "space.forbidden",
    });
    const socket = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileName: "Space Host",
      },
      undefined,
      creatorProfile
    );
    const metadataChanged = waitForJsonMessage(
      socket,
      (data) => data.type === "space.meta.changed"
    );
    const renameResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "  Launch Room  " }),
      },
      creatorProfile
    );
    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toMatchObject({
      name: "Launch Room",
    });
    await expect(metadataChanged).resolves.toMatchObject({
      type: "space.meta.changed",
      spaceId,
      reason: "space.name.updated",
    });
    const statusResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`,
      undefined,
      creatorProfile
    );
    await expect(statusResponse.json()).resolves.toMatchObject({
      name: "Launch Room",
    });
    socket.close(1000, "done");
  });
  it("rejects unauthenticated cursor requests with 401", async () => {
    const spaceId = await createSpace();
    const profileId = "profile-cursor-test";
    const getResponse = await SELF.fetch(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${profileId}`
    );
    expect(getResponse.status).toBe(401);
    const getPayload = (await getResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(getPayload.code).toBe("auth.unauthenticated");
    expect(getPayload.message).toBe("authentication required");
    const patchResponse = await SELF.fetch(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${profileId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "agent" }),
      }
    );
    expect(patchResponse.status).toBe(401);
    const patchPayload = (await patchResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(patchPayload.code).toBe("auth.unauthenticated");
    expect(patchPayload.message).toBe("authentication required");
  });
  it("returns structured JSON error for invalid create payload", async () => {
    const response = await fetchWithOpenMeldAuth(`${BASE_URL}/v1/spaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "x".repeat(MAX_SPACE_NAME_LENGTH + 1),
        visibility: "private",
      }),
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(payload.error?.code).toBe("invalid_create_payload");
    expect(payload.error?.message).toContain("Invalid name: too long");
  });
  it("returns structured JSON error for malformed create JSON body", async () => {
    const response = await fetchWithOpenMeldAuth(`${BASE_URL}/v1/spaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: '{"name":"broken"',
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(payload.error?.code).toBe("invalid_create_payload");
    expect(payload.error?.message).toContain("malformed JSON");
  });
  it("keeps invalid password type mapping consistent between HTTP and RPC create", async () => {
    const httpResponse = await fetchWithOpenMeldAuth(`${BASE_URL}/v1/spaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "bad-password-type",
        visibility: "private",
        password: { raw: "123456" },
      }),
    });
    expect(httpResponse.status).toBe(400);
    const httpPayload = (await httpResponse.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(httpPayload.error?.code).toBe("invalid_create_payload");
    expect(httpPayload.error?.message).toContain("Invalid password");
    await ensureTestOrganizationMembership({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      userId: "rpc-owner-invalid-password",
    });
    await expect(
      rpcCreateSpace(
        env as unknown as CoreBindings,
        {
          name: "bad-password-type",
          visibility: "private",
          password: { raw: "123456" },
          context: createRpcContext({
            requestId: "rpc-create-invalid-password-type",
            profileId: "rpc-profile-invalid-password",
            profileKind: "human",
            profileName: "RPC Create Tester",
            ownerUserId: "rpc-owner-invalid-password",
          }),
        } as unknown as Parameters<typeof rpcCreateSpace>[1]
      )
    ).rejects.toMatchObject({
      cause: {
        status: 400,
        code: "invalid_create_payload",
        message: "Invalid password",
      },
    });
  });
  it("rejects create payload with unknown fields", async () => {
    const response = await fetchWithOpenMeldAuth(`${BASE_URL}/v1/spaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        visibility: "private",
        creator: {
          profileId: "forged-creator",
        },
      }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(payload.error?.code).toBe("invalid_create_payload");
    expect(payload.error?.message).toContain('unknown field "creator"');
  });
  it("rejects meta patch payload with unknown fields", async () => {
    const spaceId = await createSpace({
      name: "meta-unknown-field-space",
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          guide: "safe-update",
          unknownField: "not-allowed",
        }),
      }
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Unknown field: unknownField");
  });
  it("rejects password payload with unknown fields", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-password-unknown-owner",
      profileKind: "human",
      profileName: "Password Unknown Owner",
      ownerUserId: "owner-password-unknown",
      openMeldProfileId: "hum-password-unknown-owner",
    };
    const spaceId = await createSpace(
      { name: "password-unknown-field-space" },
      ownerProfile
    );
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          password: "abcdef",
          unknownField: "not-allowed",
        }),
      },
      ownerProfile
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("invalid_password_payload");
    expect(payload.message).toContain("Unknown field: unknownField");
  });
  it("rejects password payload when password is missing", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-password-missing-owner",
      profileKind: "human",
      profileName: "Password Missing Owner",
      ownerUserId: "owner-password-missing",
      openMeldProfileId: "hum-password-missing-owner",
    };
    const spaceId = await createSpace(
      { name: "password-missing-field-space" },
      ownerProfile
    );
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      ownerProfile
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("invalid_password_payload");
    expect(payload.message).toContain("expected password");
  });
  it("rejects password payload when password is not string", async () => {
    const ownerProfile: Partial<TestAuthProfile> = {
      profileId: "hum-password-type-owner",
      profileKind: "human",
      profileName: "Password Type Owner",
      ownerUserId: "owner-password-type",
      openMeldProfileId: "hum-password-type-owner",
    };
    const spaceId = await createSpace(
      { name: "password-invalid-type-space" },
      ownerProfile
    );
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: 123_456 }),
      },
      ownerProfile
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("invalid_password_payload");
    expect(payload.message).toContain("password must be a string");
  });
  it("rejects create payload when guide exceeds max length", async () => {
    const response = await fetchWithOpenMeldAuth(`${BASE_URL}/v1/spaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        visibility: "private",
        guide: "x".repeat(MAX_TEXT_LENGTH + 1),
      }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(payload.error?.code).toBe("invalid_create_payload");
    expect(payload.error?.message).toContain("Invalid guide");
  });
  it("rejects Space guide updates longer than 4,000 characters", async () => {
    const spaceId = await createSpace({ name: "guide-limit" });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          guide: "g".repeat(4001),
        }),
      }
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain("Guide too long");
  });
  it("stores space creator + guide on create and supports metadata updates", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: "creator-1",
      profileKind: "human",
      profileName: "Creator",
      openMeldProfileId: "creator-profile",
      ownerUserId: "owner-creator-1",
    };
    const creatorRuntimeProfileId = toCanonicalOpenMeldProfileId(
      creatorProfile.openMeldProfileId ?? creatorProfile.profileId ?? "",
      creatorProfile.profileKind ?? "human"
    );
    const spaceId = await createSpace(
      {
        name: "alpha-meta",
        guide: "Be concise and kind.",
      },
      creatorProfile
    );
    const firstMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      undefined,
      creatorProfile
    );
    expect(firstMetaResponse.status).toBe(200);
    const firstMeta = (await firstMetaResponse.json()) as {
      spaceId?: string;
      name?: string;
      creator?: {
        profileId?: string;
        profile?: string;
      };
      guide?: string;
      storageUsage?: {
        usedBytes?: number;
        softLimitBytes?: number;
        usagePercent?: number;
      };
    };
    expect(firstMeta.spaceId).toBe(spaceId);
    expect(firstMeta.name).toBe("alpha-meta");
    expect(firstMeta.creator?.profileId).toBe(creatorRuntimeProfileId);
    expect(firstMeta.creator?.profile).toBeUndefined();
    expect(firstMeta.guide).toBe("Be concise and kind.");
    expect(firstMeta.storageUsage?.softLimitBytes).toBe(9 * 1024 * 1024 * 1024);
    expect(typeof firstMeta.storageUsage?.usedBytes).toBe("number");
    expect(typeof firstMeta.storageUsage?.usagePercent).toBe("number");
    const signalsAfterMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      creatorProfile
    );
    expect(signalsAfterMetaResponse.status).toBe(200);
    const signalsAfterMeta = (await signalsAfterMetaResponse.json()) as {
      signals?: unknown[];
      nextCursor?: string | null;
    };
    expect(signalsAfterMeta.signals).toEqual([]);
    expect(signalsAfterMeta.nextCursor).toBeNull();
    const catchupAfterMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=20`,
      undefined,
      creatorProfile
    );
    expect(catchupAfterMetaResponse.status).toBe(200);
    const catchupAfterMeta = (await catchupAfterMetaResponse.json()) as {
      signals?: unknown[];
    };
    expect(catchupAfterMeta.signals).toEqual([]);
    const patchMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ guide: "Updated guideline." }),
      },
      creatorProfile
    );
    expect(patchMetaResponse.status).toBe(200);
    const patchedMeta = (await patchMetaResponse.json()) as {
      name?: string;
      guide?: string;
      creator?: {
        profileId?: string;
      };
      storageUsage?: {
        usedBytes?: number;
        softLimitBytes?: number;
        usagePercent?: number;
      };
    };
    expect(patchedMeta.name).toBe("alpha-meta");
    expect(patchedMeta.guide).toBe("Updated guideline.");
    expect(patchedMeta.creator?.profileId).toBe(creatorRuntimeProfileId);
    expect(patchedMeta.storageUsage?.softLimitBytes).toBe(
      9 * 1024 * 1024 * 1024
    );
    const clearGuideResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ guide: "" }),
      },
      creatorProfile
    );
    expect(clearGuideResponse.status).toBe(200);
    const clearedMeta = (await clearGuideResponse.json()) as {
      name?: string;
      guide?: string;
      creator?: {
        profileId?: string;
      };
    };
    expect(clearedMeta.name).toBe("alpha-meta");
    expect(clearedMeta.guide).toBeUndefined();
    expect(clearedMeta.creator?.profileId).toBe(creatorRuntimeProfileId);
    const patchPurposeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/meta`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ purpose: "rewritten-by-client" }),
      },
      creatorProfile
    );
    expect(patchPurposeResponse.status).toBe(403);
    await expect(patchPurposeResponse.json()).resolves.toMatchObject({
      code: "space.forbidden",
      message:
        "Space purpose and creator attribution cannot be changed through metadata updates.",
    });
  });
  it("creates distinct spaces when reusing the same name", async () => {
    const firstCreatorProfile: Partial<TestAuthProfile> = {
      profileId: "creator-original",
      profileKind: "human",
      profileName: "Original Owner",
      openMeldProfileId: "creator-original",
      ownerUserId: "owner-creator-original",
    };
    const firstCreatorRuntimeProfileId = toCanonicalOpenMeldProfileId(
      firstCreatorProfile.openMeldProfileId ??
        firstCreatorProfile.profileId ??
        "",
      firstCreatorProfile.profileKind ?? "human"
    );
    const firstCreateResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "stable-room",
          visibility: "private",
          guide: "Original guideline.",
        }),
      },
      firstCreatorProfile
    );
    expect(firstCreateResponse.status).toBe(200);
    const firstCreate = (await firstCreateResponse.json()) as {
      spaceId?: string;
      meta?: {
        creator?: {
          profileId?: string;
        };
        guide?: string;
      };
    };
    if (!firstCreate.spaceId) {
      throw new Error("Missing spaceId in first create response");
    }
    expect(firstCreate.meta?.creator?.profileId).toBe(
      firstCreatorRuntimeProfileId
    );
    expect(firstCreate.meta?.guide).toBe("Original guideline.");
    const secondCreatorProfile: Partial<TestAuthProfile> = {
      profileId: "creator-overwrite-attempt",
      profileKind: "human",
      profileName: "Overwrite Attempt",
      openMeldProfileId: "creator-overwrite-attempt",
      ownerUserId: "owner-creator-overwrite",
    };
    const secondCreatorRuntimeProfileId = toCanonicalOpenMeldProfileId(
      secondCreatorProfile.openMeldProfileId ??
        secondCreatorProfile.profileId ??
        "",
      secondCreatorProfile.profileKind ?? "human"
    );
    const secondCreateResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "stable-room",
          visibility: "private",
          guide: "Overwritten guideline.",
        }),
      },
      secondCreatorProfile
    );
    expect(secondCreateResponse.status).toBe(200);
    const secondCreate = (await secondCreateResponse.json()) as {
      spaceId?: string;
      meta?: {
        creator?: {
          profileId?: string;
        };
        guide?: string;
      };
    };
    if (!secondCreate.spaceId) {
      throw new Error("Missing spaceId in second create response");
    }
    expect(secondCreate.spaceId).not.toBe(firstCreate.spaceId);
    expect(secondCreate.meta?.creator?.profileId).toBe(
      secondCreatorRuntimeProfileId
    );
    expect(secondCreate.meta?.guide).toBe("Overwritten guideline.");
    const firstMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${firstCreate.spaceId}/meta`,
      undefined,
      firstCreatorProfile
    );
    expect(firstMetaResponse.status).toBe(200);
    const firstMeta = (await firstMetaResponse.json()) as {
      creator?: {
        profileId?: string;
      };
      guide?: string;
    };
    expect(firstMeta.creator?.profileId).toBe(firstCreatorRuntimeProfileId);
    expect(firstMeta.guide).toBe("Original guideline.");
    const secondMetaResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${secondCreate.spaceId}/meta`,
      undefined,
      secondCreatorProfile
    );
    expect(secondMetaResponse.status).toBe(200);
    const secondMeta = (await secondMetaResponse.json()) as {
      creator?: {
        profileId?: string;
      };
      guide?: string;
    };
    expect(secondMeta.creator?.profileId).toBe(secondCreatorRuntimeProfileId);
    expect(secondMeta.guide).toBe("Overwritten guideline.");
  });
  it("returns unique space IDs for concurrent creates with the same name", async () => {
    const roomName = "concurrent-stable-room";
    const requests = Array.from({ length: 6 }, (_, index) => {
      const profileId = `creator-${index + 1}`;
      return {
        body: {
          name: roomName,
          visibility: "private",
          guide: `Guideline ${index + 1}`,
        },
        authProfile: {
          profileId,
          profileKind: "human" as const,
          profileName: `Creator ${index + 1}`,
          openMeldProfileId: profileId,
          ownerUserId: `owner-${profileId}`,
        },
        expectedCreatorProfileId: toCanonicalOpenMeldProfileId(
          profileId,
          "human"
        ),
        expectedGuide: `Guideline ${index + 1}`,
      };
    });
    const responses = await Promise.all(
      requests.map((request) =>
        fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(request.body),
          },
          request.authProfile
        )
      )
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    const payloads = await Promise.all(
      responses.map(async (response) => {
        return (await response.json()) as {
          spaceId?: string;
          meta?: {
            creator?: {
              profileId?: string;
            };
            guide?: string;
          };
          expectedCreatorProfileId?: string;
          expectedGuide?: string;
          authProfile?: Partial<TestAuthProfile>;
        };
      })
    );
    const payloadsWithExpectation = payloads.map((payload, index) => ({
      ...payload,
      expectedCreatorProfileId: requests[index]?.expectedCreatorProfileId,
      expectedGuide: requests[index]?.expectedGuide,
      authProfile: requests[index]?.authProfile,
    }));
    const spaceIds = payloadsWithExpectation
      .map((payload) => payload.spaceId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    expect(spaceIds).toHaveLength(payloadsWithExpectation.length);
    expect(new Set(spaceIds).size).toBe(payloadsWithExpectation.length);
    for (const payload of payloadsWithExpectation) {
      if (!payload.spaceId) {
        throw new Error("Missing spaceId in concurrent create response");
      }
      const metaResponse = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${payload.spaceId}/meta`,
        undefined,
        payload.authProfile
      );
      expect(metaResponse.status).toBe(200);
      const meta = (await metaResponse.json()) as {
        creator?: {
          profileId?: string;
        };
        guide?: string;
      };
      expect(meta.creator?.profileId).toBe(payload.expectedCreatorProfileId);
      expect(meta.guide).toBe(payload.expectedGuide);
    }
  });
  it("stores per-profile cursor and enforces monotonic lastSeenTs", async () => {
    const spaceId = await createSpace();
    const firstCursorProfileId = toCanonicalOpenMeldProfileId(
      "profile-1",
      "human"
    );
    const secondCursorProfileId = toCanonicalOpenMeldProfileId(
      "profile-2",
      "human"
    );
    const firstReadResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`
    );
    expect(firstReadResponse.status).toBe(200);
    const firstRead = (await firstReadResponse.json()) as {
      spaceId?: string;
      profileId?: string;
      lastSeenTs?: number;
    };
    expect(firstRead.spaceId).toBe(spaceId);
    expect(firstRead.profileId).toBe(firstCursorProfileId);
    expect(firstRead.lastSeenTs).toBeUndefined();
    const firstPatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lastSeenTs: 100 }),
      }
    );
    expect(firstPatchResponse.status).toBe(200);
    const firstPatch = (await firstPatchResponse.json()) as {
      lastSeenTs?: number;
    };
    expect(firstPatch.lastSeenTs).toBe(100);
    const secondPatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lastSeenTs: 50 }),
      }
    );
    expect(secondPatchResponse.status).toBe(200);
    const secondPatch = (await secondPatchResponse.json()) as {
      lastSeenTs?: number;
    };
    expect(secondPatch.lastSeenTs).toBe(100);
    const rolePatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          role: "Spaceship Engineer",
        }),
      }
    );
    expect(rolePatchResponse.status).toBe(200);
    const rolePatch = (await rolePatchResponse.json()) as {
      lastSeenTs?: number;
      role?: string;
      mentionAlias?: string;
    };
    expect(rolePatch.lastSeenTs).toBe(100);
    expect(rolePatch.role).toBe("Spaceship Engineer");
    expect(rolePatch.mentionAlias).toBeUndefined();
    const aliasPatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mentionAlias: "ops-bot",
        }),
      }
    );
    expect(aliasPatchResponse.status).toBe(200);
    const aliasPatch = (await aliasPatchResponse.json()) as {
      mentionAlias?: string;
      lastSeenTs?: number;
    };
    expect(aliasPatch.mentionAlias).toBe("ops-bot");
    expect(aliasPatch.lastSeenTs).toBe(100);
    const staleLastSeenWithRolePatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${firstCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          lastSeenTs: 50,
          role: "Lead Systems Engineer",
        }),
      }
    );
    expect(staleLastSeenWithRolePatchResponse.status).toBe(200);
    const staleLastSeenWithRolePatch =
      (await staleLastSeenWithRolePatchResponse.json()) as {
        lastSeenTs?: number;
        role?: string;
      };
    expect(staleLastSeenWithRolePatch.lastSeenTs).toBe(100);
    expect(staleLastSeenWithRolePatch.role).toBe("Lead Systems Engineer");
    const anotherActorPatchResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${secondCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ lastSeenTs: 7 }),
      }
    );
    expect(anotherActorPatchResponse.status).toBe(200);
    const anotherActorPatch = (await anotherActorPatchResponse.json()) as {
      profileId?: string;
      lastSeenTs?: number;
    };
    expect(anotherActorPatch.profileId).toBe(secondCursorProfileId);
    expect(anotherActorPatch.lastSeenTs).toBe(7);
    const aliasConflictResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/${secondCursorProfileId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ mentionAlias: "ops-bot" }),
      }
    );
    expect(aliasConflictResponse.status).toBe(409);
    const aliasConflict = (await aliasConflictResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(aliasConflict.code).toBe("space.mention_alias_conflict");
    expect(aliasConflict.message).toContain("mentionAlias already exists");
  });
  it("stores and lists signals via HTTP", async () => {
    const spaceId = await createSpace();
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: { kind: "human", profileId: "alice", profileName: "Alice" },
          type: "signal.text",
          data: { text: "hello" },
        }),
      }
    );
    expect(postResponse.status).toBe(200);
    const posted = (await postResponse.json()) as Record<string, unknown>;
    expect(posted.type).toBe("signal.text");
    expect(
      (
        posted.profile as {
          profileName?: string;
        }
      ).profileName
    ).toBe("Alice");
    expect(
      (
        posted.data as {
          text?: string;
        }
      ).text
    ).toBe("hello");
    expect(typeof posted.ts).toBe("number");
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: Array<{
        type: string;
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(list.signals).toHaveLength(1);
    expect(list.signals?.[0]?.type).toBe("signal.text");
    expect(list.signals?.[0]?.data.text).toBe("hello");
    expect(list.nextCursor).toBeNull();
  });
  it("seeds the signal clock from persisted history after a cold start", async () => {
    const spaceId = await createSpace();
    const futureTs = Date.now() + 60_000;
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const posted = await runInDurableObject(stub, async (_instance, state) => {
      const storedSignal: SignalEnvelope = {
        v: 1,
        id: "signal-future-clock-seed",
        spaceId,
        ts: futureTs,
        type: "signal.text",
        profile: {
          kind: "human",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileName: "Test User",
        },
        data: { text: "future clock seed" },
      };
      state.storage.sql.exec(
        `
          INSERT INTO space_signals (
            id,
            ts,
            type,
            profile_id,
            profile_kind,
            client_message_id,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        storedSignal.id,
        storedSignal.ts,
        storedSignal.type,
        storedSignal.profile?.profileId ?? null,
        storedSignal.profile?.kind ?? null,
        null,
        JSON.stringify(storedSignal)
      );
      const restarted = new Space(state, env as unknown as CoreBindings);
      return await restarted.rpcPostSignal({
        spaceId,
        profile: {
          kind: "agent",
          profileId: "signal-clock-agent",
          profileName: "Signal Clock Agent",
        },
        text: "after cold start",
        authoringPolicy: "system_emitted",
        context: createRpcContext({
          requestId: "signal-clock-cold-start",
          profileId: "signal-clock-agent",
          profileKind: "agent",
          profileName: "Signal Clock Agent",
          ownerUserId: "signal-clock-owner",
        }),
      });
    });
    expect(posted.ts).toBeGreaterThan(futureTs);
  });
  it("rejects direct user-authored Wake HTTP posts before persisting signals", async () => {
    const spaceId = await createSpace();
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: { kind: "human", profileId: "alice", profileName: "Alice" },
          type: "signal.text",
          data: {
            text: "@Demo Agent(wake) hello",
            messageEnvelope: {
              text: "@Demo Agent(wake) hello",
              activationTargets: ["agt_22222222-2222-4222-8222-222222222222"],
              referenceTargets: [],
            },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(400);
    await expect(postResponse.json()).resolves.toMatchObject({
      ok: false,
      code: SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE,
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: unknown[];
    };
    expect(list.signals).toEqual([]);
  });
  it("accepts Reference targets that are active Agent Space members", async () => {
    const spaceId = await createSpace();
    const agentProfileId = "agt_44444444-4444-4444-8444-444444444444";
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: agentProfileId,
              profileName: "Reference Boundary Agent",
              profileKind: "agent",
              ownerUserId: "owner-reference-boundary-agent",
              ownerName: "Reference Boundary Owner",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const clientMessageId = `reference-active-member-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text: "@Reference Boundary Agent(reference) for context",
            messageEnvelope: {
              text: "@Reference Boundary Agent(reference) for context",
              activationTargets: [],
              referenceTargets: [agentProfileId],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toMatchObject({
      data: {
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [agentProfileId],
        },
        meta: { clientMessageId },
      },
      type: "signal.text",
    });
  });
  it("rejects Reference targets that are not active Space members before persisting signals", async () => {
    const spaceId = await createSpace();
    const clientMessageId = `reference-non-member-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text: "@Non-member(reference) for context",
            messageEnvelope: {
              text: "@Non-member(reference) for context",
              activationTargets: [],
              referenceTargets: [SECOND_HUMAN_PROFILE_ID],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(422);
    await expect(postResponse.json()).resolves.toEqual({
      ok: false,
      code: "space.addressing.target_invalid",
      message: `OpenMeld could not send this message because ${SECOND_HUMAN_PROFILE_ID} is not an active member of this Space. Choose a current Space member and try again.`,
      targetProfileId: SECOND_HUMAN_PROFILE_ID,
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: unknown[];
    };
    expect(list.signals).toEqual([]);
  });
  it("rejects active Agent profiles used as Human Mention targets", async () => {
    const spaceId = await createSpace();
    const agentProfileId = "agt_55555555-5555-4555-8555-555555555555";
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: agentProfileId,
              profileName: "Mention Boundary Agent",
              profileKind: "agent",
              ownerUserId: "owner-mention-boundary-agent",
              ownerName: "Mention Boundary Owner",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const clientMessageId = `mention-agent-target-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text: "@Mention Boundary Agent please review",
            messageEnvelope: {
              text: "@Mention Boundary Agent please review",
              activationTargets: [],
              referenceTargets: [],
              mentionTargets: [agentProfileId],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(422);
    await expect(postResponse.json()).resolves.toEqual({
      ok: false,
      code: "space.addressing.target_invalid",
      message: `OpenMeld could not mention ${agentProfileId} because Human Mention only supports people. The message was not sent. Choose a person or use Wake or Reference for an agent.`,
      targetProfileId: agentProfileId,
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: unknown[];
    };
    expect(list.signals).toEqual([]);
  });
  it("rejects active Human profiles used as Agent Reference targets", async () => {
    const spaceId = await createSpace();
    const humanProfileId = DEFAULT_HUMAN_PROFILE_ID;
    const clientMessageId = `reference-human-target-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openmeld-space-addressing-version": "1",
        },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text: "@Reference Boundary Human please review",
            messageEnvelope: {
              text: "@Reference Boundary Human please review",
              activationTargets: [],
              referenceTargets: [humanProfileId],
              mentionTargets: [],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(422);
    await expect(postResponse.json()).resolves.toEqual({
      ok: false,
      code: "space.addressing.target_invalid",
      message: `OpenMeld could not reference ${humanProfileId} because Agent Reference only supports agents. The message was not sent. Choose an agent or mention a person.`,
      targetProfileId: humanProfileId,
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: unknown[];
    };
    expect(list.signals).toEqual([]);
  });
  it("translates legacy Human Reference targets into Human Mentions", async () => {
    const spaceId = await createSpace();
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: SECOND_HUMAN_PROFILE_ID,
              profileName: "Legacy Mention Target",
              profileKind: "human",
              ownerUserId: "owner-legacy-mention-target",
              ownerName: "Legacy Mention Target",
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const text = "@Legacy Mention Target please review";
    const clientMessageId = `legacy-human-reference-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text,
            messageEnvelope: {
              text,
              activationTargets: [],
              referenceTargets: [SECOND_HUMAN_PROFILE_ID],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    const postResponseBody = await postResponse.clone().text();
    expect(postResponse.status, postResponseBody).toBe(200);
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`,
      { headers: { "x-openmeld-space-addressing-version": "1" } }
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals?: Array<{
        data?: {
          text?: string;
          messageEnvelope?: {
            mentionTargets?: string[];
            referenceTargets?: string[];
          };
        };
      }>;
    };
    const persisted = history.signals?.find(
      (signal) => signal.data?.text === text
    );
    expect(persisted?.data?.messageEnvelope).toMatchObject({
      mentionTargets: [SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
    });
  });
  it("translates legacy Human References in Thread replies", async () => {
    const spaceId = await createSpace();
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: SECOND_HUMAN_PROFILE_ID,
              profileName: "Legacy Thread Mention Target",
              profileKind: "human",
              ownerUserId: "owner-legacy-thread-mention-target",
              ownerName: "Legacy Thread Mention Target",
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const rootResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Thread root" },
        }),
      }
    );
    expect(rootResponse.status).toBe(200);
    const rootSignal = parseEnvelope(await rootResponse.json());
    if (!rootSignal) {
      throw new Error("Expected a thread root signal");
    }
    const createThreadResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientMutationId: `create-thread-${randomUUID()}`,
          rootSignalId: rootSignal.id,
        }),
      }
    );
    expect(createThreadResponse.status).toBe(200);
    const createdThread = (await createThreadResponse.json()) as {
      thread: {
        threadId: string;
      };
    };
    const text = "@Legacy Thread Mention Target please review";
    const replyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads/${createdThread.thread.threadId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientMessageId: `legacy-thread-human-reference-${randomUUID()}`,
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [SECOND_HUMAN_PROFILE_ID],
            text,
          },
          text,
        }),
      }
    );
    expect(replyResponse.status, await replyResponse.clone().text()).toBe(200);
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads/${createdThread.thread.threadId}/signals`,
      { headers: { "x-openmeld-space-addressing-version": "1" } }
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals: Array<{
        data?: {
          messageEnvelope?: {
            mentionTargets?: string[];
            referenceTargets?: string[];
          };
          text?: string;
        };
      }>;
    };
    const persisted = history.signals.find(
      (signal) => signal.data?.text === text
    );
    expect(persisted?.data?.messageEnvelope).toMatchObject({
      mentionTargets: [SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
    });
  });
  it("publishes idempotently while another request's membership read remains pending", async () => {
    const spaceId = await createSpace();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const context = createRpcContext({
      requestId: "membership-gate-publication",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const clientMessageId = `membership-gate-${randomUUID()}`;
    const request = {
      authoringPolicy: "user_authored" as const,
      clientMessageId,
      context,
      meta: { clientMessageId },
      profile: {
        kind: "human" as const,
        profileId: DEFAULT_HUMAN_PROFILE_ID,
      },
      spaceId,
      text: "Publication does not borrow a pending membership read",
    };

    await runInDurableObject(stub, async (instance, state) => {
      const outsideStarted = Promise.withResolvers<void>();
      const releaseOutside = Promise.withResolvers<void>();
      let holdNextMembership = false;
      let outsideSettled = false;
      let outsideRead: Promise<unknown> | undefined;
      const nativeQuery = PostgresDatabase.prototype.query;
      const queryObserver = vi
        .spyOn(PostgresDatabase.prototype, "query")
        .mockImplementation(async function (
          this: PostgresDatabase,
          query,
          values
        ) {
          const text = typeof query === "string" ? query : query.text;
          const parameters = typeof query === "string" ? values : query.values;
          const hold =
            holdNextMembership &&
            text.includes('FROM "openmeld"."members"') &&
            parameters?.[0] === DEFAULT_TEST_ORGANIZATION_ID &&
            parameters?.[1] === "owner-test-default";
          if (hold) {
            holdNextMembership = false;
          }
          const result = await nativeQuery.call(this, query, values);
          if (hold) {
            outsideStarted.resolve();
            await releaseOutside.promise;
          }
          return result;
        });
      const blockConcurrencyWhile = state.blockConcurrencyWhile.bind(state);
      const gateObserver = vi
        .spyOn(state, "blockConcurrencyWhile")
        .mockImplementation(
          async <T>(operation: () => Promise<T>): Promise<T> => {
            if (!outsideRead) {
              holdNextMembership = true;
              outsideRead = withPostgresRequest(
                env.OPENMELD_POSTGRESQL,
                () => instance.rpcInputQueue({ spaceId, context }),
                { reuseConnection: false }
              ).finally(() => {
                outsideSettled = true;
              });
              await outsideStarted.promise;
            }
            return await blockConcurrencyWhile(async () => {
              // A failure watchdog belongs to the gate so it can release the
              // fixture even when outside I/O continuations are blocked.
              let timeout: ReturnType<typeof setTimeout> | undefined;
              const deadline = new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () =>
                    reject(
                      new Error("Publication joined outside membership I/O")
                    ),
                  2000
                );
              });
              try {
                return await Promise.race([operation(), deadline]);
              } finally {
                clearTimeout(timeout);
              }
            });
          }
        );
      try {
        const posted =
          await instance.rpcPostSignalOnceByClientMessageId(request);
        expect(outsideSettled).toBe(false);
        expect(posted).toMatchObject({
          type: "signal.text",
          data: { text: request.text, meta: { clientMessageId } },
        });
        expect(
          await instance.rpcPostSignalOnceByClientMessageId(request)
        ).toEqual(posted);
        expect(outsideSettled).toBe(false);
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM space_signals WHERE id = ?",
              posted.id
            )
            .one().count
        ).toBe(1);
      } finally {
        releaseOutside.resolve();
        await outsideRead?.catch(() => undefined);
        gateObserver.mockRestore();
        queryObserver.mockRestore();
      }
    });
  });

  it.each([
    "commit",
    "rollback",
    "timeout",
  ] as const)("publishes while an alarm transaction releases a shared PostgreSQL resource after %s", async (transactionOutcome) => {
    const spaceId = await createSpace();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const ownerUserId = "owner-test-default";
    const clientMessageId = `pool-gate-${randomUUID()}`;
    const resourceKey = Number.parseInt(randomUUID().slice(0, 8), 16);
    const controlKey = resourceKey + 0x1_00_00_00_00;
    const fixtureName = `pool_gate_${randomUUID().replaceAll("-", "")}`;
    const operator = postgresFixtureOperator(env);
    const controllerReady = Promise.withResolvers<void>();
    const releaseController = Promise.withResolvers<void>();

    // A real transaction-scoped lock models one scarce origin resource. The
    // trigger bounds the failed publication without waiting for a DO reset.
    await operator.query(`
      CREATE FUNCTION public.${fixtureName}() RETURNS trigger LANGUAGE plpgsql AS $fixture$
      BEGIN
        PERFORM set_config('lock_timeout', '1500ms', true);
        PERFORM pg_advisory_xact_lock(${resourceKey}::bigint);
        RETURN NEW;
      END $fixture$;
      CREATE TRIGGER ${fixtureName} BEFORE INSERT OR UPDATE
        ON "openmeld"."user_time_contexts" FOR EACH ROW
        WHEN (NEW.user_id = '${ownerUserId}')
        EXECUTE FUNCTION public.${fixtureName}();
    `);
    try {
      await runInDurableObject(stub, async (instance, state) => {
        // This fixture drives redelivery explicitly. A long deadline would
        // otherwise let an automatically due alarm overwrite the failed row.
        await state.storage.deleteAlarm();
        const alarmScheduling = vi
          .spyOn(state.storage, "setAlarm")
          .mockResolvedValue(undefined);
        let controllerPid = 0;
        const controller = withPostgresRequest(
          env.TEST_POSTGRESQL_OWNER,
          async () => {
            const pool = getPostgresRequestPool();
            pool.on("error", () => undefined);
            const client = await pool.connect();
            const controllerEnded = new Promise<void>((resolve) =>
              client.once("end", resolve)
            );
            client.on("error", () => undefined);
            try {
              await client.query("BEGIN");
              await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
                controlKey,
              ]);
              controllerPid = Number(
                (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
                  ?.pid
              );
              controllerReady.resolve();
              await releaseController.promise;
            } finally {
              client.release(true);
              await controllerEnded;
            }
          }
        );
        await controllerReady.promise;
        const member = readSpaceMemberRecord(
          state.storage.sql,
          DEFAULT_HUMAN_PROFILE_ID
        );
        if (!member) {
          throw new Error("Expected the seeded Space member");
        }
        // A membership added by someone else produces a real Inbox write
        // after the alarm projects its dirty Space Index snapshot.
        upsertSpaceMemberRecord(state.storage.sql, {
          ...member,
          addedByOwnerUserId: null,
        });
        const outsideStarted = Promise.withResolvers<void>();
        let heldTransaction = false;
        const nativeTransaction = PostgresDatabase.prototype.transaction;
        const transactionObserver = vi
          .spyOn(PostgresDatabase.prototype, "transaction")
          .mockImplementation(function (
            this: PostgresDatabase,
            callback: (client: PoolClient) => Promise<unknown>
          ) {
            return nativeTransaction.call(this, async (client) => {
              if (heldTransaction) {
                return callback(client);
              }
              heldTransaction = true;
              await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
                resourceKey,
              ]);
              const result = await callback(client);
              // The real Inbox write is still uncommitted. A pending native
              // socket completion must be allowed to reach COMMIT before a
              // publication gate waits for the same resource.
              const pending = client.query(
                "SELECT pg_advisory_xact_lock($1::bigint)",
                [controlKey]
              );
              outsideStarted.resolve();
              await pending;
              if (transactionOutcome === "rollback") {
                throw new Error("fixture alarm transaction rollback");
              }
              return result;
            });
          });
        const nativeGate = state.blockConcurrencyWhile.bind(state);
        let releasedControl = false;
        const gateObserver =
          transactionOutcome === "timeout"
            ? undefined
            : vi
                .spyOn(state, "blockConcurrencyWhile")
                .mockImplementation(
                  <T>(callback: () => Promise<T>): Promise<T> => {
                    return nativeGate(async () => {
                      if (!releasedControl) {
                        releasedControl = true;
                        // Release the fixture lock server-side using a fresh socket
                        // inside the gate. The controller's old socket need not run.
                        await postgresFixtureOperator(env).query(
                          "SELECT pg_terminate_backend($1)",
                          [controllerPid]
                        );
                        releaseController.resolve();
                      }
                      return await callback();
                    });
                  }
                );
        let firstAlarmFailureStatus: string | undefined;
        const alarm = instance.alarm().then(() => {
          firstAlarmFailureStatus = state.storage.sql
            .exec<{ status: string }>(
              `SELECT status FROM space_index_projection_outbox
               WHERE last_error = ?
                 OR last_error LIKE 'PostgreSQL transaction exceeded its %ms budget'
                 OR last_error LIKE '%transaction timeout%'`,
              "fixture alarm transaction rollback"
            )
            .toArray()[0]?.status;
        });
        try {
          await Promise.race([
            outsideStarted.promise,
            alarm.then(() => {
              throw new Error("Alarm did not reach its Inbox transaction");
            }),
          ]);
          const context = {
            ...createRpcContext({
              requestId: clientMessageId,
              profileId: DEFAULT_HUMAN_PROFILE_ID,
              profileKind: "human",
              profileName: "Test User",
              ownerUserId,
            }),
            userTimeZoneObservation: {
              timeZone: "Asia/Taipei",
              source: "web" as const,
            },
          };
          const request = {
            authoringPolicy: "user_authored" as const,
            clientMessageId,
            context,
            meta: { clientMessageId },
            profile: {
              kind: "human" as const,
              profileId: DEFAULT_HUMAN_PROFILE_ID,
            },
            spaceId,
            text: "Publication waits for the alarm transaction to finish",
          };
          if (transactionOutcome === "timeout") {
            // An external Space request cannot enter while the admitted
            // transaction owns the native gate. Check recovery after expiry.
            await alarm;
          }
          const posted =
            await instance.rpcPostSignalOnceByClientMessageId(request);
          expect(posted).toMatchObject({
            type: "signal.text",
            data: { text: request.text },
          });
          expect(
            await instance.rpcPostSignalOnceByClientMessageId(request)
          ).toEqual(posted);
          await alarm;
          if (transactionOutcome !== "commit") {
            expect(firstAlarmFailureStatus).toBe("failed");
            if (transactionOutcome === "timeout") {
              expect(
                state.storage.sql
                  .exec<{ last_error: string }>(
                    "SELECT last_error FROM space_index_projection_outbox WHERE status = 'failed'"
                  )
                  .one().last_error
              ).toBe("terminating connection due to transaction timeout");
            }
            state.storage.sql.exec(
              "UPDATE space_index_projection_outbox SET next_retry_at_ms = 0 WHERE status = 'failed'"
            );
            await instance.alarm();
          }
          expect(
            (
              await getPostgresDatabase(env).query({
                text: 'SELECT COUNT(*)::int AS count FROM "openmeld"."inbox_items" WHERE source_key = $1',
                values: [
                  `space-joined:${spaceId}:${member.profileId}:${Date.parse(member.addedAt)}`,
                ],
              })
            ).rows
          ).toEqual([{ count: 1 }]);
        } finally {
          releaseController.resolve();
          await alarm.catch(() => undefined);
          await controller;
          alarmScheduling.mockRestore();
          gateObserver?.mockRestore();
          transactionObserver.mockRestore();
        }
      });
    } finally {
      releaseController.resolve();
      await operator.query(`DROP TRIGGER ${fixtureName} ON "openmeld"."user_time_contexts";
        DROP FUNCTION public.${fixtureName}();`);
    }
  }, 25_000);

  it.each([
    "conversation",
    "thread",
  ])("rejects another sender's receipt in a %s", async (location) => {
    const spaceId = await createSpace();
    const otherProfileId = randomUUID();
    const otherOwnerUserId = randomUUID();
    const other = {
      profileId: otherProfileId,
      openMeldProfileId: otherProfileId,
      ownerUserId: otherOwnerUserId,
    };
    const added = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        body: JSON.stringify({
          members: [
            {
              profileId: otherProfileId,
              profileName: "Other sender",
              profileKind: "human",
              ownerUserId: otherOwnerUserId,
              ownerName: "Other sender",
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(added.status, await added.clone().text()).toBe(200);
    if (location === "conversation") {
      await ensureTestOrganizationMembership({
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        userId: otherOwnerUserId,
      });
      const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
      const stub = namespace.get(namespace.idFromString(spaceId));
      const context = createRpcContext({
        requestId: "receipt-author",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        ownerUserId: DEFAULT_TEST_AUTH_PROFILE.ownerUserId,
      });
      const clientMessageId = `new-task:v1:${"a".repeat(64)}`;
      const request = {
        authoringPolicy: "system_emitted" as const,
        clientMessageId,
        context,
        meta: { clientMessageId },
        profile: {
          kind: "human" as const,
          profileId: DEFAULT_HUMAN_PROFILE_ID,
        },
        spaceId,
        text: "Start a new task from this request",
      };
      const invalidSelectionError = await stub
        .rpcPostSignalOnceByClientMessageId({
          ...request,
          contextSelection: { mode: "new" },
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(invalidSelectionError).toBeInstanceOf(Error);
      expect((invalidSelectionError as Error).message).toContain(
        "space.execution_context.unsupported"
      );
      const accepted = await stub.rpcPostSignalOnceByClientMessageId(request);
      expect(await stub.rpcPostSignalOnceByClientMessageId(request)).toEqual(
        accepted
      );
      // A claimed Profile in the payload must not replace the authorized actor.
      const foreignError = await stub
        .rpcPostSignalOnceByClientMessageId({
          ...request,
          context: createRpcContext({
            requestId: "other-receipt-author",
            profileId: otherProfileId,
            profileKind: "human",
            ownerUserId: otherOwnerUserId,
          }),
        })
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(foreignError).toBeInstanceOf(Error);
      expect((foreignError as Error).message).toContain(
        "space.signal.client_message_id_conflict"
      );
      expect(await stub.rpcPostSignalOnceByClientMessageId(request)).toEqual(
        accepted
      );
      return;
    }
    let url = `${BASE_URL}/v1/spaces/${spaceId}/signals`;
    if (location === "thread") {
      const root = await fetchWithOpenMeldAuth(url, {
        method: "POST",
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Recovery request" },
        }),
      });
      const rootSignal = parseEnvelope(await root.json());
      if (!rootSignal) {
        throw new Error("Expected a thread root");
      }
      const created = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/threads`,
        {
          method: "POST",
          body: JSON.stringify({
            clientMutationId: randomUUID(),
            rootSignalId: rootSignal.id,
          }),
        }
      );
      expect(created.status, await created.clone().text()).toBe(200);
      const { thread } = (await created.json()) as {
        thread: { threadId: string };
      };
      url = `${BASE_URL}/v1/spaces/${spaceId}/threads/${thread.threadId}/signals`;
    }
    const clientMessageId = `new-task:v1:${"a".repeat(64)}`;
    const text = "Start a new task from this request";
    // Public thread replies cannot select a session without a Wake target.
    // Rejection must not consume the ID used by the valid receipt below.
    const invalid = await fetchWithOpenMeldAuth(url, {
      method: "POST",
      body: JSON.stringify({
        clientMessageId,
        text,
        contextSelection: { mode: "new" },
      }),
    });
    expect(invalid.status, await invalid.clone().text()).toBe(400);
    expect(await invalid.text()).toContain(
      "space.execution_context.unsupported"
    );
    const request = {
      method: "POST",
      body: JSON.stringify({ clientMessageId, text }),
    };
    const first = await fetchWithOpenMeldAuth(url, request);
    expect(first.status, await first.clone().text()).toBe(200);
    const accepted = await first.json();
    const replay = await fetchWithOpenMeldAuth(url, request);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toEqual(accepted);
    const foreignReplay = await fetchWithOpenMeldAuth(url, request, other);
    expect(foreignReplay.status, await foreignReplay.clone().text()).toBe(409);
    expect(await foreignReplay.text()).toContain(
      "space.signal.client_message_id_conflict"
    );
    const afterConflict = await fetchWithOpenMeldAuth(url, request);
    expect(afterConflict.status, await afterConflict.clone().text()).toBe(200);
    expect(await afterConflict.json()).toEqual(accepted);
    const historyResponse = await fetchWithOpenMeldAuth(url);
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals: SignalEnvelope[];
    };
    const matching = history.signals.filter(
      (signal) => signal.type === "signal.text" && signal.data.text === text
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]?.profile.profileId).toBe(DEFAULT_HUMAN_PROFILE_ID);
  });

  it("freezes authenticated Thread reply time before idempotent replay", async () => {
    const ownerUserId = randomUUID();
    const profileId = randomUUID();
    const author = { ownerUserId, profileId, openMeldProfileId: profileId };
    const spaceId = await createSpace(undefined, author);
    const rootResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Thread root" },
        }),
      },
      author
    );
    expect(rootResponse.status).toBe(200);
    const root = parseEnvelope(await rootResponse.json());
    if (!root) {
      throw new Error("Expected a thread root signal");
    }
    const threadResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads`,
      {
        method: "POST",
        body: JSON.stringify({
          clientMutationId: randomUUID(),
          rootSignalId: root.id,
        }),
      },
      author
    );
    expect(threadResponse.status).toBe(200);
    const { thread } = (await threadResponse.json()) as {
      thread: { threadId: string };
    };
    const request = {
      method: "POST",
      body: JSON.stringify({
        clientMessageId: randomUUID(),
        text: "Please remind me in ten minutes.",
      }),
    };
    const url = `${BASE_URL}/v1/spaces/${spaceId}/threads/${thread.threadId}/signals`;
    const response = await fetchWithOpenMeldAuth(url, request, author, {
      userTimeZoneObservation: { timeZone: "Asia/Taipei", source: "web" },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const accepted = (await response.json()) as { signal: SignalEnvelope };
    const acceptedTime = {
      timeZone: "Asia/Taipei",
      source: "web",
      observedAtMs: accepted.signal.ts,
    };
    expect(
      await readUserTimeContext(getPostgresDatabase(env), ownerUserId)
    ).toEqual(acceptedTime);
    const replay = await fetchWithOpenMeldAuth(url, request, author, {
      userTimeZoneObservation: {
        timeZone: "America/Los_Angeles",
        source: "web",
      },
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ signal: accepted.signal });
    expect(
      await readUserTimeContext(getPostgresDatabase(env), ownerUserId)
    ).toEqual(acceptedTime);
  });
  it("rejects Reference targets after their Space membership is removed", async () => {
    const spaceId = await createSpace();
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: THIRD_HUMAN_PROFILE_ID,
              profileName: "Removed Reference",
              profileKind: "human",
              ownerUserId: null,
              ownerName: null,
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    await addResponse.json();
    const removeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [THIRD_HUMAN_PROFILE_ID],
        }),
      }
    );
    expect(removeResponse.status).toBe(200);
    await removeResponse.json();
    const clientMessageId = `reference-removed-member-${randomUUID()}`;
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Test User",
          },
          type: "signal.text",
          data: {
            text: "@Removed Reference(reference) for context",
            messageEnvelope: {
              text: "@Removed Reference(reference) for context",
              activationTargets: [],
              referenceTargets: [THIRD_HUMAN_PROFILE_ID],
            },
            meta: { clientMessageId },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(422);
    await expect(postResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "space.addressing.target_invalid",
      targetProfileId: THIRD_HUMAN_PROFILE_ID,
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: unknown[];
    };
    expect(list.signals).toEqual([]);
  });
  it("returns structured JSON error for invalid space ids", async () => {
    const invalidSpaceId = "this-space-id-is-longer-than-thirty-two-characters";
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${invalidSpaceId}/signals`
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(body.error?.code).toBe("invalid_space_id");
    expect(body.error?.message).toContain("64-char hex");
  });
  it("returns not found for unresolved 64-char hex space ids", async () => {
    const unresolvedSpaceId = "a".repeat(64);
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${unresolvedSpaceId}/signals`
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(body.error?.code).toBe("space.not_found");
    expect(body.error?.message).toBe("space not found");
  });
  it("returns structured JSON error for invalid cursor profile ids", async () => {
    const spaceId = await createSpace();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/cursors/%20`
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(body.error?.code).toBe("invalid_profile_id");
    expect(body.error?.message).toBe("profile id is invalid");
  });
  it("supports catch-up query with afterTs and cursor pagination", async () => {
    const spaceId = await createSpace();
    const messages = ["m1", "m2", "m3", "m4", "m5"];
    const posted: Array<{
      ts: number;
      data: {
        text?: string;
      };
      type: "signal.text";
    }> = [];
    for (const text of messages) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile: {
              kind: "human",
              profileId: "alice",
              profileName: "Alice",
            },
            type: "signal.text",
            data: { text },
          }),
        }
      );
      expect(response.status).toBe(200);
      const payload = parseEnvelope(await response.json());
      if (!isTextSignalEnvelope(payload)) {
        throw new Error("Expected signal.text envelope from POST /signals");
      }
      posted.push(payload);
    }
    const afterTs = posted[0]?.ts ?? 0;
    const page1 = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=${afterTs}&limit=2`
    );
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      signals?: Array<{
        ts: number;
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(Array.isArray(body1.signals)).toBe(true);
    expect(body1.signals).toHaveLength(2);
    expect(body1.signals?.[0]?.data.text).toBe("m2");
    expect(body1.signals?.[1]?.data.text).toBe("m3");
    expect(typeof body1.nextCursor).toBe("string");
    const page2 = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=${afterTs}&limit=2&cursor=${encodeURIComponent(body1.nextCursor ?? "")}`
    );
    expect(page2.status).toBe(200);
    const body2 = (await page2.json()) as {
      signals?: Array<{
        ts: number;
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body2.signals).toHaveLength(2);
    expect(body2.signals?.[0]?.data.text).toBe("m4");
    expect(body2.signals?.[1]?.data.text).toBe("m5");
    expect(body2.nextCursor).toBeNull();
  });
  it("rejects malformed numeric query values in signals listing", async () => {
    const spaceId = await createSpace();
    const invalidAfterTsResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=123abc`
    );
    expect(invalidAfterTsResponse.status).toBe(400);
    await expect(invalidAfterTsResponse.text()).resolves.toBe(
      "Invalid afterTs"
    );
    const invalidLimitResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?limit=10foo`
    );
    expect(invalidLimitResponse.status).toBe(400);
    await expect(invalidLimitResponse.text()).resolves.toBe("Invalid limit");
  });
  it("keeps list-signals query behavior aligned with shared schema", async () => {
    const spaceId = await createSpace();
    const endpoint = `${BASE_URL}/v1/spaces/${spaceId}/signals`;
    const scenarios = [
      {
        query: "",
        expectedStatus: 200,
      },
      {
        query: "?afterTs=0",
        expectedStatus: 200,
      },
      {
        query: "?limit=2",
        expectedStatus: 200,
      },
      {
        query: "?cursor=cursor-only",
        expectedStatus: 200,
      },
      {
        query: "?recent=true&limit=2",
        expectedStatus: 200,
      },
      {
        query: "?afterTs=123abc",
        expectedStatus: 400,
      },
      {
        query: "?limit=10foo",
        expectedStatus: 400,
      },
      {
        query: "?afterTs=8640000000000001",
        expectedStatus: 400,
      },
      {
        query: "?afterSignalId=sig-anchor-1&aroundSignalId=sig-anchor-2",
        expectedStatus: 400,
      },
      {
        query: "?aroundSignalId=sig-anchor-1&limit=2&beforeCount=1",
        expectedStatus: 400,
      },
    ] as const;
    for (const scenario of scenarios) {
      const url = new URL(`${endpoint}${scenario.query}`);
      const schema = listSignalsQuerySchema.safeParse(
        readListSignalsQueryRawValues(url.searchParams)
      );
      const response = await fetchWithOpenMeldAuth(url.toString());
      expect(response.status).toBe(scenario.expectedStatus);
      expect(response.ok).toBe(schema.success);
      if (!schema.success) {
        const bodyText = await response.text();
        const issueMessages = schema.error.issues.map((issue) => issue.message);
        expect(issueMessages.some((message) => message === bodyText)).toBe(
          true
        );
        continue;
      }
      const payload = await response.json();
      expect(payload).toMatchObject({
        signals: expect.any(Array),
      });
      expect(Object.hasOwn(payload as object, "nextCursor")).toBe(true);
    }
  });
  it("reads history after one anchor signal with profile and type filters", async () => {
    const spaceId = await createSpace();
    const posted: SignalEnvelope[] = [];
    for (const [profileId, profileName, text] of [
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m1"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "m2"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m3"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m4"],
    ] as const) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile: {
              kind: "human",
              profileId,
              profileName,
            },
            type: "signal.text",
            data: { text },
          }),
        }
      );
      expect(response.status).toBe(200);
      const payload = parseEnvelope(await response.json());
      if (!payload) {
        throw new Error("Expected signal envelope from POST /signals");
      }
      posted.push(payload);
    }
    await rpcPostStatusSignal(env as CoreBindings, {
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_finalization",
      profile: {
        kind: "human",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileName: "alice",
      },
      data: {
        actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
        dispatchId: "status-1-dispatch",
        generatedBy: "openmeld",
        status: "done",
        text: "status-1",
      },
      context: createRpcContext({
        requestId: DEFAULT_REQUEST_ID,
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "alice",
      }),
    });
    const anchorSignalId = posted[0]?.id;
    expect(anchorSignalId).toBeTruthy();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterSignalId=${encodeURIComponent(anchorSignalId ?? "")}&limit=4&fromProfileId=${encodeURIComponent(DEFAULT_HUMAN_PROFILE_ID)}&signalType=signal.text`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      signals?: Array<{
        data?: {
          text?: string;
        };
        profile?: {
          profileId?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body.signals?.map((signal) => signal.data?.text)).toEqual([
      "m3",
      "m4",
    ]);
    expect(
      body.signals?.every(
        (signal) => signal.profile?.profileId === DEFAULT_HUMAN_PROFILE_ID
      )
    ).toBe(true);
    expect(body.nextCursor).toBeNull();
  });
  it("keeps reading after an anchor until it collects enough filtered matches", async () => {
    const spaceId = await createSpace();
    const posted: SignalEnvelope[] = [];
    for (const [profileId, profileName, text] of [
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "anchor"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b1"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b2"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b3"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b4"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b5"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b6"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b7"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b8"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "b9"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m10"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m11"],
    ] as const) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile: {
              kind: "human",
              profileId,
              profileName,
            },
            type: "signal.text",
            data: { text },
          }),
        }
      );
      expect(response.status).toBe(200);
      const payload = parseEnvelope(await response.json());
      if (!payload) {
        throw new Error("Expected signal envelope from POST /signals");
      }
      posted.push(payload);
    }
    const anchorSignalId = posted[0]?.id;
    expect(anchorSignalId).toBeTruthy();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterSignalId=${encodeURIComponent(anchorSignalId ?? "")}&limit=2&fromProfileId=${encodeURIComponent(DEFAULT_HUMAN_PROFILE_ID)}&signalType=signal.text`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      signals?: Array<{
        data?: {
          text?: string;
        };
        profile?: {
          profileId?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body.signals?.map((signal) => signal.data?.text)).toEqual([
      "m10",
      "m11",
    ]);
    expect(
      body.signals?.every(
        (signal) => signal.profile?.profileId === DEFAULT_HUMAN_PROFILE_ID
      )
    ).toBe(true);
    expect(body.nextCursor).toBeNull();
  });
  it("reads recent visible message history after presence noise", async () => {
    const spaceId = await createSpace();
    const noiseSockets: WebSocket[] = [];
    try {
      await postTextSignal(spaceId, "older-message");
      for (let index = 0; index < 9; index += 1) {
        noiseSockets.push(
          await openSpaceSocket(spaceId, {
            kind: "human",
            profileId: `presence-noise-${index}`,
            profileName: `Presence Noise ${index}`,
          })
        );
      }
      await postTextSignal(spaceId, "latest-message");
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals?recent=1&limit=2&signalType=signal.text`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        signals?: Array<{
          data?: {
            text?: string;
          };
        }>;
        nextCursor?: string | null;
      };
      expect(body.signals?.map((signal) => signal.data?.text)).toEqual([
        "older-message",
        "latest-message",
      ]);
      expect(body.nextCursor).toBeNull();
    } finally {
      for (const socket of noiseSockets) {
        socket.close(1000, "done");
      }
    }
  });
  it("searches retained message text through the authorized Space endpoint", async () => {
    const spaceId = await createSpace({ accessMode: "members_only" });
    await postTextSignal(spaceId, "Searchable invoice older");
    await postTextSignal(spaceId, "Unrelated latest message");
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?q=invoice&limit=30`
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      signals: [{ data: { text: "Searchable invoice older" } }],
      searchIndexing: false,
      nextCursor: null,
    });
    const denied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?q=invoice&limit=30`,
      undefined,
      {
        profileId: SECOND_HUMAN_PROFILE_ID,
        openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
        ownerUserId: "search-other-owner",
        profileName: "Other reader",
      }
    );
    expect(denied.status).toBe(403);
    await denied.text();
    const context = createRpcContext({
      requestId: "search-member",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      ownerUserId: "owner-test-default",
    });
    const search = await rpcSearchMessages(env as unknown as CoreBindings, {
      q: "invoice",
      spaceId,
      scope: "messages",
      context,
    });
    expect(search.matches.map((match) => match.signal.data.text)).toEqual([
      "Searchable invoice older",
    ]);
    const excluded = await rpcSearchMessages(env as unknown as CoreBindings, {
      q: "invoice",
      spaceId,
      scope: "messages",
      context: createRpcContext({
        requestId: "search-other",
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        ownerUserId: "search-other-owner",
      }),
    });
    expect(excluded.matches).toEqual([]);
    const publicSpaceId = await createSpace({ accessMode: "public" });
    await postTextSignal(publicSpaceId, "Public searchable invoice");
    const publicSearch = await rpcSearchMessages(
      env as unknown as CoreBindings,
      {
        q: "invoice",
        spaceId: publicSpaceId,
        scope: "messages",
        context: createRpcContext({
          requestId: "search-public-reader",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          ownerUserId: "search-other-owner",
        }),
      }
    );
    expect(publicSearch.matches.map((match) => match.signal.data.text)).toEqual(
      ["Public searchable invoice"]
    );
    const inbox = await rpcSearchMessages(env as unknown as CoreBindings, {
      q: "invoice",
      spaceId,
      scope: "inbox",
      context,
    });
    expect(inbox.activities).toEqual([]);
    expect(inbox.nextCursor).not.toBeNull();
    const inboxMessages = await rpcSearchMessages(
      env as unknown as CoreBindings,
      {
        q: "invoice",
        spaceId,
        scope: "inbox",
        context,
        cursor: inbox.nextCursor ?? undefined,
      }
    );
    // Posting a message does not make it an Inbox item for its author.
    expect(inboxMessages.matches).toEqual([]);
    expect(inboxMessages.nextCursor).toBeNull();
    await expect(
      rpcSearchMessages(env as unknown as CoreBindings, {
        q: "invoice",
        scope: "messages",
        context,
        cursor: "invalid-json",
      })
    ).rejects.toThrow("Invalid message search cursor");
    for (let index = 0; index < 31; index += 1) {
      await postTextSignal(spaceId, `Paging receipt ${index}`);
    }
    const first = await rpcSearchMessages(env as unknown as CoreBindings, {
      q: "Paging receipt",
      spaceId,
      scope: "messages",
      context,
    });
    expect(first.matches).toHaveLength(30);
    expect(first.nextCursor).not.toBeNull();
    const second = await rpcSearchMessages(env as unknown as CoreBindings, {
      q: "Paging receipt",
      spaceId,
      scope: "messages",
      context,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.matches).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.matches, ...second.matches].map((match) => match.signal.id)
      ).size
    ).toBe(31);
  });
  it("pages more than 100 messages through the shared reader and checks access on continuation", async () => {
    const spaceId = await createSpace({ accessMode: "members_only" });
    const context = createRpcContext({
      requestId: "bounded-reader",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      ownerUserId: "owner-test-default",
    });
    const original = Array.from(
      { length: 105 },
      (_, index) => `Read fixture ${index}`
    );
    original[104] = `${"消息🙂".repeat(1000)} target-tail`;
    for (const text of original) {
      await postTextSignal(spaceId, text);
    }
    const query = messageReadQuerySchema.parse({
      spaceId,
      mode: "full",
      limit: 105,
      maxBytes: 4096,
    });
    const first = await rpcReadMessages(env as unknown as CoreBindings, {
      ...query,
      context,
    });
    expect(first.nextCursor).not.toBeNull();
    expect(first.matches.length).toBeLessThan(100);
    const messages = [...first.matches];
    let cursor = first.nextCursor;
    let pages = 1;
    while (cursor) {
      const page = await rpcReadMessages(env as unknown as CoreBindings, {
        ...query,
        cursor,
        context,
      });
      expect(
        new TextEncoder().encode(JSON.stringify(page)).length
      ).toBeLessThanOrEqual(query.maxBytes);
      messages.push(...page.matches);
      cursor = page.nextCursor;
      expect(++pages).toBeLessThan(40);
    }
    expect(new Set(messages.map((match) => match.signal.id)).size).toBe(105);
    const assembled = new Map<string, string>();
    for (const match of messages) {
      const prior = assembled.get(match.signal.id) ?? "";
      expect(match.content.offset).toBe(prior.length);
      assembled.set(match.signal.id, prior + match.signal.data.text);
    }
    expect([...assembled.values()]).toEqual([...original].reverse());
    await expect(
      rpcReadMessages(env as unknown as CoreBindings, {
        ...query,
        cursor: first.nextCursor ?? undefined,
        context: createRpcContext({
          requestId: "other-reader",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          ownerUserId: "search-other-owner",
        }),
      })
    ).rejects.toThrow();
    const search = await rpcReadMessages(env as unknown as CoreBindings, {
      ...query,
      q: "Read fixture 0",
      mode: "preview",
      context,
    });
    expect(search.matches.map((match) => match.signal.id)).toEqual([
      messages.at(-1)?.signal.id,
    ]);
    const tail = await rpcReadMessages(env as unknown as CoreBindings, {
      ...query,
      q: "target-tail",
      mode: "preview",
      context,
    });
    expect(tail.matches[0]?.signal.data.text).toContain("target-tail");
    expect(tail.matches[0]?.content.complete).toBe(false);
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId,
      agentProfileName: "Context Reader",
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      ownerUserId: "owner-test-default",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await runInDurableObject(stub, (_instance, state) => {
      upsertJoinedSpaceMember({
        sql: state.storage.sql,
        spaceId,
        profile: {
          kind: "agent",
          profileId: agentProfileId,
          profileName: "Context Reader",
        },
      });
    });
    const readSubmissionId = `read-${randomUUID()}`;
    const agentContext = createRpcContext({
      requestId: "agent-bounded-reader",
      profileId: agentProfileId,
      profileKind: "agent",
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      agentControllerConversationId: readSubmissionId,
    });
    const db = getPostgresDatabase(env);
    const bindingId = `read-binding-${randomUUID()}`;
    await ensurePrimaryAgentProfileBindingRecord({
      db,
      record: {
        agentProfileId,
        bindingId,
        agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        owner: { kind: "organization", id: DEFAULT_TEST_ORGANIZATION_ID },
        openMeldServiceRuntimeId: "context-reader-test",
        runtimeKind: "hosted_center_agent",
        hostedRuntimeIdentityJson: JSON.stringify(
          HOSTED_CENTER_AGENT_RUNTIME_IDENTITY
        ),
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    });
    const fixture = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      agentProfileId,
      bindingId,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      spaceId,
      dispatchId: `read-dispatch-${randomUUID()}`,
      idempotencyKey: `read-key-${randomUUID()}`,
      author: {
        displayName: "Requester",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
      },
      turnEnvelope: {
        ...fixture.turnEnvelope,
        organization: {
          ...fixture.turnEnvelope.organization,
          id: DEFAULT_TEST_ORGANIZATION_ID,
        },
        space: { ...fixture.turnEnvelope.space, id: spaceId },
        sender: {
          kind: "member",
          id: "requester",
          displayName: "Requester",
          ownerUserId: "owner-test-default",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          role: "owner",
          verified: true,
        },
      },
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      db,
      bindingId,
      attemptId: null,
      dispatchId: request.dispatchId,
      idempotencyKey: request.idempotencyKey,
      nowMs: Date.now(),
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: agentProfileId,
      spaceId,
      status: "submitted",
      triggerMessageId: request.triggerMessageId,
    });
    await persistRemoteAgentWorkerSubmitRequest({
      db,
      idempotencyKey: request.idempotencyKey,
      nowMs: Date.now(),
      workerSubmitRequest: request,
    });
    await markRemoteAgentNativeDeliveryAck({
      db,
      idempotencyKey: request.idempotencyKey,
      nowMs: Date.now(),
      accepted: true,
      submissionId: readSubmissionId,
    });
    const agentPage = await rpcRemoteAgentReadMessages(env as CoreBindings, {
      ...query,
      context: agentContext,
    });
    expect(agentPage.matches.map((match) => match.signal.id)).toEqual(
      first.matches.map((match) => match.signal.id)
    );
    const other = { ownerUserId: randomUUID(), profileId: randomUUID() };
    const privateSpaceId = await createSpace(
      { accessMode: "members_only" },
      other
    );
    const privateMessage = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${privateSpaceId}/signals`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Read fixture 0 private decision" },
        }),
      },
      other
    );
    expect(privateMessage.status).toBe(200);
    const privateStub = namespace.get(namespace.idFromString(privateSpaceId));
    await runInDurableObject(privateStub, (_instance, state) => {
      upsertJoinedSpaceMember({
        sql: state.storage.sql,
        spaceId: privateSpaceId,
        profile: {
          kind: "agent",
          profileId: agentProfileId,
          profileName: "Context Reader",
        },
      });
    });
    await expect(
      rpcRemoteAgentReadMessages(env as CoreBindings, {
        ...query,
        spaceId: privateSpaceId,
        context: agentContext,
      })
    ).rejects.toMatchObject({ status: 404 });
    for (const targetSpaceId of [spaceId, privateSpaceId]) {
      await upsertSpaceIndexMembership({
        db,
        membership: {
          spaceId: targetSpaceId,
          profileId: agentProfileId,
          profileKindSnapshot: "agent",
          profileNameSnapshot: "Context Reader",
          status: "active",
          memberSource: "test",
          addedAt: new Date().toISOString(),
          sourceUpdatedAt: new Date().toISOString(),
          projectionEventId: randomUUID(),
        },
      });
    }
    const global = await rpcRemoteAgentReadMessages(env as CoreBindings, {
      ...query,
      spaceId: undefined,
      mode: "preview",
      q: "Read fixture 0",
      context: agentContext,
    });
    expect(global.matches.map((match) => match.signal.spaceId)).toEqual([
      spaceId,
    ]);
    // An old checkpoint cannot outlive the admitted execution's authority.
    await markRemoteAgentNativeDeliveryCompleted({
      db,
      submissionId: readSubmissionId,
      nowMs: Date.now(),
      publishedSignalId: null,
    });
    await expect(
      rpcRemoteAgentReadMessages(env as CoreBindings, {
        ...query,
        cursor: agentPage.nextCursor ?? undefined,
        context: agentContext,
      })
    ).rejects.toThrow();
    await expect(
      rpcRemoteAgentReadMessages(env as CoreBindings, { ...query, context })
    ).rejects.toThrow("designated Center Agent");
  }, 30_000);
  it("keeps workspace read order and rechecks access after speculative reads", async () => {
    const reader = { ownerUserId: randomUUID(), profileId: randomUUID() };
    const spaces: string[] = [];
    for (let index = 0; index < 7; index++) {
      spaces.push(await createSpace({ accessMode: "members_only" }, reader));
    }
    spaces.sort();
    const expected = new Map<string, string>();
    for (const index of [0, 1, 2, 4, 6]) {
      const spaceId = spaces[index];
      if (!spaceId) {
        throw new Error("Missing search fixture Space");
      }
      const text = `ordered-search ${index} ${index === 0 ? "消息🙂".repeat(1000) : "hit"}`;
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          body: JSON.stringify({ type: "signal.text", data: { text } }),
        },
        reader
      );
      expect(response.status).toBe(200);
      await response.text();
      if (index !== 2) {
        expected.set(spaceId, text);
      }
    }
    const context = createRpcContext({
      requestId: "ordered-workspace-reader",
      profileKind: "human",
      ...reader,
    });
    const query = {
      ...messageReadQuerySchema.parse({
        q: "ordered-search",
        mode: "full",
        maxBytes: 4096,
      }),
      context,
    };
    const first = await rpcReadMessages(env as CoreBindings, query);
    expect(first.matches).toHaveLength(1);
    expect(first.matches[0]?.signal.spaceId).toBe(spaces[0]);
    expect(first.matches[0]?.content.complete).toBe(false);
    expect(
      await rpcReadMessages(env as CoreBindings, {
        ...query,
        cursor: first.pageCursor ?? undefined,
      })
    ).toEqual(first);
    // Keep directory discovery stale: the owning Space must reject this read
    // even though a previous wave could already have read its matching message.
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const revokedSpaceId = spaces[2];
    if (!revokedSpaceId) {
      throw new Error("Missing revoked search fixture Space");
    }
    await runInDurableObject(
      namespace.get(namespace.idFromString(revokedSpaceId)),
      (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE space_members SET status = 'removed' WHERE owner_user_id_snapshot = ?",
          reader.ownerUserId
        );
      }
    );
    const assembled = new Map<string, string>();
    let page = first;
    for (let count = 0; ; count++) {
      expect(count).toBeLessThan(20);
      expect(
        new TextEncoder().encode(JSON.stringify(page)).length
      ).toBeLessThanOrEqual(query.maxBytes);
      for (const match of page.matches) {
        const prior = assembled.get(match.signal.spaceId) ?? "";
        expect(match.content.offset).toBe(prior.length);
        assembled.set(match.signal.spaceId, prior + match.signal.data.text);
      }
      if (!page.nextCursor) {
        expect(page.coverage).toBe("complete");
        break;
      }
      page = await rpcReadMessages(env as CoreBindings, {
        ...query,
        cursor: page.nextCursor,
      });
    }
    expect([...assembled]).toEqual([...expected]);
  }, 30_000);
  it("returns an empty anchored page when after-signal uses limit=0", async () => {
    const spaceId = await createSpace();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: {
            kind: "human",
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "alice",
          },
          type: "signal.text",
          data: { text: "anchor" },
        }),
      }
    );
    expect(response.status).toBe(200);
    const payload = parseEnvelope(await response.json());
    if (!payload) {
      throw new Error("Expected signal envelope from POST /signals");
    }
    const anchoredResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterSignalId=${encodeURIComponent(payload.id)}&limit=0`
    );
    expect(anchoredResponse.status).toBe(200);
    const body = (await anchoredResponse.json()) as {
      signals?: unknown[];
      nextCursor?: string | null;
    };
    expect(body.signals).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
  it("reads a filtered window around one anchor signal and keeps the anchor", async () => {
    const spaceId = await createSpace();
    const posted: SignalEnvelope[] = [];
    for (const [profileId, profileName, text] of [
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m1"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "m2"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m3"],
      [SECOND_HUMAN_PROFILE_ID, "bob", "m4"],
      [DEFAULT_HUMAN_PROFILE_ID, "alice", "m5"],
    ] as const) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile: {
              kind: "human",
              profileId,
              profileName,
            },
            type: "signal.text",
            data: { text },
          }),
        }
      );
      expect(response.status).toBe(200);
      const payload = parseEnvelope(await response.json());
      if (!payload) {
        throw new Error("Expected signal.text envelope from POST /signals");
      }
      posted.push(payload);
    }
    const anchorSignalId = posted[1]?.id;
    expect(anchorSignalId).toBeTruthy();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?aroundSignalId=${encodeURIComponent(anchorSignalId ?? "")}&beforeCount=1&afterCount=2&fromProfileId=${encodeURIComponent(DEFAULT_HUMAN_PROFILE_ID)}`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      signals?: Array<{
        id?: string;
        data?: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body.signals?.map((signal) => signal.data?.text)).toEqual([
      "m1",
      "m2",
      "m3",
      "m5",
    ]);
    expect(body.signals?.[1]?.id).toBe(anchorSignalId);
    expect(body.nextCursor).toBeNull();
    const exactResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?aroundSignalId=${encodeURIComponent(anchorSignalId ?? "")}&beforeCount=0&afterCount=0`
    );
    expect(exactResponse.status).toBe(200);
    const exactBody = (await exactResponse.json()) as {
      signals?: Array<{
        id?: string;
        data?: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(exactBody.signals).toEqual([
      expect.objectContaining({ id: anchorSignalId }),
    ]);
    expect(exactBody.nextCursor).toBeNull();
  });
  it("lazy-loads earlier visible message history before an anchor after presence noise", async () => {
    const spaceId = await createSpace();
    const noiseSockets: WebSocket[] = [];
    try {
      await postTextSignal(spaceId, "older-message");
      for (let index = 0; index < 9; index += 1) {
        noiseSockets.push(
          await openSpaceSocket(spaceId, {
            kind: "human",
            profileId: `earlier-presence-noise-${index}`,
            profileName: `Earlier Presence Noise ${index}`,
          })
        );
      }
      const latest = await postTextSignal(spaceId, "latest-message");
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals?aroundSignalId=${encodeURIComponent(latest.id)}&beforeCount=1&afterCount=0&signalType=signal.text`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        signals?: Array<{
          data?: {
            text?: string;
          };
        }>;
        nextCursor?: string | null;
      };
      expect(body.signals?.map((signal) => signal.data?.text)).toEqual([
        "older-message",
        "latest-message",
      ]);
      expect(body.nextCursor).toBeNull();
    } finally {
      for (const socket of noiseSockets) {
        socket.close(1000, "done");
      }
    }
  });
  it("fails fast when an explicit history anchor does not exist", async () => {
    const spaceId = await createSpace();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterSignalId=missing-anchor`
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: {
        code?: string;
        message?: string;
      };
    };
    expect(body.error?.message).toContain("space history anchor not found");
  });
  it("returns an empty page when afterTs equals MAX_DATE_TIMESTAMP_MS", async () => {
    const spaceId = await createSpace();
    const signalResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profile: { kind: "human", profileId: "alice", profileName: "Alice" },
          type: "signal.text",
          data: { text: "hello" },
        }),
      }
    );
    expect(signalResponse.status).toBe(200);
    await signalResponse.json();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=8640000000000000&limit=2`
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      signals?: unknown[];
      nextCursor?: string | null;
    };
    expect(body.signals).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
  it("keeps nextCursor when cursor page still has more data", async () => {
    const spaceId = await createSpace();
    const messages = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const posted: Array<{
      ts: number;
      data: {
        text?: string;
      };
      type: "signal.text";
    }> = [];
    for (const text of messages) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            profile: {
              kind: "human",
              profileId: "alice",
              profileName: "Alice",
            },
            type: "signal.text",
            data: { text },
          }),
        }
      );
      expect(response.status).toBe(200);
      const payload = parseEnvelope(await response.json());
      if (!isTextSignalEnvelope(payload)) {
        throw new Error("Expected signal.text envelope from POST /signals");
      }
      posted.push(payload);
    }
    const afterTs = posted[0]?.ts ?? 0;
    const page1 = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=${afterTs}&limit=2`
    );
    expect(page1.status).toBe(200);
    const body1 = (await page1.json()) as {
      signals?: Array<{
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body1.signals).toHaveLength(2);
    expect(body1.signals?.[0]?.data.text).toBe("m2");
    expect(body1.signals?.[1]?.data.text).toBe("m3");
    expect(typeof body1.nextCursor).toBe("string");
    const page2 = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=${afterTs}&limit=2&cursor=${encodeURIComponent(body1.nextCursor ?? "")}`
    );
    expect(page2.status).toBe(200);
    const body2 = (await page2.json()) as {
      signals?: Array<{
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body2.signals).toHaveLength(2);
    expect(body2.signals?.[0]?.data.text).toBe("m4");
    expect(body2.signals?.[1]?.data.text).toBe("m5");
    expect(typeof body2.nextCursor).toBe("string");
    const page3 = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=${afterTs}&limit=2&cursor=${encodeURIComponent(body2.nextCursor ?? "")}`
    );
    expect(page3.status).toBe(200);
    const body3 = (await page3.json()) as {
      signals?: Array<{
        data: {
          text?: string;
        };
      }>;
      nextCursor?: string | null;
    };
    expect(body3.signals).toHaveLength(1);
    expect(body3.signals?.[0]?.data.text).toBe("m6");
    expect(body3.nextCursor).toBeNull();
  });
  it("broadcasts WebSocket signals to other clients", async () => {
    const spaceId = await createSpace();
    const aliceRuntimeProfileId = toCanonicalOpenMeldProfileId(
      "alice",
      "human"
    );
    const alice = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "alice",
      profileName: "Alice",
    });
    const bob = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "bob",
      profileName: "Bob",
    });
    const bobReceives = waitForJsonMessage(
      bob,
      (data) =>
        data.type === "signal.text" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === aliceRuntimeProfileId &&
        (
          data.data as {
            text?: string;
          }
        ).text === "hi Bob"
    );
    alice.send(
      JSON.stringify({ type: "signal.text", data: { text: "hi Bob" } })
    );
    const message = await bobReceives;
    expect(message.type).toBe("signal.text");
    expect(
      (
        message.profile as {
          profileId?: string;
        }
      ).profileId
    ).toBe(aliceRuntimeProfileId);
    expect(
      (
        message.data as {
          text?: string;
        }
      ).text
    ).toBe("hi Bob");
    expect(typeof message.ts).toBe("number");
    alice.close(1000, "done");
    bob.close(1000, "done");
  });
  it("preserves image geometry negotiation across WebSocket hibernation", async () => {
    const spaceId = await createSpace({
      name: `websocket-image-geometry-${Date.now()}`,
    });
    const legacyProfile = {
      kind: "human",
      profileId: "legacy-geometry-viewer",
      profileName: "Legacy Geometry Viewer",
    };
    const currentProfile = {
      kind: "human",
      profileId: "current-geometry-viewer",
      profileName: "Current Geometry Viewer",
    };
    const legacy = await openPendingSpaceSocket(spaceId, legacyProfile);
    const current = await openPendingSpaceSocket(spaceId, currentProfile);
    const legacyAck = waitForJsonMessage(
      legacy,
      (data) => data.type === "system.hello.ack"
    );
    const currentAck = waitForJsonMessage(
      current,
      (data) => data.type === "system.hello.ack"
    );
    legacy.send(JSON.stringify({ type: "hello", profile: legacyProfile }));
    current.send(
      JSON.stringify({
        type: "hello",
        profile: currentProfile,
        capabilities: { spaceImageGeometry: true },
      })
    );
    await Promise.all([legacyAck, currentAck]);
    const fileId = randomUUID();
    const signalText = "Image geometry after hibernation";
    const findBroadcast = (data: Record<string, unknown>) => {
      const signal =
        data.type === "space.signal"
          ? (data.signal as Record<string, unknown> | undefined)
          : data;
      return (
        signal?.type === "signal.text" &&
        (
          signal.data as
            | {
                text?: string;
              }
            | undefined
        )?.text === signalText
      );
    };
    const legacyReceives = waitForJsonMessage(legacy, findBroadcast);
    const currentReceives = waitForJsonMessage(current, findBroadcast);
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const context = createRpcContext({
      requestId: "websocket-image-geometry",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    });
    await runInDurableObject(stub, async (_instance, state) => {
      const repository = new SpaceFileRepository(state.storage);
      repository.commitWrite({
        actor: {
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          displayName: "Test User",
          ownerUserId: "owner-test-default",
        },
        auditEvent: {
          actorKind: "authenticated",
          actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
          entryId: fileId,
          errorCode: null,
          eventId: "websocket-image-geometry-file",
          occurredAtMs: Date.now(),
          operation: "content_write",
          operationId: "websocket-image-geometry-file",
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          representedHumanProfileId: null,
          requestId: "websocket-image-geometry-file",
          result: "succeeded",
          revisionId: "websocket-image-geometry-revision",
          spaceId,
        },
        imageDimensions: { width: 1200, height: 800 },
        nowMs: Date.now(),
        write: {
          spaceId,
          fileId,
          revisionId: "websocket-image-geometry-revision",
          name: "landscape.png",
          parentId: null,
          baseRevision: null,
          clientMutationId: "websocket-image-geometry-file",
          mimeType: "image/png",
          sizeBytes: 1024,
        },
      });
      // A fresh Durable Object instance restores both sessions exclusively
      // from their hibernation attachments before broadcasting this signal.
      const restarted = new Space(state, env as unknown as CoreBindings);
      await restarted.rpcPostSignal({
        authoringPolicy: "system_emitted",
        context,
        files: [
          {
            fileId,
            revision: 1,
            name: "untrusted.png",
            mimeType: "application/octet-stream",
            sizeBytes: 1,
          },
        ],
        profile: {
          kind: "human",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileName: "Test User",
        },
        spaceAccess,
        spaceId,
        text: signalText,
      });
    });
    const [legacyMessage, currentMessage] = await Promise.all([
      legacyReceives,
      currentReceives,
    ]);
    expect(JSON.stringify(legacyMessage)).not.toContain("imageDimensions");
    expect(currentMessage).toMatchObject({
      data: {
        files: [
          {
            fileId,
            imageDimensions: { width: 1200, height: 800 },
            mimeType: "image/png",
            name: "landscape.png",
            revision: 1,
            sizeBytes: 1024,
          },
        ],
      },
      type: "signal.text",
    });
    const legacyHistoryResponse = await fetchSpaceDoWithOpenMeldAuth({
      path: "/signals",
      spaceId,
    });
    const currentHistoryResponse = await fetchSpaceDoWithOpenMeldAuth(
      { path: "/signals", spaceId },
      {
        headers: {
          [OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
            OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
        },
      }
    );
    expect(legacyHistoryResponse.status).toBe(200);
    expect(currentHistoryResponse.status).toBe(200);
    const legacyHistory = await legacyHistoryResponse.json();
    const currentHistory = await currentHistoryResponse.json();
    expect(JSON.stringify(legacyHistory)).not.toContain("imageDimensions");
    expect(currentHistory).toMatchObject({
      signals: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            files: [
              expect.objectContaining({
                fileId,
                imageDimensions: { width: 1200, height: 800 },
              }),
            ],
            text: signalText,
          }),
          type: "signal.text",
        }),
      ]),
    });
    legacy.close(1000, "done");
    current.close(1000, "done");
  });
  it("flushes one queued invalidation per topic after the client hello", async () => {
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-pending-invalidation-host",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const agentProfileIds = [
      "agt_44444444-4444-4444-8444-444444444444",
      "agt_55555555-5555-4555-8555-555555555555",
    ] as const;
    const spaceId = await createSpace(
      { name: `pending-invalidation-${Date.now()}` },
      creatorProfile
    );
    const addMemberResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: agentProfileIds[0],
              profileName: "First Pending Agent",
              profileKind: "agent",
              ownerUserId: "owner-first-pending-agent",
              ownerName: "First Pending Agent Owner",
              agentControllerRef: "builtin:codex",
            },
            {
              profileId: agentProfileIds[1],
              profileName: "Second Pending Agent",
              profileKind: "agent",
              ownerUserId: "owner-second-pending-agent",
              ownerName: "Second Pending Agent Owner",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addMemberResponse.status).toBe(200);
    await addMemberResponse.json();
    const profile = {
      kind: "human",
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileName: "Space Host",
    };
    const socket = await openPendingSpaceSocket(
      spaceId,
      profile,
      undefined,
      creatorProfile
    );
    const invalidations: Record<string, unknown>[] = [];
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const frame = JSON.parse(event.data) as Record<string, unknown>;
      if (frame.type === "agent.readiness.invalidated") {
        invalidations.push(frame);
      }
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await stub.rpcBroadcastAgentReadinessInvalidated({
      agentProfileIds: [agentProfileIds[0]],
      reason: "test.pending.first",
      spaceId,
    });
    await stub.rpcBroadcastAgentReadinessInvalidated({
      agentProfileIds: [agentProfileIds[1]],
      reason: "test.pending.second",
      spaceId,
    });
    const ack = waitForJsonMessage(
      socket,
      (data) => data.type === "system.hello.ack"
    );
    socket.send(JSON.stringify({ type: "hello", profile }));
    await ack;
    expect(invalidations).toHaveLength(1);
    expect(invalidations[0]).toMatchObject({
      agentProfileIds,
      reason: "test.pending.second",
      spaceId,
      type: "agent.readiness.invalidated",
    });
    socket.close(1000, "done");
  });
  it("keeps automatic Wake preferences scoped to the account", async () => {
    const hubs = (env as CoreBindings).OPENMELD_RUNTIME_TRANSPORT;
    if (!hubs) {
      throw new Error("Missing RuntimeTransport test binding");
    }
    const accountId = `space-preferences-${randomUUID()}`;
    const account = hubs.get(hubs.idFromName(accountId));
    expect(await account.rpcSpacePreferences({})).toEqual({
      automaticWakeEnabled: true,
    });
    await account.rpcSpacePreferences({ automaticWakeEnabled: false });
    expect(
      await hubs.get(hubs.idFromName(accountId)).rpcSpacePreferences({})
    ).toEqual({ automaticWakeEnabled: false });
    expect(
      await hubs
        .get(hubs.idFromName(`${accountId}-other`))
        .rpcSpacePreferences({})
    ).toEqual({ automaticWakeEnabled: true });
  });

  it("does not replay cleared reasoning or local reasoning without an enabled owner preference", async () => {
    const spaceId = await createSpace();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const profileId = "agt_11111111-1111-4111-8111-111111111111";
    const disabledProfileId = "agt_22222222-2222-4222-8222-222222222222";
    const ownerUserId = `reasoning-owner-${spaceId}`;
    const hubs = (env as CoreBindings).OPENMELD_RUNTIME_TRANSPORT;
    if (!hubs) {
      throw new Error("Missing RuntimeTransport test binding");
    }
    const hub = hubs.get(hubs.idFromName(ownerUserId));
    await hub.rpcReasoningPreferences({ enabled: false });
    await runInDurableObject(stub, (instance) => {
      const internal = instance as unknown as {
        bindings: CoreBindings;
      };
      // This Workers environment has no Auth service binding. Supply the
      // public Auth profile contract without mutating the shared test env.
      const auth = {
        resolveProfileById: (input) =>
          input.openMeldProfileId === disabledProfileId
            ? Promise.resolve({
                ok: true as const,
                profile: {
                  profileId: disabledProfileId,
                  profileHandle: disabledProfileId,
                  profileName: "Disabled Agent",
                  profileKind: "agent" as const,
                  status: "active" as const,
                  ownerUserId,
                },
              })
            : Promise.resolve({
                ok: false as const,
                code: "profile.not_found",
                message: "profile not found",
              }),
      } satisfies Pick<
        NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>,
        "resolveProfileById"
      >;
      internal.bindings = {
        ...internal.bindings,
        OPENMELD_AUTH_WORKER: auth as NonNullable<
          CoreBindings["OPENMELD_AUTH_WORKER"]
        >,
      };
    });
    for (const streamId of ["cleared", "unknown-owner", "disabled-owner"]) {
      await stub.rpcApplyAgentStreamDelta({
        v: 1,
        spaceId,
        streamId,
        profileId:
          streamId === "disabled-owner" ? disabledProfileId : profileId,
        triggerMessageId: `trigger-${streamId}`,
        dispatchId: `dispatch-${streamId}`,
        sequence: 1,
        kind: "thinking",
        thinkingSnapshot: `Private ${streamId}`,
        ...(streamId !== "cleared"
          ? { reasoningState: { status: "streaming" as const } }
          : {}),
      });
      if (streamId === "cleared") {
        await stub.rpcClearReasoningReplay({ spaceId, profileId });
      }
    }
    const received: string[] = [];
    let joined: ReturnType<typeof waitForJsonMessage> | undefined;
    const viewer = await openSpaceSocket(
      spaceId,
      { kind: "human", profileId: "privacy-reader", profileName: "Reader" },
      undefined,
      undefined,
      (socket) => {
        socket.addEventListener("message", (event) => {
          received.push(String(event.data));
        });
        joined = waitForJsonMessage(
          socket,
          (data) => data.type === "presence.join"
        );
      }
    );
    await joined;
    expect(received.join("\n")).not.toContain("Private cleared");
    expect(received.join("\n")).not.toContain("Private unknown-owner");
    expect(received.join("\n")).not.toContain("Private disabled-owner");
    viewer.close(1000, "done");
  });
  it("emits one stopped terminal when Stop forwarding races with ACK cleanup", async () => {
    const spaceId = await createSpace({ name: `stop-cleanup-${Date.now()}` });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(
      namespace.idFromString(spaceId)
    ) as unknown as Pick<
      Space,
      "rpcApplyAgentStreamDelta" | "rpcCloseAgentStream"
    >;
    const streamId = "stream:stop-cleanup";
    const delta = {
      v: 1 as const,
      spaceId,
      streamId,
      sequence: 1,
      profileId: "agt_55555555-5555-4555-8555-555555555555",
      triggerMessageId: "signal-stop-cleanup",
      dispatchId: "dispatch-stop-cleanup",
      textSnapshot: "Checking existing results.",
    };
    await expect(stub.rpcApplyAgentStreamDelta(delta)).resolves.toMatchObject({
      status: "accepted",
    });
    const stop = {
      spaceId,
      streamId,
      terminal: {
        kind: "stopped" as const,
        reasonCode: "remote_agent.execution_cancelled",
        noticeText: "Stopped.",
      },
    };
    const results = await Promise.all([
      stub.rpcCloseAgentStream(stop),
      stub.rpcCloseAgentStream(stop),
    ]);
    expect(results.filter((frame) => frame !== null)).toEqual([
      expect.objectContaining({
        type: "space.agent_stream_terminal",
        streamId,
        sequence: 1,
        terminal: {
          kind: "stopped",
          reasonCode: "remote_agent.execution_cancelled",
          noticeText: "Stopped.",
        },
      }),
    ]);
    expect(results.filter((frame) => frame === null)).toHaveLength(1);
    await expect(stub.rpcCloseAgentStream(stop)).resolves.toBeNull();
    await expect(
      stub.rpcApplyAgentStreamDelta({
        ...delta,
        sequence: 2,
        textSnapshot: "Late progress must not reopen stopped work.",
      })
    ).resolves.toMatchObject({
      status: "rejected",
      reasonCode: "agent_stream.terminal",
    });
  });
  it("broadcasts Agent stream snapshots and restores them through bootstrap and WebSocket replay", async () => {
    const spaceId = await createSpace({ name: `agent-stream-${Date.now()}` });
    const viewer = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "stream-viewer",
      profileName: "Stream Viewer",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcApplyAgentStreamDelta(input: {
        v: 1;
        spaceId: string;
        streamId: string;
        sequence: number;
        profileId: string;
        triggerMessageId: string;
        dispatchId: string;
        textSnapshot: string;
      }): Promise<{
        status: string;
        lastSequence: number;
        gapDetected?: boolean;
      }>;
      rpcCloseAgentStream(input: {
        spaceId: string;
        streamId: string;
        terminal: {
          kind: "failed";
          reasonCode: string;
          noticeText: string;
        };
      }): Promise<unknown>;
      rpcGetBootstrap(input: {
        spaceId: string;
        recent: true;
        limit: number;
        spaceAccess: ReturnType<typeof createAuthenticatedSpaceAccessContext>;
      }): Promise<{
        activeAgentStreams?: Array<{
          streamId: string;
          sequence: number;
          textSnapshot: string;
          gapDetected: boolean;
        }>;
        history: {
          signals: unknown[];
        };
      }>;
      rpcGetConversationState(input: {
        spaceId: string;
        spaceAccess: ReturnType<typeof createAnonymousViewerSpaceAccessContext>;
      }): Promise<{
        v: 1;
        spaceId: string;
        streams: Array<{
          streamId: string;
          sequence: number;
          textSnapshot: string;
          gapDetected: boolean;
        }>;
      }>;
    };
    const delta = {
      v: 1 as const,
      spaceId,
      streamId: "stream:sub_space_api_1",
      sequence: 1,
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      triggerMessageId: "signal_trigger_1",
      dispatchId: "dispatch_stream_1",
      textSnapshot: "Hello",
    };
    const firstLiveFrame = waitForJsonMessage(
      viewer,
      (data) =>
        data.type === "space.agent_stream_delta" &&
        data.streamId === delta.streamId &&
        data.sequence === 1
    );
    await expect(stub.rpcApplyAgentStreamDelta(delta)).resolves.toEqual({
      status: "accepted",
      lastSequence: 1,
    });
    await expect(firstLiveFrame).resolves.toMatchObject({
      type: "space.agent_stream_delta",
      streamId: delta.streamId,
      sequence: 1,
      textSnapshot: "Hello",
    });
    await expect(stub.rpcApplyAgentStreamDelta(delta)).resolves.toEqual({
      status: "duplicate_accepted",
      lastSequence: 1,
    });
    await expect(
      stub.rpcApplyAgentStreamDelta({
        ...delta,
        sequence: 3,
        textSnapshot: "Hello from the latest snapshot",
      })
    ).resolves.toEqual({
      status: "accepted",
      lastSequence: 3,
      gapDetected: true,
    });
    const thinkingStreamId = `${delta.streamId}:thinking`;
    await namespace
      .get(namespace.idFromString(spaceId))
      .rpcApplyAgentStreamDelta({
        v: 1,
        spaceId,
        streamId: thinkingStreamId,
        sequence: 1,
        profileId: delta.profileId,
        triggerMessageId: delta.triggerMessageId,
        dispatchId: `${delta.dispatchId}:thinking`,
        kind: "thinking",
        thinkingSnapshot: "Transient replay tail",
      });
    const bootstrap = await stub.rpcGetBootstrap({
      spaceId,
      recent: true,
      limit: 30,
      spaceAccess: createAuthenticatedSpaceAccessContext({
        spaceId,
        requestContext: createRpcContext({
          requestId: "agent-stream-bootstrap-reader",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Test User",
          ownerUserId: "owner-test-default",
        }),
      }),
    });
    expect(bootstrap.history.signals).toEqual([]);
    expect(bootstrap.activeAgentStreams).toMatchObject([
      {
        streamId: delta.streamId,
        sequence: 3,
        textSnapshot: "Hello from the latest snapshot",
        gapDetected: true,
      },
    ]);
    let replayedThinkingFrame:
      | ReturnType<typeof waitForJsonMessage>
      | undefined;
    let replayedStreamFrame: ReturnType<typeof waitForJsonMessage> | undefined;
    const restoredViewer = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: "restored-stream-viewer",
        profileName: "Restored Stream Viewer",
      },
      undefined,
      undefined,
      (socket) => {
        replayedThinkingFrame = waitForJsonMessage(
          socket,
          (data) =>
            data.type === "space.agent_stream_delta" &&
            data.streamId === thinkingStreamId
        );
        replayedStreamFrame = waitForJsonMessage(
          socket,
          (data) =>
            data.type === "space.agent_stream_delta" &&
            data.streamId === delta.streamId
        );
      }
    );
    await expect(replayedStreamFrame).resolves.toMatchObject({
      type: "space.agent_stream_delta",
      streamId: delta.streamId,
      sequence: 3,
      textSnapshot: "Hello from the latest snapshot",
    });
    await expect(replayedThinkingFrame).resolves.toMatchObject({
      kind: "thinking",
      thinkingSnapshot: "Transient replay tail",
    });
    expect(JSON.stringify(bootstrap)).not.toContain("Transient replay tail");
    await stub.rpcCloseAgentStream({
      spaceId,
      streamId: thinkingStreamId,
      terminal: {
        kind: "failed",
        reasonCode: "test.closed",
        noticeText: "Closed",
      },
    });
    const readModel = await stub.rpcGetConversationState({
      spaceId,
      spaceAccess: createAnonymousViewerSpaceAccessContext({
        spaceId,
        requestId: "agent-stream-refresh-reader",
      }),
    });
    expect(readModel).toMatchObject({
      v: 1,
      spaceId,
      streams: [
        {
          streamId: delta.streamId,
          sequence: 3,
          textSnapshot: "Hello from the latest snapshot",
          gapDetected: true,
        },
      ],
    });
    const terminalFrame = waitForJsonMessage(
      viewer,
      (data) =>
        data.type === "space.agent_stream_terminal" &&
        data.streamId === delta.streamId
    );
    await stub.rpcCloseAgentStream({
      spaceId,
      streamId: delta.streamId,
      terminal: {
        kind: "failed",
        reasonCode: "remote_agent.turn_failed",
        noticeText: "Center Agent could not finish this reply.",
      },
    });
    await expect(terminalFrame).resolves.toMatchObject({
      type: "space.agent_stream_terminal",
      streamId: delta.streamId,
      sequence: 3,
      terminal: { kind: "failed" },
    });
    await expect(
      stub.rpcApplyAgentStreamDelta({
        ...delta,
        sequence: 4,
        textSnapshot: "Late text",
      })
    ).resolves.toEqual({
      status: "rejected",
      reasonCode: "agent_stream.terminal",
      lastSequence: 3,
    });
    await expect(
      stub.rpcGetConversationState({
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "agent-stream-terminal-reader",
        }),
      })
    ).resolves.toMatchObject({ streams: [] });
    viewer.close(1000, "done");
    restoredViewer.close(1000, "done");
  });
  it("broadcasts tool-only Agent stream parts and closes their live projection", async () => {
    const spaceId = await createSpace({
      name: `agent-tool-stream-${Date.now()}`,
    });
    const viewer = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "tool-stream-viewer",
      profileName: "Tool Stream Viewer",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcApplyAgentStreamPart(input: {
        v: 1;
        spaceId: string;
        streamId: string;
        sequence: number;
        profileId: string;
        triggerMessageId: string;
        dispatchId: string;
        part: {
          type: "tool";
          toolCallId: string;
          toolName: string;
          state: "input-available" | "output-available" | "output-error";
          work?: {
            v: 1;
            key: "spaces.read";
          };
        };
      }): Promise<{
        status: string;
        lastSequence: number;
      }>;
      rpcCloseAgentStream(input: {
        spaceId: string;
        streamId: string;
        terminal: {
          kind: "final_message";
          publishedSignalId: string;
        };
      }): Promise<unknown>;
      rpcPostSignal(input: {
        spaceId: string;
        profile: {
          kind: "agent";
          profileId: string;
          profileName: string;
        };
        text: string;
        authoringPolicy: "system_emitted";
        context: ReturnType<typeof createRpcContext>;
      }): Promise<
        SignalEnvelope & {
          type: "signal.text";
        }
      >;
    };
    const part = {
      v: 1 as const,
      spaceId,
      streamId: "stream:sub_tool_space_api_1",
      sequence: 1,
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      triggerMessageId: "signal_trigger_tool_1",
      dispatchId: "dispatch_tool_stream_1",
      part: {
        type: "tool" as const,
        toolCallId: "tool_call_1",
        toolName: "openmeld_list_spaces",
        state: "input-available" as const,
        work: {
          v: 1 as const,
          key: "spaces.read" as const,
        },
      },
    };
    const livePart = waitForJsonMessage(
      viewer,
      (data) =>
        data.type === "space.agent_stream_part" &&
        data.streamId === part.streamId
    );
    await expect(stub.rpcApplyAgentStreamPart(part)).resolves.toEqual({
      status: "accepted",
      lastSequence: 1,
    });
    await expect(livePart).resolves.toMatchObject({
      type: "space.agent_stream_part",
      streamId: part.streamId,
      sequence: 1,
      part: {
        toolCallId: "tool_call_1",
        state: "input-available",
        work: {
          v: 1,
          key: "spaces.read",
        },
      },
    });
    await expect(
      stub.rpcApplyAgentStreamPart({
        ...part,
        sequence: 2,
        part: { ...part.part, state: "output-available" },
      })
    ).resolves.toEqual({
      status: "accepted",
      lastSequence: 2,
    });
    const publishedSignal = await stub.rpcPostSignal({
      spaceId,
      profile: {
        kind: "agent",
        profileId: part.profileId,
        profileName: "Center Agent",
      },
      text: "I found the Space.",
      authoringPolicy: "system_emitted",
      context: createRpcContext({
        requestId: "agent-stream-working-details-publish",
        profileId: part.profileId,
        profileKind: "agent",
        profileName: "Center Agent",
        ownerUserId: "owner-agent-stream-working-details",
      }),
    });
    const terminalFrame = waitForJsonMessage(
      viewer,
      (data) =>
        data.type === "space.agent_stream_terminal" &&
        data.streamId === part.streamId
    );
    await stub.rpcCloseAgentStream({
      spaceId,
      streamId: part.streamId,
      terminal: {
        kind: "final_message",
        publishedSignalId: publishedSignal.id,
      },
    });
    await expect(terminalFrame).resolves.toMatchObject({
      type: "space.agent_stream_terminal",
      streamId: part.streamId,
      sequence: 2,
      terminal: { kind: "final_message" },
    });
    const messageDetailsResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/message-details?signalId=${encodeURIComponent(publishedSignal.id)}`
    );
    expect(messageDetailsResponse.status).toBe(200);
    await expect(messageDetailsResponse.json()).resolves.toMatchObject({
      workingDetails: {
        state: "recorded",
        tools: [
          {
            toolName: "openmeld_list_spaces",
            state: "output-available",
            work: {
              v: 1,
              key: "spaces.read",
            },
          },
        ],
        truncated: false,
      },
    });
    await expect(
      stub.rpcApplyAgentStreamPart({
        ...part,
        sequence: 3,
        part: { ...part.part, state: "output-available" },
      })
    ).resolves.toEqual({
      status: "rejected",
      reasonCode: "agent_stream.terminal",
      lastSequence: 2,
    });
    viewer.close(1000, "done");
  });
  it("preserves signal replyTo across WebSocket live and stored history", async () => {
    const spaceId = await createSpace();
    const aliceRuntimeProfileId = toCanonicalOpenMeldProfileId(
      "alice",
      "human"
    );
    const alice = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "alice",
      profileName: "Alice",
    });
    const bob = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "bob",
      profileName: "Bob",
    });
    const bobReceives = waitForJsonMessage(
      bob,
      (data) =>
        data.type === "signal.text" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === aliceRuntimeProfileId &&
        (
          data.data as {
            text?: string;
            replyTo?: {
              signalId?: string;
            };
          }
        ).replyTo?.signalId === TEST_REPLY_TO.signalId &&
        (
          data.data as {
            text?: string;
          }
        ).text === "Reply from websocket"
    );
    alice.send(
      JSON.stringify({
        type: "signal.text",
        data: {
          text: "Reply from websocket",
          replyTo: TEST_REPLY_TO,
        },
      })
    );
    const liveMessage = await bobReceives;
    expect(
      (
        liveMessage.data as {
          replyTo?: Record<string, unknown>;
        }
      ).replyTo
    ).toEqual(TEST_REPLY_TO);
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        data?: {
          text?: string;
          replyTo?: Record<string, unknown>;
        };
      }>;
    };
    const persistedReply = listed.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.data?.text === "Reply from websocket"
    );
    expect(persistedReply?.data?.replyTo).toEqual(TEST_REPLY_TO);
    alice.close(1000, "done");
    bob.close(1000, "done");
  });
  it("preserves signal meta across HTTP post, websocket live, and stored history", async () => {
    const spaceId = await createSpace();
    const observer = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "observer",
      profileName: "Observer",
    });
    const liveNotice = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.data as {
            text?: string;
            meta?: {
              purpose?: string;
            };
          }
        ).meta?.purpose === "space_membership_join_notice" &&
        (
          data.data as {
            text?: string;
          }
        ).text === "Mira added Demo Bot to this space."
    );
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Mira added Demo Bot to this space.",
            meta: {
              purpose: "space_membership_join_notice",
              targetProfileId: "22222222-2222-4222-8222-222222222222",
              targetProfileKind: "agent",
              targetProfileName: "Demo Bot",
              addedByProfileId: "11111111-1111-4111-8111-111111111111",
              addedByDisplayName: "Mira",
            },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(200);
    const posted = parseEnvelope(await postResponse.json());
    if (!isTextSignalEnvelope(posted)) {
      throw new Error("Expected signal.text envelope from POST /signals");
    }
    expect(posted.data.meta).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: "22222222-2222-4222-8222-222222222222",
      targetProfileKind: "agent",
      targetProfileName: "Demo Bot",
      addedByProfileId: "11111111-1111-4111-8111-111111111111",
      addedByDisplayName: "Mira",
    });
    const liveMessage = await liveNotice;
    expect(
      (
        liveMessage.data as {
          meta?: Record<string, unknown>;
        }
      ).meta
    ).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: "22222222-2222-4222-8222-222222222222",
      targetProfileKind: "agent",
      targetProfileName: "Demo Bot",
      addedByProfileId: "11111111-1111-4111-8111-111111111111",
      addedByDisplayName: "Mira",
    });
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        data?: {
          text?: string;
          meta?: Record<string, unknown>;
        };
      }>;
    };
    const persistedNotice = listed.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.data?.text === "Mira added Demo Bot to this space."
    );
    expect(persistedNotice?.data?.meta).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: "22222222-2222-4222-8222-222222222222",
      targetProfileKind: "agent",
      targetProfileName: "Demo Bot",
      addedByProfileId: "11111111-1111-4111-8111-111111111111",
      addedByDisplayName: "Mira",
    });
    observer.close(1000, "done");
  });
  it("preserves Human Mention across current live and history transports", async () => {
    const spaceId = await createSpace();
    const observerProfile = {
      kind: "human",
      profileId: "mention-observer",
      profileName: "Mention Observer",
    };
    const observerProfileId = toCanonicalOpenMeldProfileId(
      observerProfile.profileId,
      "human"
    );
    const observer = await openPendingSpaceSocket(spaceId, observerProfile);
    const helloAck = waitForJsonMessage(
      observer,
      (data) => data.type === "system.hello.ack"
    );
    observer.send(
      JSON.stringify({
        type: "hello",
        profile: observerProfile,
        capabilities: { spaceMessageAddressing: true },
      })
    );
    await helloAck;
    const text = "@Mention Observer please review";
    const liveMention = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.data as {
            text?: string;
          }
        ).text === text
    );
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openmeld-space-addressing-version": "1",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text,
            messageEnvelope: {
              text,
              activationTargets: [],
              referenceTargets: [],
              mentionTargets: [observerProfileId],
            },
          },
        }),
      }
    );
    expect(postResponse.status).toBe(200);
    const liveMessage = await liveMention;
    expect(
      (
        liveMessage.data as {
          messageEnvelope?: {
            mentionTargets?: string[];
          };
        }
      ).messageEnvelope?.mentionTargets
    ).toEqual([observerProfileId]);
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`,
      { headers: { "x-openmeld-space-addressing-version": "1" } }
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals?: Array<{
        data?: {
          text?: string;
          messageEnvelope?: {
            mentionTargets?: string[];
          };
        };
      }>;
    };
    const persisted = history.signals?.find(
      (signal) => signal.data?.text === text
    );
    expect(persisted?.data?.messageEnvelope?.mentionTargets).toEqual([
      observerProfileId,
    ]);
    observer.close(1000, "done");
  });
  it("preserves signal replyTo across HTTP post, websocket live, and stored history", async () => {
    const spaceId = await createSpace();
    const observer = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "observer",
      profileName: "Observer",
    });
    const liveReply = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.data as {
            text?: string;
            replyTo?: {
              signalId?: string;
            };
          }
        ).replyTo?.signalId === TEST_REPLY_TO.signalId &&
        (
          data.data as {
            text?: string;
          }
        ).text === "Reply from HTTP"
    );
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Reply from HTTP",
            replyTo: TEST_REPLY_TO,
          },
        }),
      }
    );
    expect(postResponse.status).toBe(200);
    const posted = parseEnvelope(await postResponse.json());
    if (!isTextSignalEnvelope(posted)) {
      throw new Error("Expected signal.text envelope from POST /signals");
    }
    expect(posted.data.replyTo).toEqual(TEST_REPLY_TO);
    const liveMessage = await liveReply;
    expect(
      (
        liveMessage.data as {
          replyTo?: Record<string, unknown>;
        }
      ).replyTo
    ).toEqual(TEST_REPLY_TO);
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        data?: {
          text?: string;
          replyTo?: Record<string, unknown>;
        };
      }>;
    };
    const persistedReply = listed.signals?.find(
      (signal) =>
        signal.type === "signal.text" && signal.data?.text === "Reply from HTTP"
    );
    expect(persistedReply?.data?.replyTo).toEqual(TEST_REPLY_TO);
    observer.close(1000, "done");
  });
  it("preserves agent owner in live events and stored signals", async () => {
    const spaceId = await createSpace();
    const codexOwnerRuntimeProfileId = toCanonicalOpenMeldProfileId(
      "codex-owner",
      "agent"
    );
    const observer = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "observer",
      profileName: "Observer",
    });
    const seesOwnerOnJoin = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "presence.join" &&
        (
          data.profile as {
            profileId?: string;
            owner?: string;
          }
        ).profileId === codexOwnerRuntimeProfileId &&
        (
          data.profile as {
            profileId?: string;
            owner?: string;
          }
        ).owner === "Felix"
    );
    const codex = await openSpaceSocket(spaceId, {
      kind: "agent",
      profileId: "codex-owner",
      profileName: "Codex",
      owner: "Felix",
    });
    const joinEvent = await seesOwnerOnJoin;
    expect(
      (
        joinEvent.profile as {
          owner?: string;
        }
      ).owner
    ).toBe("Felix");
    const seesOwnerOnMessage = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.profile as {
            profileId?: string;
            owner?: string;
          }
        ).profileId === codexOwnerRuntimeProfileId &&
        (
          data.profile as {
            profileId?: string;
            owner?: string;
          }
        ).owner === "Felix" &&
        (
          data.data as {
            text?: string;
          }
        ).text === "owner synced"
    );
    codex.send(
      JSON.stringify({ type: "signal.text", data: { text: "owner synced" } })
    );
    const messageEvent = await seesOwnerOnMessage;
    expect(
      (
        messageEvent.profile as {
          owner?: string;
        }
      ).owner
    ).toBe("Felix");
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        profile?: {
          profileId?: string;
          owner?: string;
        };
        data?: {
          text?: string;
        };
      }>;
    };
    const persistedText = listed.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.profile?.profileId === codexOwnerRuntimeProfileId &&
        signal.data?.text === "owner synced"
    );
    expect(persistedText?.profile?.owner).toBe("Felix");
    codex.close(1000, "done");
    observer.close(1000, "done");
  });
  it("hides agent context from same-owner viewers outside the lineage in live events and signal history", async () => {
    const sharedOwnerUserId = "owner-ctx-visible";
    const otherOwnerUserId = "owner-ctx-hidden";
    const agentControllerConversationId = "ctx-visible-1";
    const agentControllerRef = "builtin:codex";
    const codexContextRuntimeProfileId = toCanonicalOpenMeldProfileId(
      "codex-ctx",
      "agent"
    );
    const spaceId = await createSpace();
    const sameOwnerViewerProfileId = "owner-viewer-human";
    const otherViewerProfileId = "other-viewer-human";
    const sameOwnerViewer = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: sameOwnerViewerProfileId,
        profileName: "Same Owner Viewer",
      },
      undefined,
      {
        ownerUserId: sharedOwnerUserId,
        openMeldProfileId: sameOwnerViewerProfileId,
      }
    );
    const otherViewer = await openSpaceSocket(
      spaceId,
      {
        kind: "human",
        profileId: otherViewerProfileId,
        profileName: "Other Viewer",
      },
      undefined,
      {
        ownerUserId: otherOwnerUserId,
        openMeldProfileId: otherViewerProfileId,
      }
    );
    const sameOwnerSeesJoinWithoutContext = waitForJsonMessage(
      sameOwnerViewer,
      (data) =>
        data.type === "presence.join" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined &&
        (
          data.profile as {
            agentControllerRef?: string;
          }
        ).agentControllerRef === agentControllerRef
    );
    const otherSeesJoinWithoutContext = waitForJsonMessage(
      otherViewer,
      (data) =>
        data.type === "presence.join" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined &&
        (
          data.profile as {
            agentControllerRef?: string;
          }
        ).agentControllerRef === agentControllerRef
    );
    const codex = await openSpaceSocket(
      spaceId,
      {
        kind: "agent",
        profileId: "codex-ctx",
        profileName: "Codex Context",
        owner: sharedOwnerUserId,
      },
      undefined,
      {
        ownerUserId: sharedOwnerUserId,
        agentControllerConversationId,
        agentControllerRef,
      }
    );
    const sameOwnerJoin = await sameOwnerSeesJoinWithoutContext;
    const otherJoin = await otherSeesJoinWithoutContext;
    expect(
      (
        sameOwnerJoin.profile as {
          agentControllerConversationId?: string;
        }
      ).agentControllerConversationId
    ).toBeUndefined();
    expect(
      (
        sameOwnerJoin.profile as {
          agentControllerRef?: string;
        }
      ).agentControllerRef
    ).toBe(agentControllerRef);
    expect(
      (
        otherJoin.profile as {
          agentControllerConversationId?: string;
        }
      ).agentControllerConversationId
    ).toBeUndefined();
    expect(
      (
        otherJoin.profile as {
          agentControllerRef?: string;
        }
      ).agentControllerRef
    ).toBe(agentControllerRef);
    const sameOwnerSeesTextWithoutContext = waitForJsonMessage(
      sameOwnerViewer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.data as {
            text?: string;
          }
        ).text === "ctx visibility check" &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined &&
        (
          data.profile as {
            agentControllerRef?: string;
          }
        ).agentControllerRef === agentControllerRef
    );
    const otherSeesTextWithoutContext = waitForJsonMessage(
      otherViewer,
      (data) =>
        data.type === "signal.text" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.data as {
            text?: string;
          }
        ).text === "ctx visibility check" &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined &&
        (
          data.profile as {
            agentControllerRef?: string;
          }
        ).agentControllerRef === agentControllerRef
    );
    codex.send(
      JSON.stringify({
        type: "signal.text",
        data: { text: "ctx visibility check" },
      })
    );
    await sameOwnerSeesTextWithoutContext;
    await otherSeesTextWithoutContext;
    const sameOwnerDefaultListResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      {
        profileId: sameOwnerViewerProfileId,
        profileKind: "human",
        profileName: "Same Owner Viewer",
        ownerUserId: sharedOwnerUserId,
        openMeldProfileId: sameOwnerViewerProfileId,
      }
    );
    expect(sameOwnerDefaultListResponse.status).toBe(200);
    const sameOwnerDefaultList =
      (await sameOwnerDefaultListResponse.json()) as {
        signals?: Array<{
          type?: string;
          profile?: {
            profileId?: string;
            agentControllerConversationId?: string;
          };
          data?: {
            text?: string;
          };
        }>;
      };
    const sameOwnerStoredText = sameOwnerDefaultList.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.profile?.profileId === codexContextRuntimeProfileId &&
        signal.data?.text === "ctx visibility check"
    );
    expect(
      sameOwnerStoredText?.profile?.agentControllerConversationId
    ).toBeUndefined();
    const otherRecentListResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?recent=true&limit=100`,
      undefined,
      {
        profileId: otherViewerProfileId,
        profileKind: "human",
        profileName: "Other Viewer",
        ownerUserId: otherOwnerUserId,
        openMeldProfileId: otherViewerProfileId,
      }
    );
    expect(otherRecentListResponse.status).toBe(200);
    const otherRecentList = (await otherRecentListResponse.json()) as {
      signals?: Array<{
        type?: string;
        profile?: {
          profileId?: string;
          agentControllerConversationId?: string;
        };
        data?: {
          text?: string;
        };
      }>;
    };
    const otherStoredText = otherRecentList.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.profile?.profileId === codexContextRuntimeProfileId &&
        signal.data?.text === "ctx visibility check"
    );
    expect(
      otherStoredText?.profile?.agentControllerConversationId
    ).toBeUndefined();
    const sameOwnerCursorListResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`,
      undefined,
      {
        profileId: sameOwnerViewerProfileId,
        profileKind: "human",
        profileName: "Same Owner Viewer",
        ownerUserId: sharedOwnerUserId,
        openMeldProfileId: sameOwnerViewerProfileId,
      }
    );
    expect(sameOwnerCursorListResponse.status).toBe(200);
    const sameOwnerCursorList = (await sameOwnerCursorListResponse.json()) as {
      signals?: Array<{
        type?: string;
        profile?: {
          profileId?: string;
          agentControllerConversationId?: string;
        };
        data?: {
          text?: string;
        };
      }>;
    };
    const sameOwnerCursorText = sameOwnerCursorList.signals?.find(
      (signal) =>
        signal.type === "signal.text" &&
        signal.profile?.profileId === codexContextRuntimeProfileId &&
        signal.data?.text === "ctx visibility check"
    );
    expect(
      sameOwnerCursorText?.profile?.agentControllerConversationId
    ).toBeUndefined();
    const otherSeesQuitWithoutContext = waitForJsonMessage(
      otherViewer,
      (data) =>
        data.type === "presence.quit" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined
    );
    const sameOwnerSeesQuitWithoutContext = waitForJsonMessage(
      sameOwnerViewer,
      (data) =>
        data.type === "presence.quit" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === codexContextRuntimeProfileId &&
        (
          data.profile as {
            agentControllerConversationId?: string;
          }
        ).agentControllerConversationId === undefined &&
        (
          data.profile as {
            agentControllerRef?: string;
          }
        ).agentControllerRef === agentControllerRef
    );
    codex.close(1000, "done");
    await sameOwnerSeesQuitWithoutContext;
    await otherSeesQuitWithoutContext;
    sameOwnerViewer.close(1000, "done");
    otherViewer.close(1000, "done");
  });
  it("broadcasts presence.quit on disconnect but keeps it out of the visible timeline read", async () => {
    const spaceId = await createSpace();
    const alicePresenceRuntimeProfileId = toCanonicalOpenMeldProfileId(
      "alice-presence",
      "human"
    );
    const alice = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "alice-presence",
      profileName: "Alice Presence",
    });
    const bob = await openSpaceSocket(spaceId, {
      kind: "human",
      profileId: "bob-presence",
      profileName: "Bob Presence",
    });
    const bobReceivesQuit = waitForJsonMessage(
      bob,
      (data) =>
        data.type === "presence.quit" &&
        (
          data.profile as {
            profileId?: string;
          }
        ).profileId === alicePresenceRuntimeProfileId
    );
    alice.close(1000, "done");
    const quitEvent = await bobReceivesQuit;
    expect(quitEvent.type).toBe("presence.quit");
    expect(
      (
        quitEvent.profile as {
          profileId?: string;
        }
      ).profileId
    ).toBe(alicePresenceRuntimeProfileId);
    // The HTTP timeline read is a visible read model: presence is operational
    // and must NOT appear there. If it did, heavy join/quit churn would fill the
    // recent/limit window and bury real messages, so the timeline would render
    // empty even though messages exist. Presence stays in storage + the live
    // broadcast above only.
    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        profile?: {
          profileId?: string;
        };
      }>;
    };
    const hasPresence = listed.signals?.some((signal) =>
      signal.type?.startsWith("presence.")
    );
    expect(hasPresence).toBe(false);
    bob.close(1000, "done");
  });
  it("supports rpc methods on WorkerEntrypoint", async () => {
    const rpcContext = createRpcContext({
      requestId: "rpc-test-request",
      profileId: "rpc-profile",
      profileKind: "agent",
      profileName: "RPC Agent",
      ownerUserId: "rpc-owner",
    });
    await ensureTestOrganizationMembership({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      userId: "rpc-owner",
    });
    const rpc = exports.default as unknown as {
      ping: () => Promise<{
        ok: boolean;
        service: string;
      }>;
      createSpace: (input?: {
        name?: string;
        visibility?: "public" | "private";
        context?: typeof rpcContext;
      }) => Promise<{
        spaceId: string;
      }>;
      postSignal: (input: {
        spaceId: string;
        profile: {
          kind: "agent";
          profileId: string;
          profileName?: string;
        };
        text: string;
        messageEnvelope?: {
          activationTargets: string[];
          referenceTargets: string[];
          text: string;
        };
        authoringPolicy: "system_emitted";
        context?: typeof rpcContext;
      }) => Promise<{
        type: string;
        data?: {
          text?: string;
          messageEnvelope?: {
            activationTargets: string[];
            ccTargets?: string[];
            referenceTargets: string[];
            text: string;
          };
        };
      }>;
      listSignals: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: {
            text?: string;
            messageEnvelope?: {
              activationTargets: string[];
              ccTargets?: string[];
              referenceTargets: string[];
              text: string;
            };
          };
        }>;
        nextCursor: string | null;
      }>;
      getSpaceDispatchResult: (input: {
        context?: typeof rpcContext;
        dispatchId: string;
        spaceId: string;
      }) => Promise<{
        messageEnvelope?: unknown;
      }>;
    };
    const health = await rpc.ping();
    expect(health.ok).toBe(true);
    expect(health.service).toBe("openmeld-core");
    const created = await rpc.createSpace({
      name: "rpc-smoke",
      visibility: "private",
      context: rpcContext,
    });
    expect(SPACE_ID_HEX_REGEX.test(created.spaceId)).toBe(true);
    const posted = await rpc.postSignal({
      spaceId: created.spaceId,
      profile: {
        kind: "agent",
        profileId: rpcContext.actorContext.openMeldProfileId,
        profileName: "RPC Agent",
      },
      text: "hello from rpc",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        text: "hello from rpc",
      },
      authoringPolicy: "system_emitted",
      context: rpcContext,
    });
    expect(posted.data?.messageEnvelope?.ccTargets).toEqual([]);
    const signalsPage = await rpc.listSignals({
      spaceId: created.spaceId,
      context: rpcContext,
    });
    expect(signalsPage.signals).toHaveLength(1);
    expect(signalsPage.signals[0]?.type).toBe("signal.text");
    expect(signalsPage.signals[0]?.data?.text).toBe("hello from rpc");
    expect(signalsPage.signals[0]?.data?.messageEnvelope?.ccTargets).toEqual(
      []
    );
    expect(signalsPage.nextCursor).toBeNull();
    await writeDispatchResult({
      db: getPostgresDatabase(env),
      result: {
        actorProfileId: rpcContext.actorContext.openMeldProfileId,
        createdAt: "2026-07-19T00:00:00.000Z",
        dispatchId: "rpc-dispatch-result-1",
        finalText: "RPC dispatch result.",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "RPC dispatch result.",
        },
        publicOutcome: "post_message",
        resultKind: "text",
        resultRef: "dispatch-result:rpc-dispatch-result-1",
        spaceId: created.spaceId,
      },
    });
    const dispatchResult = await rpc.getSpaceDispatchResult({
      context: rpcContext,
      dispatchId: "rpc-dispatch-result-1",
      spaceId: created.spaceId,
    });
    expect(dispatchResult.messageEnvelope).toEqual({
      activationTargets: [],
      ccTargets: [],
      referenceTargets: [],
      text: "RPC dispatch result.",
    });
  });
  it("translates legacy Human References through WorkerEntrypoint RPC", async () => {
    const spaceId = await createSpace();
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: SECOND_HUMAN_PROFILE_ID,
              profileName: "Legacy RPC Mention Target",
              profileKind: "human",
              ownerUserId: "owner-legacy-rpc-mention-target",
              ownerName: "Legacy RPC Mention Target",
              agentControllerRef: null,
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const rpcContext = createRpcContext({
      requestId: "legacy-human-reference-rpc",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const rpc = exports.default as unknown as {
      listSignals: (
        input: {
          context: typeof rpcContext;
          spaceId: string;
        },
        spaceAddressingVersion?: string
      ) => Promise<{
        signals: SignalEnvelope[];
      }>;
      postSignal: (
        input: {
          authoringPolicy: "user_authored";
          context: typeof rpcContext;
          messageEnvelope: {
            activationTargets: string[];
            referenceTargets: string[];
            text: string;
          };
          profile: {
            kind: "human";
            profileId: string;
            profileName: string;
          };
          spaceId: string;
          text: string;
        },
        spaceAddressingVersion?: string
      ) => Promise<SignalEnvelope>;
    };
    const text = "@Legacy RPC Mention Target please review";
    await rpc.postSignal({
      authoringPolicy: "user_authored",
      context: rpcContext,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [SECOND_HUMAN_PROFILE_ID],
        text,
      },
      profile: {
        kind: "human",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileName: "Test User",
      },
      spaceId,
      text,
    });
    const currentHistory = await rpc.listSignals(
      { context: rpcContext, spaceId },
      OPENMELD_SPACE_ADDRESSING_VERSION
    );
    const persisted = currentHistory.signals.find(
      (signal) => signal.type === "signal.text" && signal.data.text === text
    );
    expect(
      persisted?.type === "signal.text"
        ? persisted.data.messageEnvelope
        : undefined
    ).toMatchObject({
      mentionTargets: [SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
    });
  });
  it("translates legacy Human References from OpenMeld Service replies", async () => {
    const spaceId = await createSpace();
    await ensureTestOrganizationMembership({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      userId: "owner-legacy-service-agent",
    });
    const agentProfileId = `agt_${randomUUID()}`;
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: SECOND_HUMAN_PROFILE_ID,
              profileName: "Legacy Service Mention Target",
              profileKind: "human",
              ownerUserId: "owner-legacy-service-mention-target",
              ownerName: "Legacy Service Mention Target",
              agentControllerRef: null,
            },
            {
              profileId: agentProfileId,
              profileName: "Legacy Service Agent",
              profileKind: "agent",
              ownerUserId: "owner-legacy-service-agent",
              ownerName: "Legacy Service Owner",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    const rpcContext = createRpcContext({
      requestId: "legacy-service-human-reference-rpc",
      profileId: agentProfileId,
      profileKind: "agent",
      profileName: "Legacy Service Agent",
      ownerUserId: "owner-legacy-service-agent",
    });
    const rpc = exports.default as unknown as {
      listSignals: (
        input: {
          context: typeof rpcContext;
          spaceId: string;
        },
        spaceAddressingVersion?: string
      ) => Promise<{
        signals: SignalEnvelope[];
      }>;
      postSignal: (input: {
        authoringPolicy: "system_emitted";
        context: typeof rpcContext;
        messageEnvelope: {
          activationTargets: string[];
          referenceTargets: string[];
          text: string;
        };
        profile: {
          kind: "agent";
          profileId: string;
          profileName: string;
        };
        spaceId: string;
        text: string;
      }) => Promise<SignalEnvelope>;
    };
    const text = "@Legacy Service Mention Target please review";
    await rpc.postSignal({
      authoringPolicy: "system_emitted",
      context: rpcContext,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [SECOND_HUMAN_PROFILE_ID],
        text,
      },
      profile: {
        kind: "agent",
        profileId: agentProfileId,
        profileName: "Legacy Service Agent",
      },
      spaceId,
      text,
    });
    const currentHistory = await rpc.listSignals(
      { context: rpcContext, spaceId },
      OPENMELD_SPACE_ADDRESSING_VERSION
    );
    const persisted = currentHistory.signals.find(
      (signal) => signal.type === "signal.text" && signal.data.text === text
    );
    expect(
      persisted?.type === "signal.text"
        ? persisted.data.messageEnvelope
        : undefined
    ).toMatchObject({
      mentionTargets: [SECOND_HUMAN_PROFILE_ID],
      referenceTargets: [],
    });
  });
  it.each([
    false,
    true,
  ])("generates a Center chat title without blocking messages, including a topic after a greeting: %s", async (greetingFirst) => {
    const organizationId = `org-title-${randomUUID()}`;
    const ownerUserId = `user-title-${randomUUID()}`;
    const humanProfileId = randomUUID();
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Title tester",
      requestId: "title-test",
    });
    const session = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      { context, sessionCreationId: randomUUID() }
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(session.spaceId));
    await runInDurableObject(stub, async (_instance, state) => {
      let resolveTitle!: (value: { title: string | null }) => void;
      let started!: () => void;
      const titleStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const generate = vi
        .fn<
          NonNullable<
            NonNullable<
              CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
            >["generateCenterAgentSessionTitle"]
          >
        >()
        .mockResolvedValue({ title: "Compare cloud hosting costs" })
        .mockImplementationOnce(async () => {
          started();
          return await new Promise<{
            title: string | null;
          }>((resolve) => {
            resolveTitle = resolve;
          });
        });
      const restarted = new Space(state, {
        ...env,
        OPENMELD_REMOTE_AGENT_WORKER: {
          generateCenterAgentSessionTitle: generate,
        },
      } as CoreBindings);
      const post = (
        text: string,
        authoringPolicy: "user_authored" | "system_emitted" = "user_authored"
      ) =>
        restarted.rpcPostSignal({
          context,
          spaceId: session.spaceId,
          profile: {
            kind: "human",
            profileId: humanProfileId,
            profileName: "Title tester",
          },
          authoringPolicy,
          text,
        });
      await post("System greeting", "system_emitted");
      expect(generate).not.toHaveBeenCalled();
      const firstText = greetingFirst ? "hi" : "Compare cloud hosting costs";
      const first = await post(firstText);
      expect(first.data).toMatchObject({ text: firstText });
      await titleStarted;
      await post("Compare cloud hosting and storage costs");
      expect(generate).toHaveBeenCalledTimes(1);
      resolveTitle({
        title: greetingFirst ? null : "Compare cloud hosting costs",
      });
      await vi.waitFor(() => {
        const row = state.storage.sql
          .exec<{
            name: string;
          }>("SELECT name FROM space_meta")
          .toArray()[0];
        expect(row?.name).toBe("Compare cloud hosting costs");
      });
      await post("Also compare support costs");
      expect(generate).toHaveBeenCalledTimes(greetingFirst ? 2 : 1);
    });
    await vi.waitFor(async () => {
      const list = await rpcListCenterAgentSessions(env as CoreBindings, {
        context,
      });
      expect(
        list.sessions.find((item) => item.spaceId === session.spaceId)?.name
      ).toBe("Compare cloud hosting costs");
    });
  });
  it.each([
    false,
    true,
  ])("titles a MemberAgent chat from its first message and keeps a title the member set: %s", async (renamedFirst) => {
    const organizationId = `org-member-title-${randomUUID()}`;
    const ownerUserId = `user-member-title-${randomUUID()}`;
    const humanProfileId = randomUUID();
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId: `agt_${randomUUID()}`,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const nowMs = Date.now();
    await getPostgresDatabase(env).query({
      text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id, profile_name, profile_handle, profile_kind, is_default,
        status, organization_id, owner_user_id, created_by_user_id,
        creator_profile_id, source, managed_role, last_used_at, created_at,
        updated_at
      )
      VALUES ($1, 'Claude Code', $2, 'agent', 0, 'active', $3, $4, $4, NULL, 'auth_bootstrap', NULL, NULL, $5, $5)
    `,
      values: [
        agentProfileId,
        `claude-code-${randomUUID()}`,
        organizationId,
        ownerUserId,
        nowMs,
      ],
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Title tester",
      requestId: "member-agent-title-test",
    });
    memberAgentsFeature.enabled = true;
    try {
      const session = await rpcOpenDirectMessageSpace(env as CoreBindings, {
        context,
        targetProfileId: agentProfileId,
        creationId: randomUUID(),
      });
      const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
      await runInDurableObject(
        namespace.get(namespace.idFromString(session.spaceId)),
        async (_instance, state) => {
          const readName = () =>
            state.storage.sql
              .exec<{ name: string }>("SELECT name FROM space_meta")
              .toArray()[0]?.name;
          expect(readName()).toBe("New chat");
          if (renamedFirst) {
            state.storage.sql.exec(
              "UPDATE space_meta SET name = ?",
              "Release checklist"
            );
          }
          const generate = vi.fn(() =>
            Promise.resolve({ title: "Fix free shipping boundary" })
          );
          const pending: Promise<unknown>[] = [];
          const waitUntil = state.waitUntil.bind(state);
          const capture = vi
            .spyOn(state, "waitUntil")
            .mockImplementation((promise) => {
              pending.push(promise);
              waitUntil(promise);
            });
          try {
            const restarted = new Space(state, {
              ...env,
              OPENMELD_REMOTE_AGENT_WORKER: {
                generateCenterAgentSessionTitle: generate,
              },
            } as CoreBindings);
            await restarted.rpcPostSignal({
              context,
              spaceId: session.spaceId,
              profile: {
                kind: "human",
                profileId: humanProfileId,
                profileName: "Title tester",
              },
              authoringPolicy: "user_authored",
              text: "Fix the free-shipping boundary in src/cart.ts",
            });
            await Promise.all(pending.splice(0));
          } finally {
            capture.mockRestore();
          }
          if (renamedFirst) {
            expect(generate).not.toHaveBeenCalled();
            expect(readName()).toBe("Release checklist");
          } else {
            expect(generate).toHaveBeenCalledTimes(1);
            expect(readName()).toBe("Fix free shipping boundary");
          }
        }
      );
    } finally {
      memberAgentsFeature.enabled = false;
    }
  });
  it.each([
    "unavailable",
    "no topic",
    "invalid output",
  ])("keeps title failures out of message publication and bounds retries across restart: %s", async (scenario) => {
    const organizationId = `org-title-failure-${randomUUID()}`;
    const ownerUserId = `user-title-failure-${randomUUID()}`;
    const humanProfileId = randomUUID();
    await ensureTestCenterAgentDesignation({
      agentProfileId: `agt_${randomUUID()}`,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Title tester",
      requestId: "title-failure",
    });
    const session = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      { context, sessionCreationId: randomUUID() }
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    await runInDurableObject(
      namespace.get(namespace.idFromString(session.spaceId)),
      async (_instance, state) => {
        const generate = vi.fn(() => {
          if (scenario === "unavailable") {
            return Promise.reject(new Error("Provider unavailable"));
          }
          return Promise.resolve({
            title: scenario === "no topic" ? null : "x".repeat(65),
          });
        });
        const bindings = {
          ...env,
          OPENMELD_REMOTE_AGENT_WORKER: {
            generateCenterAgentSessionTitle: generate,
          },
        } as CoreBindings;
        const pending: Promise<unknown>[] = [];
        const waitUntil = state.waitUntil.bind(state);
        const capture = vi
          .spyOn(state, "waitUntil")
          .mockImplementation((promise) => {
            pending.push(promise);
            waitUntil(promise);
          });
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            const restarted = new Space(state, bindings);
            const posted = await restarted.rpcPostSignal({
              context,
              spaceId: session.spaceId,
              profile: {
                kind: "human",
                profileId: humanProfileId,
                profileName: "Title tester",
              },
              authoringPolicy: "user_authored",
              text: `Message ${attempt}`,
            });
            expect(posted.data).toMatchObject({ text: `Message ${attempt}` });
            await Promise.all(pending.splice(0));
          }
          expect(generate).toHaveBeenCalledTimes(3);
          expect(
            state.storage.sql
              .exec<{
                name: string;
              }>("SELECT name FROM space_meta")
              .toArray()[0]?.name
          ).toBe("New chat");
        } finally {
          capture.mockRestore();
        }
      }
    );
  });
  it("opens the default Center chat and independent idempotent sessions through the real Space DO", async () => {
    const organizationId = `org-center-dm-${randomUUID()}`;
    const ownerUserId = `user-center-dm-${randomUUID()}`;
    const humanProfileId = randomUUID();
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId,
      agentProfileName: "OpenMeld Assistant",
      organizationId,
      ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Ava DM",
      requestId: "center-agent-dm-real-do",
    });
    const rpc = exports.default as unknown as {
      openCenterAgentDirectMessageSpace: (input: {
        context: typeof context;
        sessionCreationId?: string;
      }) => Promise<{
        centerAgentProfileId: string;
        created: boolean;
        memberProfileId: string;
        organizationId: string;
        spaceId: string;
      }>;
      getCenterAgentDirectMessageSpaceProjection: (input: {
        context: typeof context;
        spaceId: string;
      }) => Promise<{
        projection: {
          spaceId: string;
          memberProfileId: string;
        } | null;
      }>;
      createCenterAgentContextManifest: (input: {
        context: typeof context;
        spaceId: string;
        source: {
          kind: "local_agent";
          client: string;
        };
      }) => Promise<{
        subject: {
          conversationId: string;
        };
        entries: unknown[];
      }>;
      listCenterAgentSessions: (input: {
        context: typeof context;
        limit?: number;
        cursor?: string;
      }) => Promise<{
        sessions: Array<{
          spaceId: string;
          memberProfileId: string;
        }>;
        nextCursor: string | null;
      }>;
    };
    const first = await rpc.openCenterAgentDirectMessageSpace({ context });
    const second = await rpc.openCenterAgentDirectMessageSpace({ context });
    expect(first).toMatchObject({
      centerAgentProfileId: agentProfileId,
      created: true,
      memberProfileId: humanProfileId,
      organizationId,
    });
    expect(SPACE_ID_HEX_REGEX.test(first.spaceId)).toBe(true);
    expect(second).toEqual({
      ...first,
      created: false,
    });
    const creationId = randomUUID();
    const [session, repeatedSession, anotherSession] = await Promise.all([
      rpc.openCenterAgentDirectMessageSpace({
        context,
        sessionCreationId: creationId,
      }),
      rpc.openCenterAgentDirectMessageSpace({
        context,
        sessionCreationId: creationId,
      }),
      rpc.openCenterAgentDirectMessageSpace({
        context,
        sessionCreationId: randomUUID(),
      }),
    ]);
    expect(session.spaceId).toBe(repeatedSession.spaceId);
    expect(
      new Set([first.spaceId, session.spaceId, anotherSession.spaceId]).size
    ).toBe(3);
    for (const selected of [session, anotherSession]) {
      expect(selected.memberProfileId).toBe(humanProfileId);
      expect(selected.centerAgentProfileId).toBe(agentProfileId);
      await expect(
        rpc.getCenterAgentDirectMessageSpaceProjection({
          context,
          spaceId: selected.spaceId,
        })
      ).resolves.toMatchObject({
        projection: {
          spaceId: selected.spaceId,
          memberProfileId: humanProfileId,
        },
      });
    }
    await expect(
      rpc.getCenterAgentDirectMessageSpaceProjection({
        context,
        spaceId: "f".repeat(64),
      })
    ).resolves.toMatchObject({ projection: null });
    const otherMemberUserId = `user-other-session-${randomUUID()}`;
    const otherMemberProfileId = randomUUID();
    await ensureTestOrganizationMembership({
      organizationId,
      userId: otherMemberUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId: otherMemberUserId,
      profileId: otherMemberProfileId,
    });
    const otherProfileContext = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId: otherMemberUserId,
      profileId: otherMemberProfileId,
      profileKind: "human",
      profileName: "Other Profile",
      requestId: "center-session-other-profile",
    });
    await expect(
      rpc.getCenterAgentDirectMessageSpaceProjection({
        context: otherProfileContext,
        spaceId: session.spaceId,
      })
    ).resolves.toMatchObject({ projection: null });
    const manifestInput = {
      context,
      source: { kind: "local_agent" as const, client: "codex" },
      spaceId: session.spaceId,
    };
    const firstPage = await rpc.listCenterAgentSessions({ context, limit: 1 });
    expect(firstPage.sessions).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await rpc.listCenterAgentSessions({
      context,
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    const lastPage = await rpc.listCenterAgentSessions({
      context,
      limit: 1,
      cursor: secondPage.nextCursor ?? undefined,
    });
    expect(lastPage.nextCursor).toBeNull();
    const listed = [
      ...firstPage.sessions,
      ...secondPage.sessions,
      ...lastPage.sessions,
    ];
    expect(listed.map((item) => item.spaceId).sort()).toEqual(
      [first.spaceId, session.spaceId, anotherSession.spaceId].sort()
    );
    expect(
      listed.every((item) => item.memberProfileId === humanProfileId)
    ).toBe(true);
    await expect(
      rpc.listCenterAgentSessions({ context: otherProfileContext })
    ).resolves.toMatchObject({ sessions: [], nextCursor: null });
    await expect(
      rpcListCenterAgentSessions(env as unknown as CoreBindings, {
        context: otherProfileContext,
        cursor: firstPage.nextCursor ?? undefined,
      })
    ).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    await expect(
      rpc.createCenterAgentContextManifest(manifestInput)
    ).resolves.toMatchObject({
      subject: { conversationId: session.spaceId },
      entries: [],
    });
    await expect(
      rpcCreateCenterAgentContextManifest(env as unknown as CoreBindings, {
        ...manifestInput,
        context: otherProfileContext,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "center_agent.context_conversation_required",
    });
    const membersResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${first.spaceId}/members`,
      undefined,
      {
        ownerUserId,
        profileId: humanProfileId,
        profileKind: "human",
        profileName: "Ava DM",
        openMeldProfileId: humanProfileId,
      },
      { activeOrganizationId: organizationId }
    );
    expect(membersResponse.status).toBe(200);
    const members = (await membersResponse.json()) as {
      agents?: Array<{
        profileId?: string;
        memberSource?: string;
      }>;
      humans?: Array<{
        profileId?: string;
        memberSource?: string;
      }>;
      summary?: {
        agentCount?: number;
        humanCount?: number;
        totalCount?: number;
      };
    };
    expect(members.summary).toMatchObject({
      agentCount: 1,
      humanCount: 1,
      totalCount: 2,
    });
    expect(members.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberSource: "space_creator",
          profileId: humanProfileId,
        }),
      ])
    );
    expect(members.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberSource: "added_by_member",
          profileId: agentProfileId,
        }),
      ])
    );
    const signalsResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${first.spaceId}/signals`,
      undefined,
      {
        ownerUserId,
        profileId: humanProfileId,
        profileKind: "human",
        profileName: "Ava DM",
        openMeldProfileId: humanProfileId,
      },
      { activeOrganizationId: organizationId }
    );
    expect(signalsResponse.status).toBe(200);
    const signalsPage = (await signalsResponse.json()) as {
      signals: Array<{ type: string }>;
    };
    expect(
      signalsPage.signals.filter((signal) => signal.type === "signal.text")
    ).toEqual([]);
  });

  it.each([
    false,
    true,
  ])("reopens an existing Center chat without appending or rewriting messages (historical welcome: %s)", async (hasHistoricalWelcome) => {
    const organizationId = `org-center-reopen-${randomUUID()}`;
    const ownerUserId = `user-center-reopen-${randomUUID()}`;
    const humanProfileId = randomUUID();
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId,
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Ava",
      requestId: "center-chat-reopen",
    });
    const session = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      {
        context,
        sessionCreationId: randomUUID(),
      }
    );
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(session.spaceId));
    await stub.rpcPostSignal({
      context,
      spaceId: session.spaceId,
      profile: { kind: "human", profileId: humanProfileId, profileName: "Ava" },
      authoringPolicy: "system_emitted",
      text: "Existing conversation",
    });
    if (hasHistoricalWelcome) {
      await stub.rpcPostSignalOnceByClientMessageId({
        context,
        spaceId: session.spaceId,
        profile: {
          kind: "human",
          profileId: humanProfileId,
          profileName: "Ava",
        },
        authoringPolicy: "system_emitted",
        text: "Historical welcome",
        clientMessageId: `center-agent-dm-welcome:${session.spaceId}`,
        meta: {
          clientMessageId: `center-agent-dm-welcome:${session.spaceId}`,
          purpose: "center_agent_dm_welcome",
        },
      });
    }
    const before = await stub.rpcListSignals({
      context,
      spaceId: session.spaceId,
    });
    const reopened = await rpcOpenCenterAgentDirectMessageSpace(
      env as CoreBindings,
      { context }
    );
    expect(reopened.spaceId).toBe(session.spaceId);
    expect(reopened.created).toBe(false);
    expect(
      await stub.rpcListSignals({ context, spaceId: session.spaceId })
    ).toEqual(before);
  });
  it("bootstraps a fresh organization and opens a usable Center Agent DM through the real Core path", async () => {
    const organizationId = `org-center-bootstrap-${randomUUID()}`;
    const ownerUserId = `user-ca-${randomUUID()}`;
    const humanProfileId = randomUUID();
    const agentProfileId = `agt_${randomUUID()}`;
    await ensureTestOrganizationMembership({
      organizationId,
      userId: ownerUserId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."members" SET role = \'owner\' WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [organizationId, ownerUserId],
    });
    await insertTestPrimaryHumanProfile({
      ownerUserId,
      profileId: humanProfileId,
    });
    const ensureCenterAgentProfileInOrganization = vi.fn(
      async (
        input: Parameters<
          NonNullable<
            NonNullable<
              CoreBindings["OPENMELD_AUTH_WORKER"]
            >["ensureCenterAgentProfileInOrganization"]
          >
        >[0]
      ) => {
        const bootstrapOrganizationId = input.organizationId?.trim();
        const bootstrapOwnerUserId = input.createdByUserId?.trim();
        if (!(bootstrapOrganizationId && bootstrapOwnerUserId)) {
          throw new Error(
            "Center Agent profile bootstrap requires Organization and owner IDs."
          );
        }
        await insertTestManagedCenterAgentProfile({
          agentProfileId,
          organizationId: bootstrapOrganizationId,
          ownerUserId: bootstrapOwnerUserId,
        });
        return {
          ok: true as const,
          profile: {
            createdAt: "2026-07-10T00:00:00.000Z",
            createdByUserId: bootstrapOwnerUserId,
            creatorProfileId: null,
            isDefault: false,
            lastUsedAt: null,
            managedRole: "center_agent" as const,
            ownerUserId: null,
            profileHandle: `center-agent-${bootstrapOrganizationId}`,
            profileKind: "agent" as const,
            profileName: "Center Agent",
            source: "auth_bootstrap",
            status: "active" as const,
            updatedAt: "2026-07-10T00:00:00.000Z",
            openMeldProfileId: agentProfileId,
          },
        };
      }
    );
    const authWorker = {
      ensureCenterAgentProfileInOrganization,
    } satisfies NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>;
    const coreEnv: CoreBindings = {
      OPENMELD_AUTH_WORKER: authWorker,
      OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
      OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS: "",
      OPENMELD_REMOTE_AGENT_DESIGNATION_ENABLED: "true",
      OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      OPENMELD_RUNTIME_TRANSPORT:
        env.OPENMELD_RUNTIME_TRANSPORT as CoreBindings["OPENMELD_RUNTIME_TRANSPORT"],
      OPENMELD_SPACES: env.OPENMELD_SPACES as CoreBindings["OPENMELD_SPACES"],
    };
    const context = createRpcContext({
      activeOrganizationId: organizationId,
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Fresh Owner",
      requestId: "center-agent-fresh-bootstrap-real-path",
    });
    const opened = await rpcOpenCenterAgentDirectMessageSpace(coreEnv, {
      context,
    });
    expect(opened).toMatchObject({
      centerAgentProfileId: agentProfileId,
      created: true,
      memberProfileId: humanProfileId,
      organizationId,
    });
    expect(SPACE_ID_HEX_REGEX.test(opened.spaceId)).toBe(true);
    expect(ensureCenterAgentProfileInOrganization).toHaveBeenCalledWith({
      organizationId,
      createdByUserId: ownerUserId,
    });
    const membersResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${opened.spaceId}/members`,
      undefined,
      {
        ownerUserId,
        profileId: humanProfileId,
        profileKind: "human",
        profileName: "Fresh Owner",
        openMeldProfileId: humanProfileId,
      },
      { activeOrganizationId: organizationId }
    );
    expect(membersResponse.status).toBe(200);
    const members = (await membersResponse.json()) as {
      agents?: Array<{
        profileId?: string;
      }>;
      humans?: Array<{
        profileId?: string;
      }>;
    };
    expect(members.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: agentProfileId }),
      ])
    );
    expect(members.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: humanProfileId }),
      ])
    );
    const signalsResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${opened.spaceId}/signals`,
      undefined,
      {
        ownerUserId,
        profileId: humanProfileId,
        profileKind: "human",
        profileName: "Fresh Owner",
        openMeldProfileId: humanProfileId,
      },
      { activeOrganizationId: organizationId }
    );
    expect(signalsResponse.status).toBe(200);
    const signalsPage = (await signalsResponse.json()) as {
      signals: Array<{ type: string }>;
    };
    expect(
      signalsPage.signals.filter((signal) => signal.type === "signal.text")
    ).toEqual([]);
  });
  it("supports direct DO rpc methods and applies space ref per request", async () => {
    await ensureTestOrganizationMembership({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      userId: "rpc-direct-owner",
    });
    const spaceId = await createSpace({
      name: `rpc-direct-${Date.now()}`,
      guide: "direct-rpc guideline",
    });
    const rpcContext = createRpcContext({
      requestId: "rpc-direct-request",
      profileId: "rpc-direct-profile",
      profileKind: "agent",
      profileName: "Direct RPC Agent",
      ownerUserId: "rpc-direct-owner",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcListSignals: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: {
            text?: string;
            meta?: {
              centerAgentTaskReferences?: Array<{
                taskId: string;
              }>;
            };
          };
          profile?: {
            agentControllerRef?: string;
            agentControllerConversationId?: string;
            workingDirectory?: string;
          };
        }>;
        nextCursor: string | null;
      }>;
      rpcPostSignal: (input: {
        spaceId: string;
        profile: {
          kind: "agent";
          profileId: string;
          profileName?: string;
          agentControllerRef?: string;
          agentControllerConversationId?: string;
          workingDirectory?: string;
        };
        text: string;
        authoringPolicy: "system_emitted" | "user_authored";
        meta?: {
          centerAgentTaskReferences?: Array<{
            taskId: string;
          }>;
        };
        context?: typeof rpcContext;
      }) => Promise<{
        type: string;
        profile?: {
          profileId?: string;
          agentControllerRef?: string;
          agentControllerConversationId?: string;
          workingDirectory?: string;
        };
        data?: {
          text?: string;
          meta?: {
            centerAgentTaskReferences?: Array<{
              taskId: string;
            }>;
          };
        };
      }>;
      rpcGetMeta: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        spaceId: string;
        guide?: string;
      }>;
      rpcPatchMeta: (input: {
        spaceId: string;
        guide: string;
        context?: typeof rpcContext;
      }) => Promise<{
        spaceId: string;
        guide?: string;
      }>;
      rpcGetCursor: (input: {
        spaceId: string;
        profileId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        spaceId: string;
        profileId: string;
        lastSeenTs?: number;
        role?: string;
      }>;
      rpcPatchCursor: (input: {
        spaceId: string;
        profileId: string;
        lastSeenTs?: number;
        role?: string;
        context?: typeof rpcContext;
      }) => Promise<{
        spaceId: string;
        profileId: string;
        lastSeenTs?: number;
        role?: string;
      }>;
    };
    const cursorFromId = await stub.rpcGetCursor({
      spaceId,
      profileId: rpcContext.actorContext.openMeldProfileId,
      context: rpcContext,
    });
    expect(cursorFromId.spaceId).toBe(spaceId);
    const metaFromId = await stub.rpcGetMeta({
      spaceId,
      context: rpcContext,
    });
    expect(metaFromId.guide).toBe("direct-rpc guideline");
    const patchedMeta = await stub.rpcPatchMeta({
      spaceId,
      guide: "direct-rpc guideline updated",
      context: createRpcContext({
        requestId: "rpc-direct-owner-update",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        ownerUserId: "owner-test-default",
      }),
    });
    expect(patchedMeta.guide).toBe("direct-rpc guideline updated");
    const posted = await stub.rpcPostSignal({
      spaceId,
      profile: {
        kind: "agent",
        profileId: "forged-rpc-agent",
        profileName: "Forged RPC Agent",
      },
      text: "hello from direct do rpc",
      authoringPolicy: "system_emitted",
      meta: {
        centerAgentTaskReferences: [{ taskId: "task-direct-rpc-1" }],
      },
      context: rpcContext,
    });
    expect(posted.type).toBe("signal.text");
    expect(posted.data?.text).toBe("hello from direct do rpc");
    expect(posted.profile?.profileId).toBe(
      rpcContext.actorContext.openMeldProfileId
    );
    const listed = await stub.rpcListSignals({
      spaceId,
      context: rpcContext,
    });
    expect(listed.nextCursor).toBeNull();
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toHaveProperty("signals");
    const patchedCursor = await stub.rpcPatchCursor({
      spaceId,
      profileId: rpcContext.actorContext.openMeldProfileId,
      lastSeenTs: 123,
      role: "assistant",
      context: rpcContext,
    });
    expect(patchedCursor.profileId).toBe(
      rpcContext.actorContext.openMeldProfileId
    );
    expect(patchedCursor.lastSeenTs).toBe(123);
    expect(patchedCursor.role).toBe("assistant");
  });
  it("negotiates image geometry and origin on Core Space File HTTP reads", async () => {
    const spaceId = await createSpace({
      name: `file-http-compatibility-${Date.now()}`,
    });
    const fileId = randomUUID();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await runInDurableObject(stub, (_instance, state) => {
      new SpaceFileRepository(state.storage).commitWrite({
        actor: {
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          displayName: "Test User",
          ownerUserId: "owner-test-default",
        },
        auditEvent: {
          actorKind: "authenticated",
          actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
          entryId: fileId,
          errorCode: null,
          eventId: "file-http-compatibility",
          occurredAtMs: Date.now(),
          operation: "content_write",
          operationId: "file-http-compatibility",
          organizationId: DEFAULT_TEST_ORGANIZATION_ID,
          representedHumanProfileId: null,
          requestId: "file-http-compatibility",
          result: "succeeded",
          revisionId: "file-http-compatibility-revision",
          spaceId,
        },
        imageDimensions: { width: 1600, height: 900 },
        nowMs: Date.now(),
        write: {
          spaceId,
          fileId,
          revisionId: "file-http-compatibility-revision",
          name: "launch.png",
          parentId: null,
          baseRevision: null,
          clientMutationId: "file-http-compatibility",
          mimeType: "image/png",
          origin: "chat_upload",
          sizeBytes: 2048,
        },
      });
    });
    const url = `${BASE_URL}/v1/spaces/${spaceId}/files/${fileId}`;
    const [legacyResponse, geometryResponse, originResponse, currentResponse] =
      await Promise.all([
        fetchWithOpenMeldAuth(url),
        fetchWithOpenMeldAuth(url, {
          headers: {
            [OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
              OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
          },
        }),
        fetchWithOpenMeldAuth(url, {
          headers: {
            [OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION]:
              OPENMELD_SPACE_FILES_ORIGIN_VERSION,
          },
        }),
        fetchWithOpenMeldAuth(url, {
          headers: {
            [OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION]:
              OPENMELD_SPACE_FILES_ORIGIN_VERSION,
            [OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
              OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
          },
        }),
      ]);
    expect(legacyResponse.status).toBe(200);
    expect(geometryResponse.status).toBe(200);
    expect(originResponse.status).toBe(200);
    expect(currentResponse.status).toBe(200);
    const legacy = await legacyResponse.json();
    const geometry = await geometryResponse.json();
    const origin = await originResponse.json();
    const current = await currentResponse.json();
    expect(JSON.stringify(legacy)).not.toContain("imageDimensions");
    expect(JSON.stringify(legacy)).not.toContain("origin");
    expect(geometry).toMatchObject({
      file: {
        latestRevision: {
          imageDimensions: { width: 1600, height: 900 },
        },
      },
    });
    expect(JSON.stringify(geometry)).not.toContain("origin");
    expect(JSON.stringify(origin)).not.toContain("imageDimensions");
    expect(origin).toMatchObject({ file: { origin: "chat_upload" } });
    expect(current).toMatchObject({
      file: {
        id: fileId,
        latestRevision: {
          imageDimensions: { width: 1600, height: 900 },
        },
        origin: "chat_upload",
      },
    });
  });
  it("publishes a canonical Space File without requiring a text note", async () => {
    const spaceId = await createSpace({ name: `file-only-${Date.now()}` });
    const context = createRpcContext({
      requestId: "rpc-file-only-message",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const bytes = new TextEncoder().encode("%PDF test brief");
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    });
    const write = {
      spaceId,
      fileId: randomUUID(),
      revisionId: randomUUID(),
      name: "brief.pdf",
      parentId: null,
      baseRevision: null,
      clientMutationId: randomUUID(),
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
    };
    await stub.rpcPrepareSpaceFileWrite({ spaceAccess, write });
    const file = await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    const posted = await rpcPostSignal(env as unknown as CoreBindings, {
      authoringPolicy: "user_authored",
      context,
      files: [
        {
          fileId: file.id,
          revision: file.latestRevision.revision,
          name: "untrusted-client-name.pdf",
          mimeType: "application/octet-stream",
          sizeBytes: 1,
        },
      ],
      profile: {
        kind: "human",
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileName: "Test User",
      },
      spaceId,
      text: "",
    });
    expect(posted).toMatchObject({
      type: "signal.text",
      data: {
        text: "",
        files: [
          {
            fileId: file.id,
            revision: 1,
            name: "brief.pdf",
            mimeType: "application/pdf",
            sizeBytes: bytes.byteLength,
          },
        ],
      },
    });
  });
  it("keeps ten Space File writes in one request independently idempotent", async () => {
    const spaceId = await createSpace({
      name: `multi-file-write-${Date.now()}`,
    });
    const context = createRpcContext({
      requestId: "rpc-multi-file-write",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    });
    const writes = Array.from({ length: 10 }, (_, index) => ({
      baseRevision: null,
      clientMutationId: randomUUID(),
      fileId: randomUUID(),
      mimeType: "text/plain",
      name: `evidence-${index + 1}.txt`,
      parentId: null,
      revisionId: randomUUID(),
      sizeBytes: index + 1,
      spaceId,
    }));
    for (const write of writes) {
      await stub.rpcPrepareSpaceFileWrite({ spaceAccess, write });
      await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    }
    await expect(
      stub.rpcCommitSpaceFileWrite({ spaceAccess, write: writes[1] })
    ).resolves.toMatchObject({ id: writes[1]?.fileId });
    const result = await stub.rpcListSpaceFiles({
      query: { view: "active", origin: "all" },
      spaceAccess,
      spaceId,
    });
    expect(result.entries).toHaveLength(10);
    expect(result.entries.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(writes.map((write) => write.fileId))
    );
    const auditEvents = await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{
            event_id: string;
            operation_id: string;
            request_id: string;
          }>(`
              SELECT event_id, operation_id, request_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `)
          .toArray()
    );
    expect(auditEvents).toHaveLength(10);
    expect(
      auditEvents.map(({ operation_id, request_id }) => ({
        operation_id,
        request_id,
      }))
    ).toEqual(
      expect.arrayContaining(
        writes.map((write) => ({
          operation_id: write.clientMutationId,
          request_id: context.actorContext.requestId,
        }))
      )
    );
    expect(new Set(auditEvents.map((event) => event.event_id)).size).toBe(10);
  });
  it("keeps Space File audit identities distinct when correlation IDs contain colons", async () => {
    const spaceId = await createSpace({
      name: `colon-audit-identity-${Date.now()}`,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const writes = [
      {
        clientMutationId: "write-one",
        requestId: "rpc:colon",
      },
      {
        clientMutationId: "colon:write-one",
        requestId: "rpc",
      },
    ] as const;
    for (const [index, identity] of writes.entries()) {
      const context = createRpcContext({
        requestId: identity.requestId,
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Test User",
        ownerUserId: "owner-test-default",
      });
      const spaceAccess = createAuthenticatedSpaceAccessContext({
        requestContext: context,
        spaceId,
      });
      const write = {
        baseRevision: null,
        clientMutationId: identity.clientMutationId,
        fileId: randomUUID(),
        mimeType: "text/plain",
        name: `colon-evidence-${index + 1}.txt`,
        parentId: null,
        revisionId: randomUUID(),
        sizeBytes: index + 1,
        spaceId,
      };
      await stub.rpcPrepareSpaceFileWrite({ spaceAccess, write });
      await expect(
        stub.rpcCommitSpaceFileWrite({ spaceAccess, write })
      ).resolves.toMatchObject({ id: write.fileId });
    }
    const auditEvents = await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{
            event_id: string;
          }>(`
              SELECT event_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `)
          .toArray()
    );
    expect(auditEvents).toHaveLength(2);
    expect(new Set(auditEvents.map((event) => event.event_id)).size).toBe(2);
  });
  it("reuses a legacy Space File audit event during an exact write replay", async () => {
    const spaceId = await createSpace({
      name: `legacy-audit-replay-${Date.now()}`,
    });
    const requestId = "rpc-legacy-audit-replay";
    const context = createRpcContext({
      requestId,
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    });
    const write = {
      baseRevision: null,
      clientMutationId: "legacy-audit-mutation",
      fileId: randomUUID(),
      mimeType: "text/plain",
      name: "legacy-evidence.txt",
      parentId: null,
      revisionId: randomUUID(),
      sizeBytes: 1,
      spaceId,
    };
    await stub.rpcPrepareSpaceFileWrite({ spaceAccess, write });
    await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    const legacyEventId = `content_write:${requestId}`;
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `
          UPDATE space_file_audit_events
          SET event_id = ?
          WHERE operation = 'content_write' AND operation_id = ?
        `,
        legacyEventId,
        write.clientMutationId
      );
    });
    await expect(
      stub.rpcCommitSpaceFileWrite({ spaceAccess, write })
    ).resolves.toMatchObject({ id: write.fileId });
    const auditEvents = await runInDurableObject(
      stub,
      async (_instance, state) =>
        state.storage.sql
          .exec<{
            event_id: string;
            operation_id: string;
          }>(`
              SELECT event_id, operation_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `)
          .toArray()
    );
    expect(auditEvents).toEqual([
      {
        event_id: legacyEventId,
        operation_id: write.clientMutationId,
      },
    ]);
  });
  it("durably audits Space file writes without storing file data", async () => {
    const spaceId = await createSpace({ name: `file-audit-${Date.now()}` });
    const context = createRpcContext({
      requestId: "rpc-space-file-audit-write",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Test User",
      ownerUserId: "owner-test-default",
    });
    const bytes = new TextEncoder().encode("Confidential audit fixture");
    const fileId = randomUUID();
    const revisionId = randomUUID();
    const clientMutationId = randomUUID();
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      requestContext: context,
      spaceId,
    });
    const write = {
      baseRevision: null,
      clientMutationId,
      fileId,
      mimeType: "text/plain",
      name: "audit-secret.txt",
      parentId: null,
      revisionId,
      sizeBytes: bytes.byteLength,
      spaceId,
    };
    await stub.rpcPrepareSpaceFileWrite({ spaceAccess, write });
    await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    const folderRequestId = "rpc-space-file-audit-folder";
    const folder = await stub.rpcCreateSpaceFolder({
      body: { clientMutationId: randomUUID(), name: "Private Audit Folder" },
      spaceAccess: createAuthenticatedSpaceAccessContext({
        requestContext: {
          ...context,
          actorContext: { ...context.actorContext, requestId: folderRequestId },
        },
        spaceId,
      }),
      spaceId,
    });
    const failedRenameRequestId = "rpc-space-file-audit-rename-failed";
    await runInDurableObject(stub, async (instance) => {
      await expect(
        instance.rpcUpdateSpaceFileEntry({
          body: {
            clientMutationId: randomUUID(),
            name: "Private Audit Folder",
            parentId: fileId,
          },
          entryId: fileId,
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: {
              ...context,
              actorContext: {
                ...context.actorContext,
                requestId: failedRenameRequestId,
              },
            },
            spaceId,
          }),
          spaceId,
        })
      ).rejects.toMatchObject({ code: "space_file.invalid_parent" });
    });
    const updateRequestId = "rpc-space-file-audit-update";
    await stub.rpcUpdateSpaceFileEntry({
      body: { clientMutationId: randomUUID(), parentId: folder.folder.id },
      entryId: fileId,
      spaceAccess: createAuthenticatedSpaceAccessContext({
        requestContext: {
          ...context,
          actorContext: { ...context.actorContext, requestId: updateRequestId },
        },
        spaceId,
      }),
      spaceId,
    });
    const trashRequestId = "rpc-space-file-audit-trash";
    await stub.rpcTrashSpaceFileEntry({
      clientMutationId: randomUUID(),
      entryId: fileId,
      spaceAccess: createAuthenticatedSpaceAccessContext({
        requestContext: {
          ...context,
          actorContext: { ...context.actorContext, requestId: trashRequestId },
        },
        spaceId,
      }),
      spaceId,
    });
    const restoreRequestId = "rpc-space-file-audit-restore";
    await stub.rpcRestoreSpaceFileEntry({
      body: { clientMutationId: randomUUID() },
      entryId: fileId,
      spaceAccess: createAuthenticatedSpaceAccessContext({
        requestContext: {
          ...context,
          actorContext: {
            ...context.actorContext,
            requestId: restoreRequestId,
          },
        },
        spaceId,
      }),
      spaceId,
    });
    const events = await runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql
        .exec<{
          actor_kind: string;
          actor_profile_id: string | null;
          entry_id: string;
          error_code: string | null;
          operation: string;
          operation_id: string;
          organization_id: string;
          represented_human_profile_id: string | null;
          request_id: string;
          result: string;
          revision_id: string | null;
          space_id: string;
        }>(`
            SELECT
              actor_kind,
              actor_profile_id,
              entry_id,
              error_code,
              operation,
              operation_id,
              organization_id,
              represented_human_profile_id,
              request_id,
              result,
              revision_id,
              space_id
            FROM space_file_audit_events
            ORDER BY created_at_ms ASC, event_id ASC
          `)
        .toArray()
    );
    expect(events).toHaveLength(6);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          actor_kind: "authenticated",
          actor_profile_id: DEFAULT_HUMAN_PROFILE_ID,
          entry_id: fileId,
          error_code: null,
          operation: "content_write",
          operation_id: clientMutationId,
          organization_id: DEFAULT_TEST_ORGANIZATION_ID,
          represented_human_profile_id: null,
          request_id: "rpc-space-file-audit-write",
          result: "succeeded",
          revision_id: revisionId,
          space_id: spaceId,
        },
        expect.objectContaining({
          entry_id: folder.folder.id,
          operation: "folder_create",
          request_id: folderRequestId,
          result: "succeeded",
        }),
        expect.objectContaining({
          error_code: "space_file.invalid_parent",
          operation: "entry_update",
          request_id: failedRenameRequestId,
          result: "failed",
        }),
        expect.objectContaining({
          entry_id: fileId,
          operation: "entry_update",
          request_id: updateRequestId,
          result: "succeeded",
        }),
        expect.objectContaining({
          entry_id: fileId,
          operation: "entry_trash",
          request_id: trashRequestId,
          result: "succeeded",
        }),
        expect.objectContaining({
          entry_id: fileId,
          operation: "entry_restore",
          request_id: restoreRequestId,
          result: "succeeded",
        }),
      ])
    );
    expect(JSON.stringify(events)).not.toContain("audit-secret.txt");
    expect(JSON.stringify(events)).not.toContain("Confidential audit fixture");
  });
  it("persists the authenticated agent's Space member name instead of a requested profile display", async () => {
    await ensureTestOrganizationMembership({
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      userId: "owner-author-name-agent",
    });
    const creatorProfile: Partial<TestAuthProfile> = {
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Space Host",
      ownerUserId: "owner-author-name-host",
      openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
    };
    const agentProfileId = "agt_44444444-4444-4444-8444-444444444444";
    const authoritativeProfileName = "Acme Center Agent";
    const spaceId = await createSpace(
      { name: `author-name-${Date.now()}` },
      creatorProfile
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              agentControllerRef: "hosted:center-agent",
              ownerName: "Space Owner",
              ownerUserId: "owner-author-name-agent",
              profileId: agentProfileId,
              profileKind: "agent",
              profileName: authoritativeProfileName,
            },
          ],
        }),
      },
      creatorProfile
    );
    expect(addResponse.status).toBe(200);
    const rpcContext = createRpcContext({
      requestId: "rpc-author-name-request",
      profileId: agentProfileId,
      profileKind: "agent",
      profileName: "Forged Context Name",
      ownerUserId: "owner-author-name-agent",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcListSignals: (input: {
        context: typeof rpcContext;
        spaceId: string;
      }) => Promise<{
        signals: SignalEnvelope[];
      }>;
      rpcPostSignal: (input: {
        authoringPolicy: "system_emitted";
        context: typeof rpcContext;
        profile: {
          kind: "agent";
          profileId: string;
          profileName: string;
        };
        spaceId: string;
        text: string;
      }) => Promise<SignalEnvelope>;
    };
    const posted = await stub.rpcPostSignal({
      authoringPolicy: "system_emitted",
      context: rpcContext,
      profile: {
        kind: "agent",
        profileId: agentProfileId,
        profileName: "Forged Caller Name",
      },
      spaceId,
      text: "hello from the Center Agent",
    });
    expect(posted.profile).toMatchObject({
      kind: "agent",
      profileId: agentProfileId,
      profileName: authoritativeProfileName,
    });
    const listed = await stub.rpcListSignals({ context: rpcContext, spaceId });
    expect(
      listed.signals.find(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data.text === "hello from the Center Agent"
      )?.profile
    ).toMatchObject({
      kind: "agent",
      profileId: agentProfileId,
      profileName: authoritativeProfileName,
    });
  });
  it("publishes new Center Agent tool messages with the Auth name while preserving history", async () => {
    const organizationId = "org-center-agent-author-name";
    const ownerUserId = "owner-center-agent-author-name";
    const humanProfileId = "55555555-5555-4555-8555-555555555555";
    const agentProfileId = "agt_55555555-5555-4555-8555-555555555555";
    const authoritativeProfileName = "Historical Center Agent";
    const currentProfileName = "Current Center Agent Profile";
    await ensureTestCenterAgentDesignation({
      agentProfileId,
      agentProfileName: "Current Center Agent Profile",
      organizationId,
      ownerUserId,
    });
    const creatorProfile: Partial<TestAuthProfile> = {
      ownerUserId,
      profileId: humanProfileId,
      profileKind: "human",
      profileName: "Center Agent Owner",
      openMeldProfileId: humanProfileId,
    };
    const requestOptions = { activeOrganizationId: organizationId };
    const spaceId = await createSpace(
      { name: `center-agent-author-name-${Date.now()}` },
      creatorProfile,
      requestOptions
    );
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              agentControllerRef: "hosted:center-agent",
              ownerName: "Center Agent Owner",
              ownerUserId,
              profileId: agentProfileId,
              profileKind: "agent",
              profileName: authoritativeProfileName,
            },
          ],
        }),
      },
      creatorProfile,
      requestOptions
    );
    expect(addResponse.status).toBe(200);
    await rpcCenterAgentPostSpaceMessage(env as unknown as CoreBindings, {
      context: createRpcContext({
        activeOrganizationId: organizationId,
        agentControllerRef: "hosted:center-agent",
        profileId: agentProfileId,
        profileKind: "agent",
        requestId: "historical-center-agent-message",
      }),
      spaceId,
      text: "Message before the rename.",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const result = await runInDurableObject(stub, async (_instance, state) => {
      const currentEnv = {
        ...env,
        OPENMELD_AUTH_WORKER: {
          resolveProfileById: async () => ({
            ok: true,
            profile: {
              profileId: agentProfileId,
              profileKind: "agent",
              profileName: currentProfileName,
              profileHandle: "current-center-agent",
              ownerUserId: null,
              status: "active",
            },
          }),
        },
      } as unknown as CoreBindings;
      const currentSpace = new Space(state, currentEnv);
      return await rpcCenterAgentPostSpaceMessage(
        {
          ...currentEnv,
          OPENMELD_SPACES: {
            idFromString: (id: string) => namespace.idFromString(id),
            get: () => currentSpace,
          },
        } as unknown as CoreBindings,
        {
          context: createRpcContext({
            activeOrganizationId: organizationId,
            agentControllerRef: "hosted:center-agent",
            profileId: agentProfileId,
            profileKind: "agent",
            requestId: "remote-agent-tool:openmeld_post_space_message:test",
          }),
          spaceId,
          text: "I updated the launch plan.",
        }
      );
    });
    expect(result.signal.profile).toMatchObject({
      kind: "agent",
      profileId: agentProfileId,
      profileName: currentProfileName,
    });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      undefined,
      creatorProfile,
      requestOptions
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(
      history.signals?.find(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data.text === "I updated the launch plan."
      )?.profile
    ).toMatchObject({
      kind: "agent",
      profileId: agentProfileId,
      profileName: currentProfileName,
    });
    expect(
      history.signals?.find(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data.text === "Message before the rename."
      )?.profile.profileName
    ).toBe(authoritativeProfileName);
  });
  it("allows anonymous viewers to read direct RPC status, signals, and threads without write access", async () => {
    const spaceId = await createSpace({
      name: `rpc-anonymous-${Date.now()}`,
    });
    const rpcContext = createRpcContext({
      requestId: "rpc-anonymous-author",
      profileId: "rpc-anonymous-author",
      profileKind: "human",
      profileName: "Anonymous Test Author",
      ownerUserId: "rpc-anonymous-owner",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcGetStatus: (input: {
        spaceId: string;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<{
        spaceId: string;
        name?: string;
      }>;
      rpcListSignals: (input: {
        spaceId: string;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: {
            text?: string;
          };
        }>;
      }>;
      rpcListThreads: (input: {
        spaceId: string;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<{
        threads: unknown[];
        previews: unknown[];
      }>;
      rpcPostSignal: (input: {
        spaceId: string;
        profile: {
          kind: "human";
          profileId: string;
          profileName: string;
        };
        text: string;
        authoringPolicy: "system_emitted";
        context?: typeof rpcContext;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<unknown>;
    };
    await stub.rpcPostSignal({
      spaceId,
      profile: {
        kind: "human",
        profileId: rpcContext.actorContext.openMeldProfileId,
        profileName: "Anonymous Test Author",
      },
      text: "visible to anonymous viewers",
      authoringPolicy: "system_emitted",
      context: rpcContext,
    });
    const anonymousAccess = createAnonymousViewerSpaceAccessContext({
      spaceId,
      requestId: "rpc-anonymous-reader",
    });
    const status = await stub.rpcGetStatus({
      spaceId,
      spaceAccess: anonymousAccess,
    });
    expect(status.spaceId).toBe(spaceId);
    expect(status.name).toContain("rpc-anonymous");
    const listed = await stub.rpcListSignals({
      spaceId,
      spaceAccess: anonymousAccess,
    });
    expect(
      listed.signals.some(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data?.text === "visible to anonymous viewers"
      )
    ).toBe(true);
    const threads = await stub.rpcListThreads({
      spaceId,
      spaceAccess: anonymousAccess,
    });
    expect(threads.threads).toEqual([]);
    expect(threads.previews).toEqual([]);
    const reader = namespace.get(namespace.idFromString(spaceId));
    const readInput = { spaceId, spaceAccess: anonymousAccess };
    const readSharedContext = [
      () => reader.rpcGetHistoryNavigation(readInput),
      () => reader.rpcListSpaceFiles(readInput),
      () => reader.rpcListTasks(readInput),
      () => reader.rpcMessagePins(readInput),
      () => reader.rpcFilePins(readInput),
    ];
    for (const read of readSharedContext) {
      await expect(read()).resolves.toBeDefined();
    }
    const writeError = await rpcPostSignal(env as unknown as CoreBindings, {
      spaceId,
      profile: {
        kind: "human",
        profileId: "anonymous-forged-profile",
        profileName: "Anonymous Writer",
      },
      text: "anonymous write should fail",
      authoringPolicy: "system_emitted",
      spaceAccess: anonymousAccess,
    }).then(
      () => null,
      (error: unknown) => error
    );
    expect(writeError).toMatchObject({
      cause: {
        status: 403,
        code: "space.access.read_only",
      },
    });
    await runInDurableObject(reader, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_meta SET access_mode = 'members_only'"
      );
    });
    for (const read of readSharedContext) {
      const error = await read().then(
        () => null,
        (failure: unknown) => failure
      );
      expect(String(error)).toContain("space.membership_required");
    }
  });
  it("requires writable access before returning an idempotent direct RPC signal", async () => {
    const spaceId = await createSpace({
      name: `rpc-idempotent-${Date.now()}`,
    });
    const rpcContext = createRpcContext({
      requestId: "rpc-idempotent-author",
      profileId: "rpc-idempotent-author",
      profileKind: "human",
      profileName: "Idempotent Author",
      ownerUserId: "rpc-idempotent-owner",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcPostSignalOnceByClientMessageId: (input: {
        authoringPolicy: "system_emitted";
        clientMessageId: string;
        context?: typeof rpcContext;
        meta: {
          clientMessageId: string;
          purpose: string;
        };
        profile: {
          kind: "human";
          profileId: string;
          profileName: string;
        };
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
        spaceId: string;
        text: string;
      }) => Promise<SignalEnvelope>;
      rpcResolveOrRejectTextSignalByClientMessageId: (input: {
        clientMessageId: string;
        spaceId: string;
      }) => Promise<
        | {
            signal: Extract<
              SignalEnvelope,
              {
                type: "signal.text";
              }
            >;
            status: "accepted";
          }
        | {
            status: "rejected";
          }
      >;
    };
    const clientMessageId = `rpc-idempotent-${randomUUID()}`;
    const profile = {
      kind: "human" as const,
      profileId: rpcContext.actorContext.openMeldProfileId,
      profileName: "Idempotent Author",
    };
    const requestTimeContext = {
      submittedAtMs: 800,
      userTime: {
        timeZone: "Asia/Taipei",
        source: "web" as const,
        observedAtMs: 700,
      },
    };
    const posted = await runInDurableObject(
      namespace.get(namespace.idFromString(spaceId)),
      async (instance) => {
        const publish = vi.spyOn(
          instance as unknown as {
            publishTextSignal(
              signal: SignalEnvelope,
              context?: SignalPublishContext
            ): Promise<void>;
          },
          "publishTextSignal"
        );
        try {
          const signal = await instance.rpcPostSignalOnceByClientMessageId({
            authoringPolicy: "system_emitted",
            clientMessageId,
            context: rpcContext,
            meta: { clientMessageId, purpose: "idempotent_rpc_test" },
            profile,
            requestTimeContext,
            spaceId,
            text: "idempotent direct rpc signal",
          });
          expect(publish).toHaveBeenCalledWith(
            signal,
            expect.objectContaining({ requestTimeContext })
          );
          return signal;
        } finally {
          publish.mockRestore();
        }
      }
    );
    expect(posted.data.text).toBe("idempotent direct rpc signal");
    await expect(
      stub.rpcResolveOrRejectTextSignalByClientMessageId({
        clientMessageId,
        spaceId,
      })
    ).resolves.toMatchObject({
      signal: { id: posted.id },
      status: "accepted",
    });
    const rejectedClientMessageId = `rpc-rejected-${randomUUID()}`;
    await expect(
      stub.rpcResolveOrRejectTextSignalByClientMessageId({
        clientMessageId: rejectedClientMessageId,
        spaceId,
      })
    ).resolves.toEqual({ status: "rejected" });
    const rejectedLatePostError = await stub
      .rpcPostSignalOnceByClientMessageId({
        authoringPolicy: "system_emitted",
        clientMessageId: rejectedClientMessageId,
        context: rpcContext,
        meta: {
          clientMessageId: rejectedClientMessageId,
          purpose: "rejected_idempotent_rpc_test",
        },
        profile,
        spaceId,
        text: "this late signal must not be published",
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(rejectedLatePostError).toBeInstanceOf(Error);
    expect((rejectedLatePostError as Error).message).toContain(
      "space.signal.client_message_id_rejected"
    );
    const anonymousAccess = createAnonymousViewerSpaceAccessContext({
      spaceId,
      requestId: "rpc-idempotent-read-only",
    });
    const readOnlyError = await stub
      .rpcPostSignalOnceByClientMessageId({
        authoringPolicy: "system_emitted",
        clientMessageId,
        meta: { clientMessageId, purpose: "idempotent_rpc_test" },
        profile,
        spaceAccess: anonymousAccess,
        spaceId,
        text: "idempotent direct rpc signal",
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(readOnlyError).toBeInstanceOf(Error);
    expect((readOnlyError as Error).message).toContain("HTTP 403");
    expect((readOnlyError as Error).message).toContain(
      '"code":"space.access.read_only"'
    );
  });
  it("returns an accepted idempotent Reference after later membership removal", async () => {
    const referenceAgentProfileId = "agt_22222222-2222-4222-8222-222222222222";
    const spaceId = await createSpace({
      name: `rpc-idempotent-reference-${Date.now()}`,
    });
    const addResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            {
              profileId: referenceAgentProfileId,
              profileName: "Reference Target",
              profileKind: "agent",
              ownerUserId: "owner-idempotent-reference-agent",
              ownerName: "Reference Agent Owner",
              agentControllerRef: "builtin:codex",
            },
          ],
        }),
      }
    );
    expect(addResponse.status).toBe(200);
    await addResponse.json();
    const rpcContext = createRpcContext({
      requestId: "rpc-idempotent-reference-author",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Reference Author",
      ownerUserId: DEFAULT_TEST_AUTH_PROFILE.ownerUserId,
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcPostSignalOnceByClientMessageId: (input: {
        authoringPolicy: "user_authored";
        clientMessageId: string;
        context: typeof rpcContext;
        messageEnvelope: {
          activationTargets: string[];
          referenceTargets: string[];
          text: string;
        };
        meta: {
          clientMessageId: string;
        };
        profile: {
          kind: "human";
          profileId: string;
          profileName: string;
        };
        spaceId: string;
        text: string;
      }) => Promise<SignalEnvelope>;
    };
    const clientMessageId = `rpc-idempotent-reference-${randomUUID()}`;
    const request = {
      authoringPolicy: "user_authored" as const,
      clientMessageId,
      context: rpcContext,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [referenceAgentProfileId],
        text: "@Reference Target(reference) keep this context",
      },
      meta: { clientMessageId },
      profile: {
        kind: "human" as const,
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileName: "Reference Author",
      },
      spaceId,
      text: "@Reference Target(reference) keep this context",
    };
    const accepted = await stub.rpcPostSignalOnceByClientMessageId(request);
    const removeResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [referenceAgentProfileId],
        }),
      }
    );
    expect(removeResponse.status).toBe(200);
    await removeResponse.json();
    await expect(
      stub.rpcPostSignalOnceByClientMessageId(request)
    ).resolves.toMatchObject({ id: accepted.id });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals: SignalEnvelope[];
    };
    expect(history.signals).toContainEqual(
      expect.objectContaining({
        id: accepted.id,
        data: expect.objectContaining({
          messageEnvelope: expect.objectContaining({
            referenceTargets: [referenceAgentProfileId],
          }),
        }),
      })
    );
    const unpublishedClientMessageId = `rpc-idempotent-reference-new-${randomUUID()}`;
    const unpublishedError = await stub
      .rpcPostSignalOnceByClientMessageId({
        ...request,
        clientMessageId: unpublishedClientMessageId,
        meta: { clientMessageId: unpublishedClientMessageId },
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(unpublishedError).toBeInstanceOf(Error);
    expect((unpublishedError as Error).message).toContain(
      "space.addressing.target_invalid"
    );
  });
  it("rejects late Remote Agent replies but publishes the confirmed stopped outcome", async () => {
    const spaceId = await createSpace({
      name: `rpc-stopped-final-reply-${Date.now()}`,
    });
    const sourceResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Start, then stop this Wake." },
        }),
      }
    );
    expect(sourceResponse.status).toBe(200);
    const sourceSignal = parseEnvelope(await sourceResponse.json());
    if (!isTextSignalEnvelope(sourceSignal)) {
      throw new Error("Expected a source text signal");
    }
    const targetProfileId = "agt_99999999-9999-4999-8999-999999999999";
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const dispatchRecord = await runInDurableObject(
      stub,
      (_instance, state) => {
        const record = createDispatchOutboxRecord({
          bindingEnabled: true,
          bindingState: "bound",
          dispatchPolicy: "mention_only",
          nowMs: Date.now(),
          ruleId: "wake_explicit_activation",
          ruleReason: "Explicit Wake target",
          ruleSource: "registry",
          senderProfileId: DEFAULT_HUMAN_PROFILE_ID,
          sourceEventId: sourceSignal.id,
          sourceSignalSnapshot: {
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "Start, then stop this Wake.",
          },
          spaceId,
          targetProfileId,
        });
        insertDispatchOutboxRecord(state.storage.sql, record);
        markDispatchOutboxCancelled(state.storage.sql, {
          dispatchId: record.dispatchId,
        });
        return record;
      }
    );
    const dispatchContext = createRpcContext({
      requestId: "rpc-stopped-final-reply",
      profileId: targetProfileId,
      profileKind: "agent",
      profileName: "Stopped Remote Agent",
      ownerUserId: "remote-agent-owner",
    });
    const lateReplyError = await stub
      .rpcPostSignal({
        authoringPolicy: "system_emitted",
        finalOutcomeAuthority: "remote_agent_native_delivery",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: sourceSignal.id,
          text: "This late reply must not appear.",
        },
        meta: {
          clientMessageId: "sub-stopped-final-reply",
          dispatchId: dispatchRecord.dispatchId,
          purpose: "agent_reply_final",
          targetProfileId,
        },
        profile: {
          kind: "agent",
          owner: "remote-agent-owner",
          profileId: targetProfileId,
          profileName: "Stopped Remote Agent",
        },
        spaceAccess: createDispatchContinuationSpaceAccessContext({
          dispatchId: dispatchRecord.dispatchId,
          requestContext: dispatchContext,
          sourceSignalId: sourceSignal.id,
          spaceId,
          targetProfileId,
        }),
        spaceId,
        text: "This late reply must not appear.",
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(lateReplyError).toBeInstanceOf(Error);
    expect((lateReplyError as Error).message).toContain("HTTP 409");
    expect((lateReplyError as Error).message).toContain(
      '"code":"space.final_outcome_stopped"'
    );
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=20`
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(
      history.signals?.some(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data.text === "This late reply must not appear."
      )
    ).toBe(false);
    const stoppedInput = {
      authoringPolicy: "system_emitted" as const,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: sourceSignal.id,
        text: "This request was stopped.",
      },
      meta: {
        clientMessageId: "sub-stopped-confirmation",
        dispatchId: dispatchRecord.dispatchId,
        errorCode: "remote_agent.execution_cancelled",
        purpose: REMOTE_AGENT_FAILURE_PURPOSE,
        targetProfileId,
      },
      profile: {
        kind: "agent" as const,
        owner: "remote-agent-owner",
        profileId: targetProfileId,
        profileName: "Stopped Remote Agent",
      },
      spaceAccess: createDispatchContinuationSpaceAccessContext({
        dispatchId: dispatchRecord.dispatchId,
        requestContext: dispatchContext,
        sourceSignalId: sourceSignal.id,
        spaceId,
        targetProfileId,
      }),
      spaceId,
      text: "This request was stopped.",
    };
    // A tool or agent cannot forge cancellation authority through metadata.
    const unauthorizedStop = await stub.rpcPostSignal(stoppedInput).then(
      () => null,
      (error: unknown) => error
    );
    expect(unauthorizedStop).toBeInstanceOf(Error);
    expect((unauthorizedStop as Error).message).toContain(
      "space.final_outcome_owner_required"
    );
    const lateFailure = await stub
      .rpcPostSignal({
        ...stoppedInput,
        finalOutcomeAuthority: "remote_agent_native_delivery",
        meta: {
          ...stoppedInput.meta,
          errorCode: "remote_agent.turn_not_completed",
        },
      })
      .then(
        () => null,
        (error: unknown) => error
      );
    expect(lateFailure).toBeInstanceOf(Error);
    expect((lateFailure as Error).message).toContain(
      "space.final_outcome_stopped"
    );
    const stopped = await stub.rpcPostSignal({
      ...stoppedInput,
      finalOutcomeAuthority: "remote_agent_native_delivery",
    });
    const finalHistory = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=20`
    );
    const finalSignals = (await finalHistory.json()) as {
      signals: SignalEnvelope[];
    };
    expect(
      finalSignals.signals.filter((signal) => signal.id === stopped.id)
    ).toHaveLength(1);
    expect(stopped.type === "signal.text" && stopped.data.text).toBe(
      "This request was stopped."
    );
  });
  it("requires Remote Agent authority before persisting and claiming a failure outcome", async () => {
    const spaceId = await createSpace({
      name: `rpc-remote-agent-failure-authority-${Date.now()}`,
    });
    const sourceResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Please answer this request." },
        }),
      }
    );
    expect(sourceResponse.status).toBe(200);
    const sourceSignal = parseEnvelope(await sourceResponse.json());
    if (!isTextSignalEnvelope(sourceSignal)) {
      throw new Error("Expected a source text signal");
    }
    const targetProfileId = "agt_88888888-8888-4888-8888-888888888888";
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const dispatchRecord = await runInDurableObject(
      stub,
      (_instance, state) => {
        const record = createDispatchOutboxRecord({
          bindingEnabled: true,
          bindingState: "bound",
          dispatchPolicy: "mention_only",
          nowMs: Date.now(),
          ruleId: "wake_explicit_activation",
          ruleReason: "Explicit Wake target",
          ruleSource: "registry",
          senderProfileId: DEFAULT_HUMAN_PROFILE_ID,
          sourceEventId: sourceSignal.id,
          sourceSignalSnapshot: {
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileKind: "human",
            text: "Please answer this request.",
          },
          spaceId,
          targetProfileId,
        });
        insertDispatchOutboxRecord(state.storage.sql, record);
        markDispatchOutboxHandedOff(state.storage.sql, {
          dispatchId: record.dispatchId,
          handedOffAtMs: Date.now(),
        });
        return record;
      }
    );
    const dispatchContext = createRpcContext({
      requestId: "rpc-remote-agent-failure-authority",
      profileId: targetProfileId,
      profileKind: "agent",
      profileName: "Center Agent",
      ownerUserId: "remote-agent-owner",
    });
    const baseFailureInput = {
      authoringPolicy: "system_emitted" as const,
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: sourceSignal.id,
        text: "Center Agent could not complete this request.",
      },
      meta: {
        clientMessageId: "sub-remote-agent-failure-authority",
        dispatchId: dispatchRecord.dispatchId,
        errorCode: "remote_agent.turn_not_completed",
        purpose: REMOTE_AGENT_FAILURE_PURPOSE,
        targetProfileId,
      },
      profile: {
        kind: "agent" as const,
        owner: "remote-agent-owner",
        profileId: targetProfileId,
        profileName: "Center Agent",
      },
      spaceAccess: createDispatchContinuationSpaceAccessContext({
        dispatchId: dispatchRecord.dispatchId,
        requestContext: dispatchContext,
        sourceSignalId: sourceSignal.id,
        spaceId,
        targetProfileId,
      }),
      spaceId,
      text: "Center Agent could not complete this request.",
    };
    const rejected = await stub.rpcPostSignal(baseFailureInput).then(
      () => null,
      (error: unknown) => error
    );
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toContain("HTTP 403");
    expect((rejected as Error).message).toContain(
      '"code":"space.final_outcome_owner_required"'
    );
    const published = await stub.rpcPostSignal({
      ...baseFailureInput,
      finalOutcomeAuthority: "remote_agent_native_delivery",
    });
    expect(published).toMatchObject({
      type: "signal.text",
      data: {
        meta: {
          dispatchId: dispatchRecord.dispatchId,
          errorCode: "remote_agent.turn_not_completed",
          purpose: REMOTE_AGENT_FAILURE_PURPOSE,
          targetProfileId,
        },
      },
    });
    await expect(
      stub.rpcReadFinalReplyClaimOutcome({
        dispatchId: dispatchRecord.dispatchId,
        profileId: targetProfileId,
        spaceId,
      })
    ).resolves.toEqual({
      outcome: "failure",
      signalId: published.id,
    });
    const lateSuccess = await stub.rpcPostSignal({
      ...baseFailureInput,
      finalOutcomeAuthority: "remote_agent_native_delivery",
      messageEnvelope: {
        ...baseFailureInput.messageEnvelope,
        text: "This late success must not replace the failure.",
      },
      meta: {
        clientMessageId: "sub-remote-agent-late-success",
        dispatchId: dispatchRecord.dispatchId,
        purpose: AGENT_REPLY_FINAL_PURPOSE,
        targetProfileId,
      },
      text: "This late success must not replace the failure.",
    });
    await expect(
      stub.rpcReadFinalReplyClaimOutcome({
        dispatchId: dispatchRecord.dispatchId,
        profileId: targetProfileId,
        spaceId,
      })
    ).resolves.toEqual({
      outcome: "failure",
      signalId: published.id,
    });
    await expect(
      stub.rpcListSignals({ context: dispatchContext, spaceId })
    ).resolves.toMatchObject({
      signals: expect.not.arrayContaining([
        expect.objectContaining({ id: lateSuccess.id }),
      ]),
    });
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `
          DELETE FROM space_final_reply_claims
          WHERE dispatch_id = ?
            AND profile_id = ?
        `,
        dispatchRecord.dispatchId,
        targetProfileId
      );
    });
    await expect(
      stub.rpcReadFinalReplyClaimOutcome({
        dispatchId: dispatchRecord.dispatchId,
        profileId: targetProfileId,
        spaceId,
      })
    ).resolves.toEqual({ outcome: null, signalId: null });
    const clientMessageId = "client-remote-agent-failure-authority";
    const attemptId = `attempt-${randomUUID()}`;
    const nowMs = Date.now();
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger" (
          idempotency_key,
          dispatch_id,
          space_id,
          source_event_id,
          source_client_message_id,
          dispatch_owner_kind,
          dispatch_owner_id,
          target_profile_id,
          status,
          first_seen_at_ms,
          last_attempt_at_ms,
          attempt_count,
          latest_attempt_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
        values: [],
      },
      values: [
        dispatchRecord.idempotencyKey,
        dispatchRecord.dispatchId,
        spaceId,
        sourceSignal.id,
        clientMessageId,
        "owner_account",
        "remote-agent-owner",
        targetProfileId,
        "failed_terminal",
        nowMs - 2000,
        nowMs - 1000,
        1,
        attemptId,
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts" (
          attempt_id,
          dispatch_id,
          idempotency_key,
          attempt_no,
          status,
          task_id,
          target_profile_id,
          created_at_ms,
          started_at_ms,
          finished_at_ms,
          error_code,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
        values: [],
      },
      values: [
        attemptId,
        dispatchRecord.dispatchId,
        dispatchRecord.idempotencyKey,
        1,
        "failed_terminal",
        `task-${randomUUID()}`,
        targetProfileId,
        nowMs - 2000,
        nowMs - 1000,
        nowMs,
        "remote_agent.turn_not_completed",
        "Remote Agent turn did not complete.",
      ],
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId,
      bindingId: `binding-${randomUUID()}`,
      db: getPostgresDatabase(env),
      dispatchId: dispatchRecord.dispatchId,
      failureCode: "remote_agent.turn_not_completed",
      idempotencyKey: dispatchRecord.idempotencyKey,
      nowMs,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: targetProfileId,
      sourceClientMessageId: clientMessageId,
      spaceId,
      status: "failed",
      triggerMessageId: sourceSignal.id,
    });
    await expect(
      markRemoteAgentPreAdmissionFailurePublished({
        db: getPostgresDatabase(env),
        failureCode: "remote_agent.turn_not_completed",
        idempotencyKey: dispatchRecord.idempotencyKey,
        nowMs: nowMs + 1,
        publishedSignalId: published.id,
      })
    ).resolves.toMatchObject({ publishedSignalId: published.id });
    const traceResponse = await fetchSpaceDoWithOpenMeldAuth(
      {
        path: `/dispatches/${dispatchRecord.dispatchId}/trace`,
        spaceId,
      },
      {
        headers: {
          [SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION_HEADER]: String(
            SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION
          ),
        },
      }
    );
    expect(traceResponse.status).toBe(200);
    await expect(traceResponse.json()).resolves.toMatchObject({
      query: { dispatchId: dispatchRecord.dispatchId, spaceId },
      trace: {
        dispatch: { status: "failed_terminal" },
        finalVisibleMessage: {
          dispatchId: dispatchRecord.dispatchId,
          factSource: "space_signal_by_published_signal_id",
          reasonCode: "remote_agent.turn_not_completed",
          signalId: published.id,
          signalType: "signal.text",
          targetProfileId,
        },
        finalVisibleMessageLinkage: {
          candidateSignalIds: [published.id],
          claimSignalId: null,
          selectedSignalId: published.id,
          sourceFact: "published_signal_candidate",
          status: "matched_published_signal",
        },
        finalVisibleOutcome: {
          delivered: true,
          publicationKind: "failure_notice",
          reasonCode: "remote_agent.turn_not_completed",
          signalId: published.id,
          status: "visible_failure",
        },
        nativeDelivery: { status: "failed" },
      },
    });
    const wakeProgressResponse = await fetchSpaceDoWithOpenMeldAuth({
      path: `/wake-progress?clientMessageId=${encodeURIComponent(clientMessageId)}&targetProfileId=${encodeURIComponent(targetProfileId)}`,
      spaceId,
    });
    expect(wakeProgressResponse.status).toBe(200);
    await expect(wakeProgressResponse.json()).resolves.toEqual({
      query: {
        clientMessageId,
        spaceId,
        targetProfileId,
      },
      items: [
        expect.objectContaining({
          clientMessageId,
          dispatchId: dispatchRecord.dispatchId,
          failureReasonCode: "remote_agent.turn_not_completed",
          phase: "failed",
          sourceSignalId: sourceSignal.id,
          targetProfileId,
          terminal: true,
        }),
      ],
    });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=20`
    );
    expect(historyResponse.status).toBe(200);
    const history = (await historyResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(
      history.signals?.filter((signal) => signal.id === published.id)
    ).toHaveLength(1);
  });
  it("returns one signal for concurrent idempotent direct RPC writes", async () => {
    const spaceId = await createSpace({
      name: `rpc-idempotent-concurrent-${Date.now()}`,
    });
    const rpcContext = createRpcContext({
      requestId: "rpc-idempotent-concurrent-author",
      profileId: "rpc-idempotent-concurrent-author",
      profileKind: "human",
      profileName: "Concurrent Author",
      ownerUserId: "rpc-idempotent-concurrent-owner",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcPostSignalOnceByClientMessageId: (input: {
        authoringPolicy: "system_emitted";
        clientMessageId: string;
        context: typeof rpcContext;
        meta: {
          clientMessageId: string;
          purpose: string;
        };
        profile: {
          kind: "human";
          profileId: string;
          profileName: string;
        };
        spaceId: string;
        text: string;
      }) => Promise<SignalEnvelope>;
    };
    const clientMessageId = `rpc-idempotent-concurrent-${randomUUID()}`;
    const request = {
      authoringPolicy: "system_emitted" as const,
      clientMessageId,
      context: rpcContext,
      meta: { clientMessageId, purpose: "idempotent_concurrent_rpc_test" },
      profile: {
        kind: "human" as const,
        profileId: rpcContext.actorContext.openMeldProfileId,
        profileName: "Concurrent Author",
      },
      spaceId,
      text: "one idempotent concurrent signal",
    };
    const [first, second] = await Promise.all([
      stub.rpcPostSignalOnceByClientMessageId(request),
      stub.rpcPostSignalOnceByClientMessageId(request),
    ]);
    expect(first.id).toBe(second.id);
    if (!(first.type === "signal.text" && second.type === "signal.text")) {
      throw new Error(
        "Expected concurrent idempotent writes to return text signals"
      );
    }
    expect(first.data.meta?.clientMessageId).toBe(clientMessageId);
    expect(second.data.meta?.clientMessageId).toBe(clientMessageId);
  });
  it("keeps protected Space password semantics for anonymous direct RPC reads", async () => {
    const spaceName = `rpc-anonymous-protected-${Date.now()}`;
    const spaceId = await createSpace({
      name: spaceName,
      password: "anonymous-reader-secret",
    });
    const missingPasswordError = await rpcGetSpaceStatus(
      env as unknown as CoreBindings,
      {
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "rpc-anonymous-missing-password",
        }),
      }
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(missingPasswordError).toMatchObject({
      cause: {
        status: 401,
        code: "space.password_required",
      },
    });
    const invalidPasswordError = await rpcGetSpaceStatus(
      env as unknown as CoreBindings,
      {
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "rpc-anonymous-invalid-password",
          password: "wrong-password",
        }),
      }
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(invalidPasswordError).toMatchObject({
      cause: {
        status: 403,
        code: "space.password_invalid",
      },
    });
    const invalidBoardPasswordError = await rpcGetSpaceBoard(
      env as unknown as CoreBindings,
      {
        spaceId,
        spaceAccess: createAnonymousViewerSpaceAccessContext({
          spaceId,
          requestId: "rpc-board-anonymous-invalid-password",
          password: "wrong-password",
        }),
      }
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(invalidBoardPasswordError).toMatchObject({
      cause: {
        status: 403,
        code: "space.password_invalid",
      },
    });
    const status = await rpcGetSpaceStatus(env as unknown as CoreBindings, {
      spaceId,
      spaceAccess: createAnonymousViewerSpaceAccessContext({
        spaceId,
        requestId: "rpc-anonymous-valid-password",
        password: "anonymous-reader-secret",
      }),
    });
    expect(status.spaceId).toBe(spaceId);
    const board = await rpcGetSpaceBoard(env as unknown as CoreBindings, {
      spaceId,
      spaceAccess: createAnonymousViewerSpaceAccessContext({
        spaceId,
        requestId: "rpc-board-anonymous-valid-password",
        password: "anonymous-reader-secret",
      }),
    });
    expect(board).toEqual({
      space: {
        id: spaceId,
        name: spaceName,
        purpose: null,
        guide: null,
      },
      members: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        centerAgentPresent: false,
      },
      workingNow: [],
      recentOutcomes: [],
    });
  });
  it("returns an empty Board projection for a Space with no members or executions", async () => {
    const spaceName = `rpc-empty-board-${Date.now()}`;
    const spaceId = await createSpace({ name: spaceName });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE space_meta SET creator_json = NULL WHERE space_id = ?",
        spaceId
      );
      state.storage.sql.exec("DELETE FROM space_members");
      state.storage.sql.exec("DELETE FROM space_cursors");
      state.storage.sql.exec("DELETE FROM space_signals");
    });
    await expect(
      rpcGetSpaceBoard(env as unknown as CoreBindings, {
        spaceId,
        context: createRpcContext({
          requestId: "rpc-empty-board-read",
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Test User",
        }),
      })
    ).resolves.toEqual({
      space: {
        id: spaceId,
        name: spaceName,
        purpose: null,
        guide: null,
      },
      members: {
        totalCount: 0,
        humanCount: 0,
        agentCount: 0,
        centerAgentPresent: false,
      },
      workingNow: [],
      recentOutcomes: [],
    });
  });
  it("projects viewer membership from active account member profiles", async () => {
    const humanSpaceId = await createSpace({
      name: `viewer-membership-human-${Date.now()}`,
    });
    const humanContext = createRpcContext({
      requestId: "viewer-membership-human",
      profileId: DEFAULT_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Human Viewer",
      ownerUserId: "owner-test-default",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const humanStub = namespace.get(
      namespace.idFromString(humanSpaceId)
    ) as unknown as {
      rpcGetViewerMembership: (input: {
        spaceId: string;
        context: typeof humanContext;
      }) => Promise<{
        activeMemberProfiles: Array<{
          profileId: string;
          profileKind: "human" | "agent";
          profileName: string;
          lastEnteredAt: string | null;
        }>;
        preferredOpenProfileId: string | null;
      }>;
    };
    const humanMembership = await humanStub.rpcGetViewerMembership({
      spaceId: humanSpaceId,
      context: humanContext,
    });
    expect(humanMembership.activeMemberProfiles).toEqual([
      expect.objectContaining({
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Test User",
      }),
    ]);
    expect(humanMembership.preferredOpenProfileId).toBe(
      DEFAULT_HUMAN_PROFILE_ID
    );
    const agentSpaceId = await createSpace(
      {
        name: `viewer-membership-agent-${Date.now()}`,
      },
      {
        profileId: "agt_44444444-4444-4444-8444-444444444444",
        openMeldProfileId: "agt_44444444-4444-4444-8444-444444444444",
        profileKind: "agent",
        profileName: "Agent Creator",
        ownerUserId: "owner-agent-only",
      }
    );
    const agentContext = createRpcContext({
      requestId: "viewer-membership-agent",
      profileId: "agt_44444444-4444-4444-8444-444444444444",
      profileKind: "agent",
      profileName: "Agent Creator",
      ownerUserId: "owner-agent-only",
    });
    const agentStub = namespace.get(
      namespace.idFromString(agentSpaceId)
    ) as unknown as {
      rpcGetViewerMembership: (input: {
        spaceId: string;
        context: typeof agentContext;
      }) => Promise<{
        activeMemberProfiles: Array<{
          profileId: string;
          profileKind: "human" | "agent";
          profileName: string;
          lastEnteredAt: string | null;
        }>;
        preferredOpenProfileId: string | null;
      }>;
    };
    const agentMembership = await agentStub.rpcGetViewerMembership({
      spaceId: agentSpaceId,
      context: agentContext,
    });
    expect(agentMembership.activeMemberProfiles).toEqual([
      expect.objectContaining({
        profileId: "agt_44444444-4444-4444-8444-444444444444",
        profileKind: "agent",
        profileName: "Agent Creator",
      }),
    ]);
    expect(agentMembership.preferredOpenProfileId).toBe(
      "agt_44444444-4444-4444-8444-444444444444"
    );
  });
  it.each(
    ["publication", "directory", "active progress"].flatMap((surface) =>
      [
        undefined,
        "Previous Center Agent",
        "agt_11111111-1111-4111-8111-111111111112",
      ]
        .map((profileName) => ({
          surface,
          profileName,
          failure: undefined as string | undefined,
        }))
        .concat(
          ["unavailable", "stalled"].map((failure) => ({
            surface,
            profileName: "Previous Center Agent",
            failure,
          }))
        )
    )
  )("refreshes the Center Agent name through $surface from $profileName with $failure", async ({
    surface,
    profileName,
    failure,
  }) => {
    const spaceId = await createSpace({ name: "center-agent-name-repair" });
    const profileId = "agt_11111111-1111-4111-8111-111111111112";
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    if (surface === "active progress") {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: `binding-${spaceId}`,
        db: getPostgresDatabase(env),
        dispatchId: `dispatch-${spaceId}`,
        idempotencyKey: `name-${spaceId}`,
        nowMs: Date.now(),
        organizationId: DEFAULT_TEST_ORGANIZATION_ID,
        profileId,
        sourceClientMessageId: `client-${spaceId}`,
        spaceId,
        status: "accepted",
        triggerMessageId: `source-${spaceId}`,
      });
    }
    await runInDurableObject(stub, (_instance, state) => {
      upsertJoinedSpaceMember({
        sql: state.storage.sql,
        spaceId,
        profile: {
          kind: "agent",
          profileId,
          profileName,
        },
      });
    });
    const startedAt = Date.now();
    const name = await runInDurableObject(stub, async (_instance, state) => {
      const resolveProfile = async () => {
        if (failure === "stalled") {
          await new Promise(() => {
            /* Simulate an Auth RPC that never settles. */
          });
        }
        if (failure === "unavailable") {
          throw new Error("Auth unavailable");
        }
        return {
          profileId,
          profileKind: "agent" as const,
          profileName: "Amplift Center Agent",
          profileHandle: "amplift-center-agent",
          ownerUserId: "name-repair-owner",
          status: "active" as const,
        };
      };
      const repairedSpace = new Space(state, {
        ...(env as unknown as CoreBindings),
        OPENMELD_AUTH_WORKER: {
          resolveProfileById: async () => ({
            ok: true,
            profile: await resolveProfile(),
          }),
          resolveProfilesByIds: async ({
            profileIds,
          }: {
            profileIds: string[];
          }) => {
            const profile = await resolveProfile();
            return {
              ok: true,
              profiles: Object.fromEntries(
                profileIds.map((id) => [id, id === profileId ? profile : null])
              ),
            };
          },
        },
      } as unknown as CoreBindings);
      const context = createRpcContext({
        requestId: "name-repair-read",
        profileId,
        profileKind: "agent",
        ownerUserId: "name-repair-owner",
      });
      if (surface === "directory") {
        const directory = await repairedSpace.rpcGetMemberDirectory({
          spaceId,
          context,
        });
        return directory.members.find(
          (member) => member.profileId === profileId
        )?.displayName;
      }
      if (surface === "active progress") {
        const progress = await repairedSpace.rpcGetActiveWakeProgress({
          spaceId,
          context,
        });
        expect(progress.items).toHaveLength(1);
        expect(progress.items[0]?.phase).toBe("running");
        return progress.items[0]?.targetLabel;
      }
      const signal = await repairedSpace.rpcPostSignal({
        spaceId,
        text: "Reply from the Center Agent",
        authoringPolicy: "system_emitted",
        profile: {
          kind: "agent",
          profileId,
          profileName: "Forged posted name",
        },
        context: createRpcContext({
          requestId: "name-repair-publication",
          profileId,
          profileKind: "agent",
          profileName: "Forged context name",
          ownerUserId: "name-repair-owner",
          agentControllerRef: "hosted:center-agent",
        }),
      });
      return signal.profile.profileName;
    });
    expect(name?.startsWith("@") ? name.slice(1) : name).toBe(
      failure ? "Previous Center Agent" : "Amplift Center Agent"
    );
    if (failure) {
      expect(Date.now() - startedAt).toBeLessThan(2000);
    }
    const member = await runInDurableObject(stub, (_instance, state) =>
      readSpaceMemberRecord(state.storage.sql, profileId)
    );
    expect(member?.profileNameSnapshot).toBe(
      failure ? "Previous Center Agent" : "Amplift Center Agent"
    );
    expect(member?.status).toBe("active");
  });
  it("preserves origin facts on direct DO rpc signals when the posted profile matches the authenticated agent", async () => {
    const workingDirectory = " /tmp/rpc-origin ";
    const spaceId = await createSpace({
      name: `rpc-origin-${Date.now()}`,
    });
    const rpcContext = createRpcContext({
      requestId: "rpc-origin-request",
      profileId: "rpc-origin-profile",
      profileKind: "agent",
      profileName: "Origin RPC Agent",
      ownerUserId: "rpc-origin-owner",
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationId: "session-runtime-1",
    });
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId)) as unknown as {
      rpcPostSignal: (input: {
        spaceId: string;
        profile: {
          kind: "agent";
          profileId: string;
          profileName?: string;
          agentControllerRef?: string;
          agentControllerConversationId?: string;
          workingDirectory?: string;
        };
        text: string;
        authoringPolicy: "system_emitted";
        context?: typeof rpcContext;
      }) => Promise<{
        type: string;
        profile?: {
          profileId?: string;
          agentControllerConversationId?: string;
          agentControllerRef?: string;
          workingDirectory?: string;
        };
        data?: {
          text?: string;
        };
      }>;
      rpcListSignals: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: {
            text?: string;
          };
          profile?: {
            agentControllerConversationId?: string;
            agentControllerRef?: string;
            workingDirectory?: string;
          };
        }>;
        nextCursor: string | null;
      }>;
    };
    const posted = await stub.rpcPostSignal({
      spaceId,
      profile: {
        kind: "agent",
        profileId: rpcContext.actorContext.openMeldProfileId,
        profileName: "Origin RPC Agent",
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationId:
          "agent:openmeld-demo:openmeld-space:rpc-origin",
        workingDirectory,
      },
      text: "hello from direct do rpc origin",
      authoringPolicy: "system_emitted",
      context: rpcContext,
    });
    expect(posted.type).toBe("signal.text");
    expect(posted.profile?.profileId).toBe(
      rpcContext.actorContext.openMeldProfileId
    );
    expect(posted.profile?.agentControllerRef).toBe("builtin:openclaw");
    expect(posted.profile?.agentControllerConversationId).toBe(
      "agent:openmeld-demo:openmeld-space:rpc-origin"
    );
    expect(posted.profile?.workingDirectory).toBe(workingDirectory);
    const listed = await stub.rpcListSignals({
      spaceId,
      context: rpcContext,
    });
    expect(
      listed.signals.some(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data?.text === "hello from direct do rpc origin" &&
          signal.profile?.agentControllerRef === "builtin:openclaw" &&
          signal.profile?.agentControllerConversationId ===
            "agent:openmeld-demo:openmeld-space:rpc-origin" &&
          signal.profile?.workingDirectory === workingDirectory
      )
    ).toBe(true);
  });
  it("returns password errors for direct status and system notices once auth context is valid", async () => {
    const spaceId = await createSpace({
      name: "rpc-signal-auth",
      password: "secret-rpc-signal",
    });
    const statusError = await rpcPostStatusSignal(
      env as unknown as CoreBindings,
      {
        spaceId,
        password: "wrong-password",
        context: createRpcContext({
          requestId: "rpc-direct-status-auth-order",
          profileId: "rpc-direct-status-auth-order",
          profileKind: "agent",
        }),
        profile: {
          kind: "agent",
          owner: "forged-owner",
          profileId: "forged-status-agent",
          profileName: "Forged Status Agent",
        },
        data: {
          actorProfileId: "forged-status-agent",
          dispatchId: "dispatch-direct-status-auth-order",
          generatedBy: "openmeld",
          status: "done",
          text: "done",
        },
      }
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(statusError).toMatchObject({
      message: expect.stringContaining("space password invalid"),
      cause: {
        status: 403,
        message: "space password invalid",
      },
    });
    const systemNoticeError = await rpcPostSystemNoticeSignal(
      env as unknown as CoreBindings,
      {
        spaceId,
        password: "wrong-password",
        context: createRpcContext({
          requestId: "rpc-direct-notice-auth-order",
          profileId: "rpc-direct-notice-auth-order",
          profileKind: "agent",
        }),
        profile: {
          kind: "agent",
          owner: "forged-owner",
          profileId: "forged-notice-agent",
          profileName: "Forged Notice Agent",
        },
        data: {
          noticeType: "stay_silent",
          actorProfileId: "forged-notice-agent",
          dispatchId: "dispatch-direct-notice-auth-order",
          generatedBy: "openmeld",
          reason: "Handled privately.",
          text: "Handled privately.",
        },
      }
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(systemNoticeError).toMatchObject({
      message: expect.stringContaining("space password invalid"),
      cause: {
        status: 403,
        message: "space password invalid",
      },
    });
  });
  it("returns only formal post-anchor updates", async () => {
    const spaceId = await createSpace({
      name: "updates-read",
    });
    const postTextSignal = async (body: Record<string, unknown>) => {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/signals`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      expect(response.status).toBe(200);
      return parseEnvelope(await response.json());
    };
    const anchorSignal = await postTextSignal({
      type: "signal.text",
      data: {
        text: "anchor",
      },
    });
    if (!isTextSignalEnvelope(anchorSignal)) {
      throw new Error("Expected text anchor signal");
    }
    await postTextSignal({
      type: "signal.text",
      data: {
        text: "visible follow-up",
      },
    });
    await postTextSignal({
      type: "signal.text",
      data: {
        text: "transient follow-up",
        meta: {
          transient: true,
        },
      },
    });
    await rpcPostSignal(env as unknown as CoreBindings, {
      spaceId,
      context: createRpcContext({
        requestId: "rpc-updates-system-text",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld System",
      }),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      text: "The proactive review result is ready.",
      authoringPolicy: "system_emitted",
    });
    const actorProfileId = "agt_77777777-7777-4777-8777-777777777777";
    await rpcPostStatusSignal(env as unknown as CoreBindings, {
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_finalization",
      context: createRpcContext({
        requestId: "rpc-updates-status",
        profileId: actorProfileId,
        profileKind: "agent",
        profileName: "Updates Agent",
        ownerUserId: "owner-updates",
      }),
      profile: {
        kind: "agent",
        owner: "owner-updates",
        profileId: actorProfileId,
        profileName: "Updates Agent",
      },
      data: {
        actorProfileId,
        dispatchId: "dispatch-updates-1",
        generatedBy: "openmeld",
        status: "done",
        text: "status follow-up",
      },
    });
    await rpcPostSystemNoticeSignal(env as unknown as CoreBindings, {
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      context: createRpcContext({
        requestId: "rpc-updates-notice",
        profileId: actorProfileId,
        profileKind: "agent",
        profileName: "Updates Agent",
        ownerUserId: "owner-updates",
      }),
      profile: {
        kind: "agent",
        owner: "owner-updates",
        profileId: actorProfileId,
        profileName: "Updates Agent",
      },
      data: {
        noticeType: "stay_silent",
        actorProfileId,
        actorName: "Updates Agent",
        dispatchId: "dispatch-updates-2",
        generatedBy: "openmeld",
        reason: "Handled privately.",
        text: "Updates Agent chose to stay silent: Handled privately.",
      },
    });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(historyResponse.status).toBe(200);
    const historyPayload = (await historyResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(historyPayload.signals?.map((signal) => signal.type)).toEqual([
      "signal.text",
      "signal.text",
      "signal.text",
      "signal.text",
      "signal.status",
      "signal.system_notice",
    ]);
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/updates?afterSignalId=${encodeURIComponent(anchorSignal.id)}&limit=10`
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(payload.signals?.map((signal) => signal.type)).toEqual([
      "signal.text",
      "signal.text",
      "signal.status",
      "signal.system_notice",
    ]);
    expect(
      payload.signals?.some(
        (signal) =>
          signal.type === "signal.text" &&
          (
            signal.data as {
              text?: string;
            }
          ).text === "transient follow-up"
      )
    ).toBe(false);
    expect(
      payload.signals?.some(
        (signal) =>
          signal.type === "signal.text" &&
          (
            signal.data as {
              text?: string;
            }
          ).text === "The proactive review result is ready."
      )
    ).toBe(true);
  });
  it("persists system notices emitted with the internal OpenMeld system context", async () => {
    const spaceId = await createSpace({
      name: "system-notice-context",
    });
    await rpcPostSystemNoticeSignal(env as unknown as CoreBindings, {
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      context: createRpcContext({
        requestId: "rpc-system-notice-context",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld System",
      }),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      data: {
        noticeType: "terminal_failure",
        actorProfileId: "agt_77777777-7777-4777-8777-777777777777",
        actorName: "OpenClaw Demo",
        dispatchId: "dispatch-openclaw-auth-1",
        generatedBy: "openmeld",
        reason:
          "Authentication failed in OpenClaw. Run `openclaw logs --follow`, re-authenticate, then retry.",
        text: "OpenClaw Demo couldn't reply: Authentication failed in OpenClaw. Run `openclaw logs --follow`, re-authenticate, then retry.",
      },
    });
    const historyResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=20`
    );
    expect(historyResponse.status).toBe(200);
    const historyPayload = (await historyResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(historyPayload.signals?.map((signal) => signal.type)).toContain(
      "signal.system_notice"
    );
    expect(historyPayload.signals?.at(-1)).toMatchObject({
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        dispatchId: "dispatch-openclaw-auth-1",
      },
    });
  });
  it("retains the frozen pre-head failure signal identity across Space publication replay", async () => {
    const spaceId = await createSpace({ name: "pre-head-failure-replay" });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "signal.text",
          data: { text: "Check the task." },
        }),
      }
    );
    expect(response.status).toBe(200);
    const source = parseEnvelope(await response.json());
    if (!source) {
      throw new Error("Expected the saved source message.");
    }
    const targetProfileId = "agt_99999999-9999-4999-8999-999999999999";
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const dispatch = await runInDurableObject(stub, (_instance, state) => {
      const record = createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        nowMs: Date.now(),
        ruleId: "wake_explicit_activation",
        ruleReason: "Explicit Wake target",
        ruleSource: "registry",
        senderProfileId: DEFAULT_HUMAN_PROFILE_ID,
        sourceEventId: source.id,
        sourceSignalSnapshot: {
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          text: "Check the task.",
        },
        spaceId,
        targetProfileId,
      });
      insertDispatchOutboxRecord(state.storage.sql, record);
      return record;
    });
    const context = createRpcContext({
      requestId: "rpc-pre-head-replay",
      profileId: "openmeld-system",
      profileKind: "system",
      profileName: "OpenMeld System",
    });
    const command = {
      context,
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_failure_publication" as const,
      preHeadFailurePublication: { signalId: randomUUID() },
      profile: {
        kind: "system" as const,
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      data: {
        noticeType: "terminal_failure" as const,
        actorProfileId: targetProfileId,
        dispatchId: dispatch.dispatchId,
        failureStage: "execution" as const,
        generatedBy: "openmeld" as const,
        reasonCode: "profile.workspace.missing",
        text: "Choose a working folder before retrying this task.",
      },
      spaceAccess: createDispatchContinuationSpaceAccessContext({
        dispatchId: dispatch.dispatchId,
        requestContext: context,
        sourceSignalId: source.id,
        spaceId,
        targetProfileId,
      }),
    };
    await expect(
      rpcPostSystemNoticeSignal(env as unknown as CoreBindings, {
        ...command,
        spaceAccess: undefined,
      })
    ).rejects.toThrow(
      "dispatch.pre_head_failure_publication_authority_required"
    );
    await rpcPostSystemNoticeSignal(env as unknown as CoreBindings, command);
    await rpcPostSystemNoticeSignal(env as unknown as CoreBindings, command);
    await expect(
      stub.rpcReadFinalReplyClaimOutcome({
        dispatchId: dispatch.dispatchId,
        spaceId,
        profileId: targetProfileId,
      })
    ).resolves.toEqual({
      outcome: "failure",
      signalId: command.preHeadFailurePublication.signalId,
    });
    await runInDurableObject(stub, (_instance, state) => {
      const notices = state.storage.sql
        .exec<{ id: string }>(
          "SELECT id FROM space_signals WHERE id = ?",
          command.preHeadFailurePublication.signalId
        )
        .toArray();
      expect(notices).toHaveLength(1);
    });
  });
  it("keeps a pre-agent stop notice in the originating thread when its publisher lacks thread context", async () => {
    const spaceId = await createSpace({ name: "thread-stop-placement" });
    const postText = async (url: string, text: string) => {
      const response = await fetchWithOpenMeldAuth(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "signal.text", data: { text } }),
      });
      expect(response.status).toBe(200);
      const signal = parseEnvelope(await response.json());
      if (!isTextSignalEnvelope(signal)) {
        throw new Error("Expected a text signal");
      }
      return signal;
    };
    const root = await postText(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      "Thread root"
    );
    const createThreadResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/threads`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientMutationId: `create-thread-${randomUUID()}`,
          rootSignalId: root.id,
        }),
      }
    );
    expect(createThreadResponse.status).toBe(200);
    const createdThread = (await createThreadResponse.json()) as {
      thread: {
        threadId: string;
      };
    };
    const threadUrl = `${BASE_URL}/v1/spaces/${spaceId}/threads/${createdThread.thread.threadId}/signals`;
    const sourceResponse = await fetchWithOpenMeldAuth(threadUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientMessageId: `thread-wake-${randomUUID()}`,
        text: "Wake from this thread",
      }),
    });
    expect(sourceResponse.status).toBe(200);
    const sourcePayload = (await sourceResponse.json()) as {
      signal?: SignalEnvelope;
    };
    const source = sourcePayload.signal;
    if (!(source && isTextSignalEnvelope(source))) {
      throw new Error("Expected a thread text signal");
    }
    const targetProfileId = "agt_99999999-9999-4999-8999-999999999999";
    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const stub = namespace.get(namespace.idFromString(spaceId));
    const dispatch = await runInDurableObject(stub, (_instance, state) => {
      const record = createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        dispatchPolicy: "mention_only",
        nowMs: Date.now(),
        ruleId: "wake_explicit_activation",
        ruleReason: "Explicit Wake target",
        ruleSource: "registry",
        senderProfileId: DEFAULT_HUMAN_PROFILE_ID,
        sourceEventId: source.id,
        sourceSignalSnapshot: {
          profileId: DEFAULT_HUMAN_PROFILE_ID,
          profileKind: "human",
          text: source.data.text,
        },
        spaceId,
        targetProfileId,
      });
      insertDispatchOutboxRecord(state.storage.sql, record);
      return record;
    });
    const requestContext = createRpcContext({
      requestId: "rpc-thread-pre-agent-stop",
      profileId: "openmeld-system",
      profileKind: "system",
      profileName: "OpenMeld System",
    });
    const stopped = await rpcPostSystemNoticeSignal(
      env as unknown as CoreBindings,
      {
        spaceId,
        finalOutcomeAuthority: "runtime_coordinator_wake_stop_publication",
        context: requestContext,
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        data: {
          noticeType: "wake_stopped",
          actorProfileId: targetProfileId,
          dispatchId: dispatch.dispatchId,
          generatedBy: "openmeld",
          text: "This Wake was stopped before execution.",
        },
        spaceAccess: createDispatchContinuationSpaceAccessContext({
          dispatchId: dispatch.dispatchId,
          requestContext,
          sourceSignalId: source.id,
          spaceId,
          targetProfileId,
        }),
      }
    );
    const threadResponse = await fetchWithOpenMeldAuth(threadUrl);
    expect(threadResponse.status).toBe(200);
    const threadHistory = (await threadResponse.json()) as {
      signals?: SignalEnvelope[];
    };
    expect(threadHistory.signals?.map((signal) => signal.id)).toContain(
      stopped.id
    );
  });
  it("returns not found for a missing updates anchor signal", async () => {
    const spaceId = await createSpace({
      name: "updates-anchor-not-found",
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/updates?afterSignalId=missing-anchor&limit=10`
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "space.updates.anchor_not_found",
    });
  });
  it("drops retired status permission from a legacy PATCH /contract", async () => {
    const spaceId = await createSpace({
      name: "phase-5b-contract",
      password: "secret-0321",
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/contract`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          publicationMode: "raw_context_sharing",
          allowedActions: ["post_status", "stay_silent"],
          resultArchivePolicy: {
            mode: "space_reply_only",
          },
          entryBrief: "none",
        }),
      },
      undefined,
      {
        spacePassword: "secret-0321",
      }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      publicationMode: "raw_context_sharing",
      allowedActions: ["stay_silent"],
      resultArchivePolicy: {
        mode: "space_reply_only",
      },
      entryBrief: "none",
      dispatchBrief: "default",
      authorityOrder: "default",
      updatedBy: DEFAULT_HUMAN_PROFILE_ID,
    });
  });
  it("treats a no-op PATCH /contract as idempotent and keeps the version unchanged", async () => {
    const spaceId = await createSpace({
      name: "phase-5b-contract-noop",
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/contract`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          allowedActions: ["stay_silent", "post_status", "post_message"],
        }),
      }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      updatedBy: "system",
      allowedActions: ["post_message", "stay_silent"],
    });
    const contractRead = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/contract`
    );
    expect(contractRead.status).toBe(200);
    await expect(contractRead.json()).resolves.toMatchObject({
      version: 1,
      updatedBy: "system",
      allowedActions: ["post_message", "stay_silent"],
    });
  });
  it("returns a canonical space status summary with the latest formal public update", async () => {
    const organizationId = randomUUID();
    const requestOptions = { activeOrganizationId: organizationId };
    const centerAgentProfileId = `agt_${randomUUID()}`;
    await ensureTestCenterAgentDesignation({
      agentProfileId: centerAgentProfileId,
      agentProfileName: "Center Agent",
      organizationId,
      ownerUserId:
        DEFAULT_TEST_AUTH_PROFILE.ownerUserId ?? "owner-test-default",
    });
    const spaceId = await createSpace(
      {
        name: "phase-5b-status",
      },
      undefined,
      requestOptions
    );
    const postResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Phase 5B status preview",
          },
        }),
      },
      undefined,
      requestOptions
    );
    expect(postResponse.status).toBe(200);
    await postResponse.text();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`,
      undefined,
      undefined,
      requestOptions
    );
    expect(response.status).toBe(200);
    const summary = await response.json();
    expect(summary).toMatchObject({
      spaceId,
      name: "phase-5b-status",
      centerAgentProfileId,
      organizationVisibility: "private",
      accessMode: "public",
      passwordProtected: false,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "stay_silent"],
      resultArchivePolicy: { mode: "space_reply_only" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: expect.objectContaining({
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
      }),
      latestVisibleUpdate: expect.objectContaining({
        signalType: "signal.text",
        actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
        previewText: "Phase 5B status preview",
      }),
    });
  });
  it("returns the latest formal update when the newest candidate is non-formal", async () => {
    const spaceId = await createSpace({
      name: "phase-5b-status-formal-fallback",
    });
    const formalResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Formal status summary preview",
          },
        }),
      }
    );
    expect(formalResponse.status).toBe(200);
    await formalResponse.text();
    const transientResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Transient should not win",
            meta: {
              transient: true,
            },
          },
        }),
      }
    );
    expect(transientResponse.status).toBe(200);
    await transientResponse.text();
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      latestVisibleUpdate: expect.objectContaining({
        signalType: "signal.text",
        actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
        previewText: "Formal status summary preview",
      }),
    });
  });
  it("returns the latest valid formal update when a newer system text signal uses an internal profile id", async () => {
    const spaceId = await createSpace({
      name: "phase-5b-status-system-text-fallback",
    });
    const formalResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "signal.text",
          data: {
            text: "Visible human status preview",
          },
        }),
      }
    );
    expect(formalResponse.status).toBe(200);
    await formalResponse.text();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await rpcPostSignal(env as unknown as CoreBindings, {
      spaceId,
      context: createRpcContext({
        requestId: "rpc-status-system-text-fallback",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld System",
      }),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      text: "Internal routing failure should not break status.",
      authoringPolicy: "system_emitted",
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      latestVisibleUpdate: expect.objectContaining({
        signalType: "signal.text",
        actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
        previewText: "Visible human status preview",
      }),
    });
  });
  it("returns a system notice as the latest visible update using the notice actor", async () => {
    const spaceId = await createSpace({
      name: "phase-5b-status-system-notice",
    });
    const actorProfileId = "agt_88888888-8888-4888-8888-888888888888";
    await rpcPostSystemNoticeSignal(env as unknown as CoreBindings, {
      spaceId,
      finalOutcomeAuthority: "runtime_coordinator_failure_publication",
      context: createRpcContext({
        requestId: "rpc-status-system-notice",
        profileId: "openmeld-system",
        profileKind: "system",
        profileName: "OpenMeld System",
      }),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      data: {
        noticeType: "terminal_failure",
        actorProfileId,
        actorName: "Notice Agent",
        dispatchId: "dispatch-status-system-notice-1",
        generatedBy: "openmeld",
        reason: "agent_profile_binding.lookup_failed",
        text: "Notice Agent couldn't reply because its local agent connection could not be resolved.",
      },
    });
    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      latestVisibleUpdate: expect.objectContaining({
        signalType: "signal.system_notice",
        actorProfileId,
        actorName: "Notice Agent",
        previewText:
          "Notice Agent couldn't reply because its local agent connection could not be resolved.",
      }),
    });
  });
  it("returns dispatch result unavailable when result storage is not ready", async () => {
    const spaceId = await createSpace({
      name: "result-read",
    });
    await postgresFixtureOperator(env).query({
      text: 'ALTER TABLE "openmeld"."openMeldDaemon_dispatch_results" RENAME TO "openMeldDaemon_dispatch_results_offline"',
      values: [],
    });
    try {
      const byDispatch = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/result?dispatchId=dispatch-live-1`
      );
      expect(byDispatch.status).toBe(503);
      await expect(byDispatch.json()).resolves.toMatchObject({
        code: "space.dispatch_result.unavailable",
      });
      const byResultRef = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/result?resultRef=${encodeURIComponent("dispatch-result:result-live-1")}`
      );
      expect(byResultRef.status).toBe(503);
      await expect(byResultRef.json()).resolves.toMatchObject({
        code: "space.dispatch_result.unavailable",
      });
    } finally {
      await postgresFixtureOperator(env).query({
        text: 'ALTER TABLE "openmeld"."openMeldDaemon_dispatch_results_offline" RENAME TO "openMeldDaemon_dispatch_results"',
        values: [],
      });
    }
  });
  it.each([
    "native",
    "outbox",
    "ledger",
  ] as const)("preserves native execution timing through the %s progress projection", async (carrier) => {
    const spaceId = await createSpace({ name: `native-timing-${carrier}` });
    const clientMessageId = randomUUID();
    const source = await postTextSignal(spaceId, "ping", clientMessageId);
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const nowMs = Date.now();
    const record = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      nowMs,
      ruleId: "wake_explicit_activation",
      ruleReason: "Explicit Wake target",
      ruleSource: "registry",
      senderProfileId: DEFAULT_HUMAN_PROFILE_ID,
      sourceEventId: source.id,
      sourceClientMessageId: clientMessageId,
      sourceSignalSnapshot: {
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        text: "ping",
      },
      spaceId,
      targetProfileId,
    });
    if (carrier !== "native") {
      const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
      await runInDurableObject(
        namespace.get(namespace.idFromString(spaceId)),
        (_instance, state) => {
          insertDispatchOutboxRecord(state.storage.sql, record);
          markDispatchOutboxHandedOff(state.storage.sql, {
            dispatchId: record.dispatchId,
            handedOffAtMs: nowMs,
          });
        }
      );
    }
    if (carrier === "ledger") {
      await getPostgresDatabase(env).query({
        text: '\n          INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger"\n            (idempotency_key, dispatch_id, space_id, source_event_id, source_client_message_id,\n             target_profile_id, status, first_seen_at_ms, last_attempt_at_ms, attempt_count)\n          VALUES ($1, $2, $3, $4, $5, $6, \'dispatching\', $7, $8, 1)\n        ',
        values: [
          record.idempotencyKey,
          record.dispatchId,
          spaceId,
          source.id,
          clientMessageId,
          targetProfileId,
          nowMs,
          nowMs,
        ],
      });
    }
    await upsertRemoteAgentNativeDeliveryRecord({
      db: getPostgresDatabase(env),
      nowMs,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      conversationKind: "space",
      spaceId,
      profileId: targetProfileId,
      bindingId: "native-timing-binding",
      sourceClientMessageId: clientMessageId,
      attemptId: null,
      triggerMessageId: source.id,
      dispatchId: record.dispatchId,
      idempotencyKey: record.idempotencyKey,
      status: "submitted",
    });
    const startedAtMs = nowMs + 10;
    await markRemoteAgentNativeDeliveryAck({
      db: getPostgresDatabase(env),
      nowMs: startedAtMs,
      idempotencyKey: record.idempotencyKey,
      submissionId: `timing-${record.dispatchId}`,
      accepted: true,
    });
    const spaceStub = (
      env.OPENMELD_SPACES as DurableObjectNamespace<Space>
    ).get(
      (env.OPENMELD_SPACES as DurableObjectNamespace<Space>).idFromString(
        spaceId
      )
    );
    await spaceStub.rpcResolveNativeReplyPlacement({
      spaceId,
      dispatchId: record.dispatchId,
      sourceSignalId: source.id,
      profileId: targetProfileId,
      defaultToThread: true,
      placement: "conversation",
      lock: false,
    });
    for (const includeTiming of [false, true]) {
      for (const path of [
        `active-wake-progress?includeTiming=${includeTiming}&includeReplyPlacement=${includeTiming}`,
        `wake-progress?clientMessageId=${clientMessageId}&targetProfileId=${targetProfileId}&includeTiming=${includeTiming}&includeReplyPlacement=${includeTiming}`,
      ]) {
        const response = await fetchSpaceDoWithOpenMeldAuth({
          spaceId,
          path: `/${path}`,
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          items: Array<{
            dispatchId: string;
            startedAtMs?: number;
            replyThreadRootSignalId?: string | null;
            replyPlacementRevision?: number;
          }>;
        };
        const item = body.items.find(
          (item) => item.dispatchId === record.dispatchId
        );
        expect(item).toBeDefined();
        expect(item?.startedAtMs).toBe(includeTiming ? startedAtMs : undefined);
        expect(item?.replyThreadRootSignalId).toBe(
          includeTiming ? null : undefined
        );
        expect(item?.replyPlacementRevision).toBe(
          includeTiming ? 1 : undefined
        );
      }
    }
  });

  it.each([
    "same Space",
    "another Space",
    "another Space with parent thread",
  ])("keeps continuation progress on the parent request when its child finishes in %s", async (childLocation) => {
    const parentSpaceId = await createSpace({ name: "synthetic-parent" });
    const childSpaceId =
      childLocation === "same Space"
        ? parentSpaceId
        : await createSpace({ name: "synthetic-child" });
    let parentRequest = await postTextSignal(
      parentSpaceId,
      "Summarize the child task"
    );
    let threadId: string | null = null;
    if (childLocation === "another Space with parent thread") {
      const threadResponse = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${parentSpaceId}/threads`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientMutationId: randomUUID(),
            rootSignalId: parentRequest.id,
          }),
        }
      );
      expect(threadResponse.status).toBe(200);
      const thread = (await threadResponse.json()) as {
        thread: {
          threadId: string;
        };
      };
      threadId = thread.thread.threadId;
      const requestResponse = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${parentSpaceId}/threads/${threadId}/signals`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientMessageId: randomUUID(),
            text: "Summarize the child task in this thread",
          }),
        }
      );
      expect(requestResponse.status).toBe(200);
      const payload = (await requestResponse.json()) as {
        signal: SignalEnvelope;
      };
      if (!isTextSignalEnvelope(payload.signal)) {
        throw new Error("Expected a thread request");
      }
      parentRequest = payload.signal;
    }
    const childResult = await postTextSignal(
      childSpaceId,
      "Child task complete"
    );
    const childAnchor = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${parentSpaceId}/signals?aroundSignalId=${childResult.id}&beforeCount=0&afterCount=0`
    );
    expect(childAnchor.status).toBe(childLocation === "same Space" ? 200 : 404);
    const targetProfileId = "agt_00000000-0000-4000-8000-000000000001";
    const nowMs = Date.now();
    const watchedTask = {
      v: 1 as const,
      kind: "space_wake" as const,
      spaceId: childSpaceId,
      sourceClientMessageId: `child-${childResult.id}`,
      targetProfileId,
    };
    const subscription = await registerAgentTaskCompletionSubscription({
      db: getPostgresDatabase(env),
      nowMs,
      completionCondition: "terminal",
      continuation: {
        kind: "resume_agent",
        delegationId: `delegation-${parentRequest.id}`,
        instruction: "Summarize the child result",
      },
      observerTask: {
        v: 1,
        kind: "native_delivery",
        deliveryId: `observer-${parentRequest.id}`,
      },
      watchedTask,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      idempotencyKey: `subscription-${parentRequest.id}`,
      subscriptionId: `subscription-${parentRequest.id}`,
    });
    await recordAgentTaskTerminalOutcome({
      db: getPostgresDatabase(env),
      nowMs,
      task: watchedTask,
      outcome: {
        status: "succeeded",
        errorCode: null,
        eventId: `done-${childResult.id}`,
        occurredAtMs: nowMs,
        publishedSignalId: childResult.id,
      },
    });
    const dispatchId = subscription.continuationIdempotencyKey;
    if (!dispatchId) {
      throw new Error("Expected a continuation dispatch identity");
    }
    await upsertRemoteAgentNativeDeliveryRecord({
      db: getPostgresDatabase(env),
      nowMs,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      conversationKind: "space",
      spaceId: parentSpaceId,
      profileId: targetProfileId,
      bindingId: "synthetic-binding",
      triggerMessageId: parentRequest.id,
      sourceClientMessageId: null,
      dispatchId,
      attemptId: null,
      idempotencyKey: dispatchId,
      status: "submitted",
      onBehalfOfProfileId: DEFAULT_HUMAN_PROFILE_ID,
    });
    await markRemoteAgentNativeDeliveryAck({
      db: getPostgresDatabase(env),
      nowMs,
      idempotencyKey: dispatchId,
      submissionId: `submission-${parentRequest.id}`,
      accepted: true,
    });
    for (const includeWakeStopEligibility of [false, true]) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${parentSpaceId}/active-wake-progress?includeSourceContext=true&includeTiming=true&includeWakeStopEligibility=${includeWakeStopEligibility}`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        items: Array<{
          dispatchId: string;
          sourceSignalId: string;
          sourceContext: unknown;
        }>;
      };
      const item = body.items.find((item) => item.dispatchId === dispatchId);
      expect.soft(item?.sourceSignalId).toBe(parentRequest.id);
      expect
        .soft(item?.sourceContext)
        .toMatchObject({ threadId, profileId: DEFAULT_HUMAN_PROFILE_ID });
    }
    await markRemoteAgentNativeDeliveryCompleted({
      db: getPostgresDatabase(env),
      nowMs: nowMs + 1,
      submissionId: `submission-${parentRequest.id}`,
      publishedSignalId: null,
    });
    for (const includeWakeStopEligibility of [false, true]) {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${parentSpaceId}/active-wake-progress?includeWakeStopEligibility=${includeWakeStopEligibility}`
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        items: Array<{
          dispatchId: string;
        }>;
      };
      expect(body.items.some((item) => item.dispatchId === dispatchId)).toBe(
        false
      );
    }
  });
  it("returns active Wake progress unavailable when the progress store is not readable", async () => {
    const spaceId = await createSpace({
      name: "active-wake-progress-read",
    });
    await postgresFixtureOperator(env).query({
      text: 'ALTER TABLE "openmeld"."openMeldDaemon_runtime_coordinator_executions" RENAME TO "openMeldDaemon_runtime_coordinator_executions_offline"',
      values: [],
    });
    try {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/active-wake-progress`
      );
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "space.wake_progress.store_unavailable",
      });
    } finally {
      await postgresFixtureOperator(env).query({
        text: 'ALTER TABLE "openmeld"."openMeldDaemon_runtime_coordinator_executions_offline" RENAME TO "openMeldDaemon_runtime_coordinator_executions"',
        values: [],
      });
    }
  });
  describe("space index projection degradation", () => {
    const FOURTH_HUMAN_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
    async function withBrokenSpaceIndexProjection(
      run: () => Promise<void>
    ): Promise<void> {
      await postgresFixtureOperator(env).query({
        text: 'ALTER TABLE "openmeld"."space_index_spaces" RENAME TO "space_index_spaces_offline"',
        values: [],
      });
      try {
        await run();
      } finally {
        await postgresFixtureOperator(env).query({
          text: 'ALTER TABLE "openmeld"."space_index_spaces_offline" RENAME TO "space_index_spaces"',
          values: [],
        });
      }
    }
    function buildResolvedHumanMember(input: {
      profileId: string;
      profileName: string;
    }) {
      return {
        profileId: input.profileId,
        profileName: input.profileName,
        profileKind: "human",
        ownerUserId: null,
        ownerName: null,
        agentControllerRef: null,
      };
    }
    async function addResolvedMembers(
      spaceId: string,
      members: Array<{
        profileId: string;
        profileName: string;
      }>,
      authProfile: Partial<TestAuthProfile>
    ): Promise<Response> {
      return await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            members: members.map(buildResolvedHumanMember),
          }),
        },
        authProfile
      );
    }
    it("keeps member adds successful when the Space Index projection fails", async () => {
      const creatorProfile: Partial<TestAuthProfile> = {
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Space Host",
        ownerUserId: "owner-index-degraded-1",
        openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      };
      const spaceId = await createSpace(
        { name: "index-degraded-add-room" },
        creatorProfile
      );
      await withBrokenSpaceIndexProjection(async () => {
        const addResponse = await addResolvedMembers(
          spaceId,
          [{ profileId: THIRD_HUMAN_PROFILE_ID, profileName: "Added Human" }],
          creatorProfile
        );
        expect(addResponse.status).toBe(200);
        const addPayload = (await addResponse.json()) as {
          addedMemberIds?: string[];
          alreadyMemberIds?: string[];
        };
        expect(addPayload.addedMemberIds).toEqual([THIRD_HUMAN_PROFILE_ID]);
        expect(addPayload.alreadyMemberIds).toEqual([]);
        const listResponse = await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/members`,
          undefined,
          creatorProfile
        );
        expect(listResponse.status).toBe(200);
        const listPayload = (await listResponse.json()) as {
          humans?: Array<{
            profileId?: string;
          }>;
        };
        expect(listPayload.humans).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ profileId: THIRD_HUMAN_PROFILE_ID }),
          ])
        );
      });
      const recoveryAddResponse = await addResolvedMembers(
        spaceId,
        [
          {
            profileId: DEFAULT_HUMAN_PROFILE_ID,
            profileName: "Recovery Human",
          },
        ],
        creatorProfile
      );
      expect(recoveryAddResponse.status).toBe(200);
      await recoveryAddResponse.json();
      const indexedMembers = await getPostgresDatabase(env).query<{
        profile_id: string;
      }>({
        ...{
          text: 'SELECT profile_id FROM "openmeld"."space_index_memberships" WHERE space_id = $1',
          values: [],
        },
        values: [spaceId],
      });
      const indexedProfileIds = (indexedMembers.rows ?? []).map(
        (row) => row.profile_id
      );
      expect(indexedProfileIds).toEqual(
        expect.arrayContaining([
          THIRD_HUMAN_PROFILE_ID,
          DEFAULT_HUMAN_PROFILE_ID,
        ])
      );
    });
    it("keeps member removal and leave successful when the Space Index projection fails", async () => {
      const creatorProfile: Partial<TestAuthProfile> = {
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Space Host",
        ownerUserId: "owner-index-degraded-2",
        openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      };
      const leaverProfile: Partial<TestAuthProfile> = {
        profileId: FOURTH_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Leaving Human",
        ownerUserId: "owner-index-degraded-leaver",
        openMeldProfileId: FOURTH_HUMAN_PROFILE_ID,
      };
      const spaceId = await createSpace(
        { name: "index-degraded-remove-room" },
        creatorProfile
      );
      const seedResponse = await addResolvedMembers(
        spaceId,
        [
          {
            profileId: THIRD_HUMAN_PROFILE_ID,
            profileName: "Removable Human",
          },
          { profileId: FOURTH_HUMAN_PROFILE_ID, profileName: "Leaving Human" },
        ],
        creatorProfile
      );
      expect(seedResponse.status).toBe(200);
      await seedResponse.json();
      await withBrokenSpaceIndexProjection(async () => {
        const removeResponse = await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/members/remove`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              memberProfileIds: [THIRD_HUMAN_PROFILE_ID],
            }),
          },
          creatorProfile
        );
        expect(removeResponse.status).toBe(200);
        await expect(removeResponse.json()).resolves.toEqual({
          removedMemberIds: [THIRD_HUMAN_PROFILE_ID],
          alreadyAbsentMemberIds: [],
        });
        const leaveResponse = await fetchSpaceDoWithOpenMeldAuth(
          { path: "/leave", spaceId },
          { method: "POST" },
          leaverProfile
        );
        expect(leaveResponse.status).toBe(200);
        await expect(leaveResponse.json()).resolves.toEqual({
          leftProfileId: FOURTH_HUMAN_PROFILE_ID,
          status: "left",
        });
      });
    });
    it("keeps space meta updates successful when the Space Index projection fails", async () => {
      const creatorProfile: Partial<TestAuthProfile> = {
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Space Host",
        ownerUserId: "owner-index-degraded-3",
        openMeldProfileId: SECOND_HUMAN_PROFILE_ID,
      };
      const spaceId = await createSpace(
        { name: "index-degraded-meta-room" },
        creatorProfile
      );
      await withBrokenSpaceIndexProjection(async () => {
        const patchResponse = await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/meta`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "index-degraded-meta-renamed" }),
          },
          creatorProfile
        );
        expect(patchResponse.status).toBe(200);
        await patchResponse.json();
        const metaResponse = await fetchWithOpenMeldAuth(
          `${BASE_URL}/v1/spaces/${spaceId}/meta`,
          undefined,
          creatorProfile
        );
        expect(metaResponse.status).toBe(200);
        const metaPayload = (await metaResponse.json()) as {
          meta?: {
            name?: string;
          };
          name?: string;
        };
        expect(metaPayload.meta?.name ?? metaPayload.name).toBe(
          "index-degraded-meta-renamed"
        );
      });
    });
  });
});
function isTextSignalEnvelope(
  value: SignalEnvelope | null
): value is SignalEnvelope & {
  type: "signal.text";
} {
  return value?.type === "signal.text";
}
it("enforces message pin ownership through the authorized Space RPC", async () => {
  await ensureTestOrganizationMembership({
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    userId: "other-pin-owner",
  });
  const spaceId = await createSpace();
  const signal = await postTextSignal(
    spaceId,
    "A shared decision\nwith a long explanation."
  );
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const stub = namespace.get(namespace.idFromString(spaceId));
  const context = createRpcContext({
    profileId: DEFAULT_HUMAN_PROFILE_ID,
    profileKind: "human",
    ownerUserId: "owner-test-default",
    requestId: "pin-owner",
  });
  const otherContext = createRpcContext({
    profileId: SECOND_HUMAN_PROFILE_ID,
    profileKind: "human",
    ownerUserId: "other-pin-owner",
    requestId: "pin-other",
  });
  await rpcAddSpaceMembers(env as CoreBindings, {
    spaceId,
    context,
    members: [
      {
        profileId: SECOND_HUMAN_PROFILE_ID,
        profileKind: "human",
        profileName: "Blair",
        ownerUserId: "other-pin-owner",
        ownerName: "Blair",
        agentControllerRef: null,
      },
    ],
  });
  const pinned = await stub.rpcMessagePins({
    spaceId,
    context,
    mutation: { signalId: signal.id, action: "pin" },
  });
  expect(pinned.pins).toMatchObject([
    {
      signalId: signal.id,
      pinnedByProfileId: DEFAULT_HUMAN_PROFILE_ID,
      preview: "A shared decision with a long explanation.",
    },
  ]);
  await expect(
    async () =>
      await stub.rpcMessagePins({
        spaceId,
        context: otherContext,
        mutation: { signalId: signal.id, action: "unpin" },
      })
  ).rejects.toThrow("403");
  const retry = await stub.rpcMessagePins({
    spaceId,
    context: otherContext,
    mutation: { signalId: signal.id, action: "pin" },
  });
  expect(retry.pins).toEqual(pinned.pins);
  const unjoined = createRpcContext({
    profileId: THIRD_HUMAN_PROFILE_ID,
    profileKind: "human",
    ownerUserId: "unjoined-pin-owner",
    requestId: "pin-unjoined",
  });
  await expect(
    async () =>
      await stub.rpcMessagePins({
        spaceId,
        context: unjoined,
        mutation: { signalId: signal.id, action: "pin" },
      })
  ).rejects.toThrow("403");
  const otherSpaceId = await createSpace();
  const otherSignal = await postTextSignal(otherSpaceId, "Other Space");
  await expect(
    async () =>
      await stub.rpcMessagePins({
        spaceId,
        context,
        mutation: { signalId: otherSignal.id, action: "pin" },
      })
  ).rejects.toThrow("404");
  expect((await stub.rpcMessagePins({ spaceId, context })).pins).toEqual(
    pinned.pins
  );
  const fileId = "pin-test-file";
  await runInDurableObject(stub, (_instance, state) => {
    const repository = new SpaceFileRepository(state.storage);
    repository.commitWrite({
      actor: {
        profileId: DEFAULT_HUMAN_PROFILE_ID,
        profileKind: "human",
        displayName: "Alex",
        ownerUserId: "owner-test-default",
      },
      nowMs: Date.now(),
      auditEvent: {
        actorKind: "authenticated",
        actorProfileId: DEFAULT_HUMAN_PROFILE_ID,
        entryId: fileId,
        errorCode: null,
        eventId: "pin-file-write",
        occurredAtMs: Date.now(),
        operation: "content_write",
        operationId: "pin-file-write",
        organizationId: "org-files-test",
        representedHumanProfileId: null,
        requestId: "pin-file-write",
        result: "succeeded",
        revisionId: "pin-file-revision",
        spaceId,
      },
      write: {
        spaceId,
        fileId,
        revisionId: "pin-file-revision",
        name: "Decision.md",
        parentId: null,
        baseRevision: null,
        clientMutationId: "pin-file-write",
        mimeType: "text/markdown",
        sizeBytes: 20,
      },
    });
  });
  const filePins = await stub.rpcFilePins({
    spaceId,
    context,
    mutation: { fileId, action: "pin" },
  });
  expect(filePins.pins).toMatchObject([
    {
      file: { id: fileId, name: "Decision.md" },
      pinnedByProfileId: DEFAULT_HUMAN_PROFILE_ID,
    },
  ]);
  await expect(
    async () =>
      await stub.rpcFilePins({
        spaceId,
        context: otherContext,
        mutation: { fileId, action: "unpin" },
      })
  ).rejects.toThrow("403");
  expect((await stub.rpcMessagePins({ spaceId, context })).pins).toEqual(
    pinned.pins
  );
  await expect(
    async () =>
      await stub.rpcFilePins({
        spaceId,
        context,
        mutation: { fileId: signal.id, action: "pin" },
      })
  ).rejects.toThrow("404");
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE space_file_entries SET name = ? WHERE entry_id = ?",
      "Updated decision.md",
      fileId
    );
  });
  expect(
    (await stub.rpcFilePins({ spaceId, context })).pins[0]?.file.name
  ).toBe("Updated decision.md");
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec(
      "UPDATE space_file_entries SET trashed_at_ms = ? WHERE entry_id = ?",
      Date.now(),
      fileId
    );
  });
  expect((await stub.rpcFilePins({ spaceId, context })).pins).toEqual([]);
  expect(
    (
      await stub.rpcFilePins({
        spaceId,
        context,
        mutation: { fileId, action: "unpin" },
      })
    ).pins
  ).toEqual([]);
  expect(
    (
      await stub.rpcMessagePins({
        spaceId,
        context,
        mutation: { signalId: signal.id, action: "unpin" },
      })
    ).pins
  ).toEqual([]);
});
