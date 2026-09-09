import { env, runInDurableObject, SELF } from "cloudflare:test";
import { RpcStub, RpcTarget } from "cloudflare:workers";
import { createHash, randomUUID } from "node:crypto";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  MAX_PROFILE_ID_LENGTH,
  MAX_TEXT_LENGTH,
  parseEnvelope,
} from "@openmeld/protocol";
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
import {
  createAnonymousViewerSpaceAccessContext,
  createAuthenticatedSpaceAccessContext,
  createDispatchContinuationSpaceAccessContext,
} from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import { writeDispatchResult } from "../src/dispatch/application/dispatch-result-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentPreAdmissionFailurePublished,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  rpcAddSpaceMembers,
  rpcCenterAgentPostSpaceMessage,
  rpcCreateCenterAgentContextManifest,
  rpcCreateSpace,
  rpcGetSpaceBoard,
  rpcGetSpaceStatus,
  rpcListCenterAgentSessions,
  rpcOpenCenterAgentDirectMessageSpace,
  rpcPostSignal,
  rpcPostStatusSignal,
  rpcPostSystemNoticeSignal,
} from "../src/rpc/methods";
import { upsertJoinedSpaceMember } from "../src/space/application/space-members-service";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  markDispatchOutboxCancelled,
  markDispatchOutboxHandedOff,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { SpaceFileRepository } from "../src/space/infrastructure/sql/space-file-repo";
import { readSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { Space } from "../src/space/transport/do/space";
import { waitForJsonMessage } from "./test-support/ws-stream";

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
  input: { path: string; spaceId: string },
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
): Promise<{ code: unknown; message: unknown; status: number }> {
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
  await env.OPENMELD_DB.prepare(
    `
      INSERT OR IGNORE INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 1, ?, ?)
    `
  )
    .bind(
      input.userId,
      `Test User ${userSlug}`,
      `${userSlug}@openmeld.test`,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT OR IGNORE INTO organizations (
        id,
        name,
        slug,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `
  )
    .bind(
      input.organizationId,
      `Test Organization ${organizationSlug}`,
      organizationSlug,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT OR IGNORE INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES (?, ?, ?, 'member', ?)
    `
  )
    .bind(
      `${input.organizationId}:${input.userId}`,
      input.organizationId,
      input.userId,
      nowMs
    )
    .run();
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
        last_used_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'agent', 0, 'active', ?, ?, ?, NULL, 'cli_create', NULL, NULL, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        profile_name = excluded.profile_name,
        status = excluded.status,
        organization_id = excluded.organization_id,
        owner_user_id = excluded.owner_user_id,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      input.agentProfileId,
      input.agentProfileName,
      `center-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      )
      VALUES (?, ?, NULL, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        agent_profile_id = excluded.agent_profile_id,
        duty = NULL,
        designated_by = excluded.designated_by,
        created_at = excluded.created_at
    `
  )
    .bind(input.organizationId, input.agentProfileId, input.ownerUserId, nowMs)
    .run();
}

async function insertTestManagedCenterAgentProfile(input: {
  agentProfileId: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const nowMs = Date.now();
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
        last_used_at,
        created_at,
        updated_at
      )
      VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, ?, ?, NULL, 'auth_bootstrap', 'center_agent', NULL, ?, ?)
    `
  )
    .bind(
      input.agentProfileId,
      `center-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs
    )
    .run();
}

async function insertTestOrganizationAgentProfile(input: {
  agentProfileId: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  const nowMs = Date.now();
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
        last_used_at,
        created_at,
        updated_at
      )
      VALUES (?, 'Research Agent', ?, 'agent', 0, 'active', ?, ?, ?, NULL, 'web_create', NULL, NULL, ?, ?)
    `
  )
    .bind(
      input.agentProfileId,
      `research-agent-${randomUUID()}`,
      input.organizationId,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs
    )
    .run();
}

async function insertTestPrimaryHumanProfile(input: {
  ownerUserId: string;
  profileId: string;
}): Promise<void> {
  const nowMs = Date.now();
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
        last_used_at,
        created_at,
        updated_at
      )
      VALUES (?, 'Fresh Owner', ?, 'human', 1, 'active', NULL, ?, ?, NULL, 'auth_bootstrap', NULL, NULL, ?, ?)
    `
  )
    .bind(
      input.profileId,
      `fresh-owner-${randomUUID()}`,
      input.ownerUserId,
      input.ownerUserId,
      nowMs,
      nowMs
    )
    .run();
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
    const creator = (body as { creator?: unknown } | null)?.creator;
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
    const profile = (body as { profile?: unknown } | null)?.profile;
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

  const data = (await response.json()) as { spaceId?: unknown };
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

async function readResponseStatusAndCode(
  response: Response
): Promise<{ code?: string; status: number }> {
  const status = response.status;
  const payload = (await response.json()) as { code?: string };
  return {
    status,
    ...(payload.code === undefined ? {} : { code: payload.code }),
  };
}

async function postTextSignal(
  spaceId: string,
  text: string
): Promise<SignalEnvelope & { type: "signal.text" }> {
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
    const failingWakeEvidenceDb = {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.reject(new Error("d1 unavailable")),
        }),
      }),
    } as unknown as D1Database;

    const result = await runInDurableObject(stub, async (_instance, state) => {
      const restarted = new Space(state, {
        ...(env as unknown as CoreBindings),
        OPENMELD_WAKE_EVIDENCE_DB: failingWakeEvidenceDb,
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
    const emptyWakeEvidenceDb = {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.resolve(null),
        }),
      }),
    } as unknown as D1Database;

    const result = await runInDurableObject(stub, async (_instance, state) => {
      const restarted = new Space(state, {
        ...(env as unknown as CoreBindings),
        OPENMELD_WAKE_EVIDENCE_DB: emptyWakeEvidenceDb,
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

  it("settles Core delivery state when Remote confirms the execution is already cancelled", async () => {
    const idempotencyKey = `space-stop-confirmed-${randomUUID()}`;
    const dispatchId = `dispatch-stop-confirmed-${randomUUID()}`;
    const attemptId = `attempt-stop-confirmed-${randomUUID()}`;
    const submissionId = `submission-stop-confirmed-${randomUUID()}`;
    const nativeDeliverySpaceId = "b".repeat(64);
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const outboxSqlExec = vi.fn(() => ({ toArray: () => [] }));
    const closeAgentStream = vi.fn(async () => null);
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
    const bindings = {
      OPENMELD_DB: env.OPENMELD_DB,
      OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      OPENMELD_SPACES: {
        get: () => ({ rpcCloseAgentStream: closeAgentStream }),
        idFromString: (spaceId: string) => spaceId,
      },
    } as unknown as CoreBindings;
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_ledger (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        idempotencyKey,
        dispatchId,
        nativeDeliverySpaceId,
        "signal-stop-confirmed",
        "client-stop-confirmed",
        targetProfileId,
        "dispatching",
        1000,
        1100,
        1,
        attemptId
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_attempts (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        attemptId,
        dispatchId,
        idempotencyKey,
        1,
        "waiting_result",
        `task-stop-confirmed-${randomUUID()}`,
        targetProfileId,
        1000,
        1100
      )
      .run();
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId,
      bindingId: `binding-stop-confirmed-${randomUUID()}`,
      db: env.OPENMELD_DB,
      dispatchId,
      idempotencyKey,
      nowMs: 1000,
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      profileId: targetProfileId,
      spaceId: nativeDeliverySpaceId,
      status: "submitted",
      triggerMessageId: `signal-stop-confirmed-${randomUUID()}`,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: env.OPENMELD_DB,
      idempotencyKey,
      nowMs: 1100,
      submissionId,
      workerRequestId: `request-stop-confirmed-${randomUUID()}`,
    });
    const space = Object.create(Space.prototype) as unknown as {
      bindings: CoreBindings;
      ctx: {
        storage: {
          sql: {
            exec: typeof outboxSqlExec;
          };
        };
      };
      requestRemoteAgentNativeDeliveryStop(input: {
        body: {
          reason?: string;
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
      spaceId: string;
    };
    space.bindings = bindings;
    space.ctx = { storage: { sql: { exec: outboxSqlExec } } };
    space.spaceId = nativeDeliverySpaceId;

    await expect(
      space.requestRemoteAgentNativeDeliveryStop({
        body: {
          reason: "User stopped this Wake.",
          target: {
            by: "source_signal",
            sourceSignalId: "signal-stop-confirmed",
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
      ok: true,
      status: "already_cancelled",
      stopMode: "remote_agent_native_delivery",
    });

    await expect(
      readRemoteAgentNativeDeliveryBySubmissionId({
        db: env.OPENMELD_DB,
        submissionId,
      })
    ).resolves.toMatchObject({
      failureCode: "runtime_coordinator.pre_agent_stop_requested",
      status: "failed",
    });
    expect(closeAgentStream).toHaveBeenCalledWith({
      spaceId: nativeDeliverySpaceId,
      streamId: `stream:${submissionId}`,
      terminal: {
        kind: "stopped",
        noticeText: "The Agent stopped this reply.",
        reasonCode: "runtime_coordinator.pre_agent_stop_requested",
      },
    });
    await expect(
      env.OPENMELD_DB.prepare(
        `
          SELECT
            ledger.status,
            attempt.status AS attempt_status,
            attempt.error_code AS attempt_error_code
          FROM openMeldDaemon_dispatch_ledger AS ledger
          JOIN openMeldDaemon_dispatch_attempts AS attempt
            ON attempt.attempt_id = ledger.latest_attempt_id
          WHERE ledger.idempotency_key = ?
        `
      )
        .bind(idempotencyKey)
        .first()
    ).resolves.toMatchObject({
      attempt_error_code: "runtime_coordinator.pre_agent_stop_requested",
      attempt_status: "superseded",
      status: "cancelled",
    });
    expect(outboxSqlExec).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE openMeldDaemon_outbox"),
      "cancelled",
      dispatchId,
      "pending",
      "queued"
    );
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

  it("marks directly joined profiles live after foreground activity", async () => {
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

    const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
    const space = namespace.get(namespace.idFromString(spaceId));
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
      summary?: { totalCount?: number; liveNowCount?: number };
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
      summary?: { totalCount?: number; humanCount?: number };
      humans?: Array<{ profileId?: string; memberSource?: string }>;
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
      summary?: { totalCount?: number };
      humans?: Array<{ profileId?: string }>;
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

  it("requires confirmation before an ordinary Direct Message becomes a members-only Space", async () => {
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
            code: (error as { code?: unknown }).code,
            status: (error as { status?: unknown }).status,
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
            code: (error as { code?: unknown }).code,
            status: (error as { status?: unknown }).status,
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

  it("keeps an Agent owner read-only until they explicitly join and convert the Direct Message", async () => {
    const organizationId = "org-agent-owner-observer";
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
            code: (error as { code?: unknown }).code,
            status: (error as { status?: unknown }).status,
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

    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/members`,
      undefined,
      creatorProfile
    );
    const listPayload = (await listResponse.json()) as {
      humans?: Array<{ profileId?: string }>;
    };

    expect(listPayload.humans).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: THIRD_HUMAN_PROFILE_ID }),
      ])
    );
  });

  it("rejects member removal from humans outside the creator account", async () => {
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
      "member removal is only allowed for the creator account human"
    );
  });

  it("rejects removing the active creator through POST /members/remove", async () => {
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
    expect(removePayload.code).toBe("space.members.creator_forbidden");
    expect(removePayload.message).toContain("space creator");
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
      meta?: { passwordProtected?: boolean };
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
      agentContext?: { state?: unknown };
      diagnostics?: { signalId?: unknown };
      message?: { actor?: { displayName?: unknown }; signalId?: unknown };
      wakeContext?: { state?: unknown };
    };
    expect(payload.message?.signalId).toBe(signal.id);
    expect(payload.message?.actor?.displayName).toBe("alice");
    expect(payload.agentContext?.state).toBe("not_applicable");
    expect(payload.wakeContext?.state).toBe("not_applicable");
    expect(payload.diagnostics?.signalId).toBe(signal.id);
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
    const deniedPayload = (await denied.json()) as { code?: string };
    expect(deniedPayload.code).toBe("space.forbidden");

    const clearDenied = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/password`,
      { method: "DELETE" },
      otherProfile
    );
    expect(clearDenied.status).toBe(403);
    const clearDeniedPayload = (await clearDenied.json()) as { code?: string };
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
    const createPayload = (await createResponse.json()) as { spaceId?: string };
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
    const otherDeniedPayload = (await otherDenied.json()) as { code?: string };
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
      meta?: { passwordProtected?: boolean };
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

  it("allows human creator to delete a space and makes it unavailable", async () => {
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
    expect(metaResponse.status).toBe(404);
    const payload = (await metaResponse.json()) as {
      code?: string;
      message?: string;
    };
    expect(payload.code).toBe("space.not_found");
    expect(payload.message).toBe("space not found");
  });

  it("rejects delete for non-creator profile", async () => {
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
    expect(payload.message).toBe("only space creator can delete this space");
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
    expect(payload.message).toBe(
      "agent-created spaces require owner human confirmation"
    );
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
    expect(payload.message).toBe(
      "only owner human can delete this agent-created space"
    );
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
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
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
      creator?: { profileId?: string; profile?: string };
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
      creator?: { profileId?: string };
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
      creator?: { profileId?: string };
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
        "Space purpose is system-managed and cannot be changed through metadata updates.",
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
        creator?: { profileId?: string };
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
        creator?: { profileId?: string };
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
      creator?: { profileId?: string };
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
      creator?: { profileId?: string };
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
            creator?: { profileId?: string };
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
        creator?: { profileId?: string };
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
    expect((posted.profile as { profileName?: string }).profileName).toBe(
      "Alice"
    );
    expect((posted.data as { text?: string }).text).toBe("hello");
    expect(typeof posted.ts).toBe("number");

    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals`
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as {
      signals?: Array<{
        type: string;
        data: { text?: string };
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
    const list = (await listResponse.json()) as { signals?: unknown[] };
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
    const list = (await listResponse.json()) as { signals?: unknown[] };
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
    const list = (await listResponse.json()) as { signals?: unknown[] };
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
    const list = (await listResponse.json()) as { signals?: unknown[] };
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
      thread: { threadId: string };
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
    const list = (await listResponse.json()) as { signals?: unknown[] };
    expect(list.signals).toEqual([]);
  });

  it("returns structured JSON error for invalid space ids", async () => {
    const invalidSpaceId = "this-space-id-is-longer-than-thirty-two-characters";

    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${invalidSpaceId}/signals`
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
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
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("invalid_profile_id");
    expect(body.error?.message).toBe("profile id is invalid");
  });

  it("supports catch-up query with afterTs and cursor pagination", async () => {
    const spaceId = await createSpace();
    const messages = ["m1", "m2", "m3", "m4", "m5"];
    const posted: Array<{
      ts: number;
      data: { text?: string };
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
      signals?: Array<{ ts: number; data: { text?: string } }>;
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
      signals?: Array<{ ts: number; data: { text?: string } }>;
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
        data?: { text?: string };
        profile?: { profileId?: string };
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
        data?: { text?: string };
        profile?: { profileId?: string };
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
        signals?: Array<{ data?: { text?: string } }>;
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
      signals?: Array<{ id?: string; data?: { text?: string } }>;
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
      signals?: Array<{ id?: string; data?: { text?: string } }>;
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
        signals?: Array<{ data?: { text?: string } }>;
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
      data: { text?: string };
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
      signals?: Array<{ data: { text?: string } }>;
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
      signals?: Array<{ data: { text?: string } }>;
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
      signals?: Array<{ data: { text?: string } }>;
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
        (data.profile as { profileId?: string }).profileId ===
          aliceRuntimeProfileId &&
        (data.data as { text?: string }).text === "hi Bob"
    );

    alice.send(
      JSON.stringify({ type: "signal.text", data: { text: "hi Bob" } })
    );

    const message = await bobReceives;
    expect(message.type).toBe("signal.text");
    expect((message.profile as { profileId?: string }).profileId).toBe(
      aliceRuntimeProfileId
    );
    expect((message.data as { text?: string }).text).toBe("hi Bob");
    expect(typeof message.ts).toBe("number");

    alice.close(1000, "done");
    bob.close(1000, "done");
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
        history: { signals: unknown[] };
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
      }): Promise<{ status: string; lastSequence: number }>;
      rpcCloseAgentStream(input: {
        spaceId: string;
        streamId: string;
        terminal: { kind: "final_message"; publishedSignalId: string };
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
      }): Promise<SignalEnvelope & { type: "signal.text" }>;
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
        (data.profile as { profileId?: string }).profileId ===
          aliceRuntimeProfileId &&
        (data.data as { text?: string; replyTo?: { signalId?: string } })
          .replyTo?.signalId === TEST_REPLY_TO.signalId &&
        (data.data as { text?: string }).text === "Reply from websocket"
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
      (liveMessage.data as { replyTo?: Record<string, unknown> }).replyTo
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
        (data.data as { text?: string; meta?: { purpose?: string } }).meta
          ?.purpose === "space_membership_join_notice" &&
        (data.data as { text?: string }).text ===
          "Mira added Demo Bot to this space."
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
      (liveMessage.data as { meta?: Record<string, unknown> }).meta
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
        data?: { text?: string; meta?: Record<string, unknown> };
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
        (data.data as { text?: string }).text === text
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
          messageEnvelope?: { mentionTargets?: string[] };
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
          messageEnvelope?: { mentionTargets?: string[] };
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
        (data.data as { text?: string; replyTo?: { signalId?: string } })
          .replyTo?.signalId === TEST_REPLY_TO.signalId &&
        (data.data as { text?: string }).text === "Reply from HTTP"
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
      (liveMessage.data as { replyTo?: Record<string, unknown> }).replyTo
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
        (data.profile as { profileId?: string; owner?: string }).profileId ===
          codexOwnerRuntimeProfileId &&
        (data.profile as { profileId?: string; owner?: string }).owner ===
          "Felix"
    );

    const codex = await openSpaceSocket(spaceId, {
      kind: "agent",
      profileId: "codex-owner",
      profileName: "Codex",
      owner: "Felix",
    });

    const joinEvent = await seesOwnerOnJoin;
    expect((joinEvent.profile as { owner?: string }).owner).toBe("Felix");

    const seesOwnerOnMessage = waitForJsonMessage(
      observer,
      (data) =>
        data.type === "signal.text" &&
        (data.profile as { profileId?: string; owner?: string }).profileId ===
          codexOwnerRuntimeProfileId &&
        (data.profile as { profileId?: string; owner?: string }).owner ===
          "Felix" &&
        (data.data as { text?: string }).text === "owner synced"
    );

    codex.send(
      JSON.stringify({ type: "signal.text", data: { text: "owner synced" } })
    );
    const messageEvent = await seesOwnerOnMessage;
    expect((messageEvent.profile as { owner?: string }).owner).toBe("Felix");

    const listResponse = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/signals?afterTs=0&limit=100`
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      signals?: Array<{
        type?: string;
        profile?: { profileId?: string; owner?: string };
        data?: { text?: string };
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
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined &&
        (data.profile as { agentControllerRef?: string }).agentControllerRef ===
          agentControllerRef
    );
    const otherSeesJoinWithoutContext = waitForJsonMessage(
      otherViewer,
      (data) =>
        data.type === "presence.join" &&
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined &&
        (data.profile as { agentControllerRef?: string }).agentControllerRef ===
          agentControllerRef
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
      (sameOwnerJoin.profile as { agentControllerConversationId?: string })
        .agentControllerConversationId
    ).toBeUndefined();
    expect(
      (sameOwnerJoin.profile as { agentControllerRef?: string })
        .agentControllerRef
    ).toBe(agentControllerRef);
    expect(
      (otherJoin.profile as { agentControllerConversationId?: string })
        .agentControllerConversationId
    ).toBeUndefined();
    expect(
      (otherJoin.profile as { agentControllerRef?: string }).agentControllerRef
    ).toBe(agentControllerRef);

    const sameOwnerSeesTextWithoutContext = waitForJsonMessage(
      sameOwnerViewer,
      (data) =>
        data.type === "signal.text" &&
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.data as { text?: string }).text === "ctx visibility check" &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined &&
        (data.profile as { agentControllerRef?: string }).agentControllerRef ===
          agentControllerRef
    );
    const otherSeesTextWithoutContext = waitForJsonMessage(
      otherViewer,
      (data) =>
        data.type === "signal.text" &&
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.data as { text?: string }).text === "ctx visibility check" &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined &&
        (data.profile as { agentControllerRef?: string }).agentControllerRef ===
          agentControllerRef
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
          data?: { text?: string };
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
        data?: { text?: string };
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
        data?: { text?: string };
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
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined
    );
    const sameOwnerSeesQuitWithoutContext = waitForJsonMessage(
      sameOwnerViewer,
      (data) =>
        data.type === "presence.quit" &&
        (data.profile as { profileId?: string }).profileId ===
          codexContextRuntimeProfileId &&
        (data.profile as { agentControllerConversationId?: string })
          .agentControllerConversationId === undefined &&
        (data.profile as { agentControllerRef?: string }).agentControllerRef ===
          agentControllerRef
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
        (data.profile as { profileId?: string }).profileId ===
          alicePresenceRuntimeProfileId
    );

    alice.close(1000, "done");
    const quitEvent = await bobReceivesQuit;
    expect(quitEvent.type).toBe("presence.quit");
    expect((quitEvent.profile as { profileId?: string }).profileId).toBe(
      alicePresenceRuntimeProfileId
    );

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
      signals?: Array<{ type?: string; profile?: { profileId?: string } }>;
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

    const rpc = SELF as unknown as {
      ping: () => Promise<{ ok: boolean; service: string }>;
      createSpace: (input?: {
        name?: string;
        visibility?: "public" | "private";
        context?: typeof rpcContext;
      }) => Promise<{ spaceId: string }>;
      postSignal: (input: {
        spaceId: string;
        profile: { kind: "agent"; profileId: string; profileName?: string };
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
      db: env.OPENMELD_DB,
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
    const rpc = SELF as unknown as {
      listSignals: (
        input: { context: typeof rpcContext; spaceId: string },
        spaceAddressingVersion?: string
      ) => Promise<{ signals: SignalEnvelope[] }>;
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
    const rpc = SELF as unknown as {
      listSignals: (
        input: { context: typeof rpcContext; spaceId: string },
        spaceAddressingVersion?: string
      ) => Promise<{ signals: SignalEnvelope[] }>;
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
    const rpc = SELF as unknown as {
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
        projection: { spaceId: string; memberProfileId: string } | null;
      }>;
      createCenterAgentContextManifest: (input: {
        context: typeof context;
        spaceId: string;
        source: { kind: "local_agent"; client: string };
      }) => Promise<{
        subject: { conversationId: string };
        entries: unknown[];
      }>;
      listCenterAgentSessions: (input: {
        context: typeof context;
        limit?: number;
        cursor?: string;
      }) => Promise<{
        sessions: Array<{ spaceId: string; memberProfileId: string }>;
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
      agents?: Array<{ profileId?: string; memberSource?: string }>;
      humans?: Array<{ profileId?: string; memberSource?: string }>;
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
      signals?: Array<{
        data?: { meta?: { purpose?: string }; text?: string };
        profile?: { profileId?: string };
        type?: string;
      }>;
    };
    const welcomeSignals =
      signalsPage.signals?.filter(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data?.meta?.purpose === "center_agent_dm_welcome"
      ) ?? [];
    expect(welcomeSignals).toHaveLength(1);
    expect(welcomeSignals[0]).toMatchObject({
      profile: { profileId: agentProfileId },
      type: "signal.text",
    });
    expect(welcomeSignals[0]?.data?.text).toContain(
      "I'm the Center Agent for Test Organization"
    );
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
    await env.OPENMELD_DB.prepare(
      "UPDATE members SET role = 'owner' WHERE organization_id = ? AND user_id = ?"
    )
      .bind(organizationId, ownerUserId)
      .run();
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
        const bootstrapOwnerUserId = input.ownerUserId?.trim();
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
            ownerUserId: bootstrapOwnerUserId,
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
      OPENMELD_DB: env.OPENMELD_DB,
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
      ownerUserId,
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
      agents?: Array<{ profileId?: string }>;
      humans?: Array<{ profileId?: string }>;
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
      signals?: Array<{
        data?: { meta?: { purpose?: string }; text?: string };
        profile?: { profileId?: string };
        type?: string;
      }>;
    };
    const welcomeSignals =
      signalsPage.signals?.filter(
        (signal) =>
          signal.type === "signal.text" &&
          signal.data?.meta?.purpose === "center_agent_dm_welcome"
      ) ?? [];
    expect(welcomeSignals).toHaveLength(1);
    expect(welcomeSignals[0]).toMatchObject({
      profile: { profileId: agentProfileId },
      type: "signal.text",
    });
    expect(welcomeSignals[0]?.data?.text).toContain(
      "I'm the Center Agent for Test Organization"
    );
  });

  it("supports direct DO rpc methods and applies space ref per request", async () => {
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
              centerAgentTaskReferences?: Array<{ taskId: string }>;
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
          centerAgentTaskReferences?: Array<{ taskId: string }>;
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
            centerAgentTaskReferences?: Array<{ taskId: string }>;
          };
        };
      }>;
      rpcGetMeta: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{ spaceId: string; guide?: string }>;
      rpcPatchMeta: (input: {
        spaceId: string;
        guide: string;
        context?: typeof rpcContext;
      }) => Promise<{ spaceId: string; guide?: string }>;
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
      context: rpcContext,
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
      query: { view: "active" },
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
          }>(
            `
              SELECT event_id, operation_id, request_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `
          )
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
          .exec<{ event_id: string }>(
            `
              SELECT event_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `
          )
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
          .exec<{ event_id: string; operation_id: string }>(
            `
              SELECT event_id, operation_id
              FROM space_file_audit_events
              WHERE operation = 'content_write'
              ORDER BY event_id ASC
            `
          )
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
    const failedFolderRequestId = "rpc-space-file-audit-folder-failed";
    await runInDurableObject(stub, async (instance) => {
      await expect(
        instance.rpcCreateSpaceFolder({
          body: {
            clientMutationId: randomUUID(),
            name: "Private Audit Folder",
          },
          spaceAccess: createAuthenticatedSpaceAccessContext({
            requestContext: {
              ...context,
              actorContext: {
                ...context.actorContext,
                requestId: failedFolderRequestId,
              },
            },
            spaceId,
          }),
          spaceId,
        })
      ).rejects.toMatchObject({ code: "space_file.name_conflict" });
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
        }>(
          `
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
          `
        )
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
          error_code: "space_file.name_conflict",
          operation: "folder_create",
          request_id: failedFolderRequestId,
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
      }) => Promise<{ signals: SignalEnvelope[] }>;
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
        ownerUserId,
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
              ownerUserId,
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
            ownerUserId,
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
      }) => Promise<{ spaceId: string; name?: string }>;
      rpcListSignals: (input: {
        spaceId: string;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: { text?: string };
        }>;
      }>;
      rpcListThreads: (input: {
        spaceId: string;
        spaceAccess?: ReturnType<
          typeof createAnonymousViewerSpaceAccessContext
        >;
      }) => Promise<{ threads: unknown[]; previews: unknown[] }>;
      rpcPostSignal: (input: {
        spaceId: string;
        profile: { kind: "human"; profileId: string; profileName: string };
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
        meta: { clientMessageId: string; purpose: string };
        profile: { kind: "human"; profileId: string; profileName: string };
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
            signal: Extract<SignalEnvelope, { type: "signal.text" }>;
            status: "accepted";
          }
        | { status: "rejected" }
      >;
    };
    const clientMessageId = `rpc-idempotent-${randomUUID()}`;
    const profile = {
      kind: "human" as const,
      profileId: rpcContext.actorContext.openMeldProfileId,
      profileName: "Idempotent Author",
    };

    const posted = await stub.rpcPostSignalOnceByClientMessageId({
      authoringPolicy: "system_emitted",
      clientMessageId,
      context: rpcContext,
      meta: { clientMessageId, purpose: "idempotent_rpc_test" },
      profile,
      spaceId,
      text: "idempotent direct rpc signal",
    });
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
        meta: { clientMessageId: string };
        profile: { kind: "human"; profileId: string; profileName: string };
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
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_ledger (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
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
        attemptId
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_dispatch_attempts (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
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
        "Remote Agent turn did not complete."
      )
      .run();
    await upsertRemoteAgentNativeDeliveryRecord({
      attemptId,
      bindingId: `binding-${randomUUID()}`,
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        meta: { clientMessageId: string; purpose: string };
        profile: { kind: "human"; profileId: string; profileName: string };
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
        db: env.OPENMELD_DB,
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
        data?: { text?: string };
      }>;
      rpcListSignals: (input: {
        spaceId: string;
        context?: typeof rpcContext;
      }) => Promise<{
        signals: Array<{
          type: string;
          data?: { text?: string };
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
      text: "Legacy system text should not be a formal update.",
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
      "signal.status",
      "signal.system_notice",
    ]);
    expect(
      payload.signals?.some(
        (signal) =>
          signal.type === "signal.text" &&
          (signal.data as { text?: string }).text === "transient follow-up"
      )
    ).toBe(false);
    expect(
      payload.signals?.some(
        (signal) =>
          signal.type === "signal.text" &&
          (signal.data as { text?: string }).text ===
            "Legacy system text should not be a formal update."
      )
    ).toBe(false);
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

  it("patches the space contract through PATCH /contract", async () => {
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
      allowedActions: ["post_status", "stay_silent"],
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
      allowedActions: ["post_message", "post_status", "stay_silent"],
    });

    const contractRead = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/contract`
    );
    expect(contractRead.status).toBe(200);
    await expect(contractRead.json()).resolves.toMatchObject({
      version: 1,
      updatedBy: "system",
      allowedActions: ["post_message", "post_status", "stay_silent"],
    });
  });

  it("returns a canonical space status summary with the latest formal public update", async () => {
    const centerAgentProfileId = "agt_99999999-9999-4999-8999-999999999999";
    await ensureTestCenterAgentDesignation({
      agentProfileId: centerAgentProfileId,
      agentProfileName: "Center Agent",
      organizationId: DEFAULT_TEST_ORGANIZATION_ID,
      ownerUserId:
        DEFAULT_TEST_AUTH_PROFILE.ownerUserId ?? "owner-test-default",
    });
    const spaceId = await createSpace({
      name: "phase-5b-status",
    });

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
      }
    );

    expect(postResponse.status).toBe(200);
    await postResponse.text();

    const response = await fetchWithOpenMeldAuth(
      `${BASE_URL}/v1/spaces/${spaceId}/status`
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
      allowedActions: ["post_message", "post_status", "stay_silent"],
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

    await env.OPENMELD_DB.prepare(
      "ALTER TABLE openMeldDaemon_dispatch_results RENAME TO openMeldDaemon_dispatch_results_offline"
    ).run();
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
      await env.OPENMELD_DB.prepare(
        "ALTER TABLE openMeldDaemon_dispatch_results_offline RENAME TO openMeldDaemon_dispatch_results"
      ).run();
    }
  });

  it("returns active Wake progress unavailable when the progress store is not readable", async () => {
    const spaceId = await createSpace({
      name: "active-wake-progress-read",
    });

    await env.OPENMELD_DB.prepare(
      "ALTER TABLE openMeldDaemon_runtime_coordinator_executions RENAME TO openMeldDaemon_runtime_coordinator_executions_offline"
    ).run();
    try {
      const response = await fetchWithOpenMeldAuth(
        `${BASE_URL}/v1/spaces/${spaceId}/active-wake-progress`
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "space.wake_progress.store_unavailable",
      });
    } finally {
      await env.OPENMELD_DB.prepare(
        "ALTER TABLE openMeldDaemon_runtime_coordinator_executions_offline RENAME TO openMeldDaemon_runtime_coordinator_executions"
      ).run();
    }
  });

  describe("space index projection degradation", () => {
    const FOURTH_HUMAN_PROFILE_ID = "44444444-4444-4444-8444-444444444444";

    async function withBrokenSpaceIndexProjection(
      run: () => Promise<void>
    ): Promise<void> {
      await env.OPENMELD_DB.prepare(
        "ALTER TABLE space_index_spaces RENAME TO space_index_spaces_offline"
      ).run();
      try {
        await run();
      } finally {
        await env.OPENMELD_DB.prepare(
          "ALTER TABLE space_index_spaces_offline RENAME TO space_index_spaces"
        ).run();
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
      members: Array<{ profileId: string; profileName: string }>,
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
          humans?: Array<{ profileId?: string }>;
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

      const indexedMembers = await env.OPENMELD_DB.prepare(
        "SELECT profile_id FROM space_index_memberships WHERE space_id = ?1"
      )
        .bind(spaceId)
        .all<{ profile_id: string }>();
      const indexedProfileIds = (indexedMembers.results ?? []).map(
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
        ownerUserId: "owner-index-degraded-2",
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
          meta?: { name?: string };
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
): value is SignalEnvelope & { type: "signal.text" } {
  return value?.type === "signal.text";
}
it("enforces message pin ownership through the authorized Space RPC", async () => {
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
