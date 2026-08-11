import { MAX_TEXT_LENGTH, normalizeProfileId } from "@openmeld/protocol";
import {
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
  deriveCenterAgentDirectMessageSpaceProjection,
  MAX_SPACE_NAME_LENGTH,
  organizationInformationProtectionPolicyResponseSchema,
  postResolvedSpaceMembersBodySchema,
  spaceAccessModeSchema,
  spaceOrganizationVisibilitySchema,
  updateCenterAgentOrganizationMemoryPolicyBodySchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
} from "@openmeld/schemas";
import type {
  SpaceAccessMode,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import { readCenterAgentDesignationRecord } from "../center-agent/center-agent-repository";
import type { HonoBindings } from "../lib/bindings";
import { identityDb, localStateDb } from "../lib/bindings";
import {
  rpcReadCenterAgentOrganizationMemoryPolicy,
  rpcReadOrganizationInformationProtectionPolicy,
  rpcSetCenterAgentOrganizationMemoryPolicy,
  rpcSetOrganizationInformationProtectionPolicy,
  rpcWipeCurrentMemberCenterAgentMemory,
} from "../rpc/methods";
import {
  isHexSpaceId,
  resolveNewSpaceId,
  resolveSpaceStub,
} from "../rpc/space-ref";
import {
  applyResolvedOpenMeldContextHeaders,
  toSpaceCreator,
} from "../shared/context/openmeld-context";
import { CORE_LOG_EVENTS } from "../shared/observability/log-events";
import type { Space } from "../space/transport/do/space";
import { readCenterAgentDirectMessageProjectionCandidateBySpaceId } from "../space-index/space-index-repository";

type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

type CreateSpaceBody = {
  name?: string;
  purpose?: string;
  guide?: string;
  visibility: SpaceOrganizationVisibility;
  accessMode?: SpaceAccessMode;
  password?: string;
};

type CreateSpaceBodyObject = {
  name?: unknown;
  purpose?: unknown;
  guide?: unknown;
  visibility?: unknown;
  accessMode?: unknown;
  password?: unknown;
};

type SpaceMetaInitializationBody = {
  name?: string;
  purpose?: string;
  creator?: {
    profileId: string;
    profileName?: string;
    kind?: "human" | "agent" | "system";
    profile?: string;
  };
  organizationId: string;
  visibility: SpaceOrganizationVisibility;
  guide?: string;
  accessMode?: SpaceAccessMode;
};

const CREATE_SPACE_ALLOWED_FIELDS = new Set([
  "name",
  "purpose",
  "guide",
  "visibility",
  "accessMode",
  "password",
]);
export function registerSpaceRoutes(app: Hono<HonoBindings>) {
  app.post("/v1/spaces", (c) => handleCreateSpace(c));
  app.post("/v1/organizations/current/center-agent-memory/wipe-self", (c) =>
    handleWipeCurrentMemberCenterAgentMemory(c)
  );
  app.get(
    "/v1/organizations/current/center-agent-memory/organization-policy",
    (c) => handleReadCurrentOrganizationCenterAgentMemoryPolicy(c)
  );
  app.put(
    "/v1/organizations/current/center-agent-memory/organization-policy",
    (c) => handleSetCurrentOrganizationCenterAgentMemoryPolicy(c)
  );
  app.get("/v1/organizations/current/information-protection", (c) =>
    handleReadCurrentOrganizationInformationProtectionPolicy(c)
  );
  app.put("/v1/organizations/current/information-protection", (c) =>
    handleSetCurrentOrganizationInformationProtectionPolicy(c)
  );

  app.delete("/v1/spaces/:spaceId", (c) => forwardToSpace(c, "/space"));
  app.get("/v1/spaces/:spaceId/stream", (c) => forwardToSpace(c, "/stream"));
  app.get("/v1/spaces/:spaceId/signals", (c) => forwardToSpace(c, "/signals"));
  app.post("/v1/spaces/:spaceId/signals", (c) => forwardToSpace(c, "/signals"));
  app.get("/v1/spaces/:spaceId/message-details", (c) =>
    forwardToSpace(c, "/message-details")
  );
  app.post("/v1/spaces/:spaceId/threads", (c) => forwardToSpace(c, "/threads"));
  app.get("/v1/spaces/:spaceId/threads", (c) => forwardToSpace(c, "/threads"));
  app.get("/v1/spaces/:spaceId/threads/:threadId", (c) =>
    forwardThreadToSpace(c)
  );
  app.get("/v1/spaces/:spaceId/threads/:threadId/events", (c) =>
    forwardThreadToSpace(c)
  );
  app.get("/v1/spaces/:spaceId/threads/:threadId/signals", (c) =>
    forwardThreadToSpace(c)
  );
  app.post("/v1/spaces/:spaceId/threads/:threadId/signals", (c) =>
    forwardThreadToSpace(c)
  );
  app.get("/v1/spaces/:spaceId/updates", (c) => forwardToSpace(c, "/updates"));
  app.get("/v1/spaces/:spaceId/members", (c) => forwardToSpace(c, "/members"));
  app.post("/v1/spaces/:spaceId/members", (c) => forwardPostMembersToSpace(c));
  app.post("/v1/spaces/:spaceId/members/remove", (c) =>
    forwardToSpace(c, "/members/remove")
  );
  app.get("/v1/spaces/:spaceId/meta", (c) => forwardToSpace(c, "/meta"));
  app.patch("/v1/spaces/:spaceId/meta", (c) => forwardToSpace(c, "/meta"));
  app.get("/v1/spaces/:spaceId/contract", (c) =>
    forwardToSpace(c, "/contract")
  );
  app.patch("/v1/spaces/:spaceId/contract", (c) =>
    forwardToSpace(c, "/contract")
  );
  app.put("/v1/spaces/:spaceId/contract", (c) =>
    forwardToSpace(c, "/contract")
  );
  app.get("/v1/spaces/:spaceId/status", (c) => forwardToSpace(c, "/status"));
  app.get("/v1/spaces/:spaceId/result", (c) => forwardToSpace(c, "/result"));
  app.get("/v1/spaces/:spaceId/active-wake-progress", (c) =>
    forwardToSpace(c, "/active-wake-progress")
  );
  app.post("/v1/spaces/:spaceId/wake-stop", (c) =>
    forwardToSpace(c, "/wake-stop")
  );
  app.put("/v1/spaces/:spaceId/password", (c) =>
    forwardToSpace(c, "/password")
  );
  app.delete("/v1/spaces/:spaceId/password", (c) =>
    forwardToSpace(c, "/password")
  );
  app.put("/v1/spaces/:spaceId/access-mode", (c) =>
    forwardToSpace(c, "/access-mode")
  );
  app.get("/v1/spaces/:spaceId/cursors/:profileId", (c) =>
    forwardCursorToSpace(c)
  );
  app.patch("/v1/spaces/:spaceId/cursors/:profileId", (c) =>
    forwardCursorToSpace(c)
  );
}

async function handleReadCurrentOrganizationCenterAgentMemoryPolicy(
  c: Context<HonoBindings>
): Promise<Response> {
  try {
    const response = await rpcReadCenterAgentOrganizationMemoryPolicy(c.env, {
      context: c.var.openMeldRequestContext,
    });
    return c.json(
      centerAgentOrganizationMemoryPolicyResponseSchema.parse(response)
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function handleSetCurrentOrganizationCenterAgentMemoryPolicy(
  c: Context<HonoBindings>
): Promise<Response> {
  const json = await c.req.json().catch(() => null);
  const body =
    updateCenterAgentOrganizationMemoryPolicyBodySchema.safeParse(json);
  if (!body.success) {
    return c.json(
      {
        error: {
          code: "invalid_payload",
          message:
            body.error.issues[0]?.message ??
            "Invalid Center Agent organization memory policy payload.",
        },
      },
      400
    );
  }
  try {
    const response = await rpcSetCenterAgentOrganizationMemoryPolicy(c.env, {
      context: c.var.openMeldRequestContext,
      organizationMemoryOptIn: body.data.organizationMemoryOptIn,
    });
    return c.json(
      centerAgentOrganizationMemoryPolicyResponseSchema.parse(response)
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function handleReadCurrentOrganizationInformationProtectionPolicy(
  c: Context<HonoBindings>
): Promise<Response> {
  try {
    const response = await rpcReadOrganizationInformationProtectionPolicy(
      c.env,
      { context: c.var.openMeldRequestContext }
    );
    return c.json(
      organizationInformationProtectionPolicyResponseSchema.parse(response)
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function handleSetCurrentOrganizationInformationProtectionPolicy(
  c: Context<HonoBindings>
): Promise<Response> {
  const json = await c.req.json().catch(() => null);
  const body =
    updateOrganizationInformationProtectionPolicyBodySchema.safeParse(json);
  if (!body.success) {
    return c.json(
      {
        error: {
          code: "invalid_payload",
          message:
            body.error.issues[0]?.message ??
            "Invalid Organization information protection policy payload.",
        },
      },
      400
    );
  }
  try {
    const response = await rpcSetOrganizationInformationProtectionPolicy(
      c.env,
      {
        context: c.var.openMeldRequestContext,
        protectedInformation: body.data.protectedInformation,
      }
    );
    return c.json(
      organizationInformationProtectionPolicyResponseSchema.parse(response)
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

function mapRpcHttpError(c: Context<HonoBindings>, error: unknown): Response {
  const structured = (error as { cause?: unknown }).cause as
    | { code?: unknown; message?: unknown; status?: unknown }
    | undefined;
  const status =
    typeof structured?.status === "number" ? structured.status : 500;
  const message =
    typeof structured?.message === "string"
      ? structured.message
      : "Request failed.";
  let code = status >= 500 ? "internal_error" : "request_failed";
  if (typeof structured?.code === "string") {
    code = structured.code;
  }
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as ErrorStatusCode
  );
}

async function handleWipeCurrentMemberCenterAgentMemory(
  c: Context<HonoBindings>
): Promise<Response> {
  try {
    const response = await rpcWipeCurrentMemberCenterAgentMemory(c.env, {
      context: c.var.openMeldRequestContext,
    });
    return c.json(centerAgentWipeMemberMemoryResponseSchema.parse(response));
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

function forwardThreadToSpace(c: Context<HonoBindings>): Promise<Response> {
  const threadId = c.req.param("threadId");
  const pathname = new URL(c.req.url).pathname;
  let suffix = "";
  if (pathname.endsWith("/events")) {
    suffix = "/events";
  } else if (pathname.endsWith("/signals")) {
    suffix = "/signals";
  }
  return forwardToSpace(c, `/threads/${encodeURIComponent(threadId)}${suffix}`);
}

async function handleCreateSpace(c: Context<HonoBindings>): Promise<Response> {
  const bodyResult = await readCreateSpaceBodySafely(c);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }
  const body = bodyResult.body;

  const id = resolveSpaceId(c);
  const spaceId = id.toString();
  const stub = c.env.OPENMELD_SPACES.get(id);
  const creator = toSpaceCreator(c.var.openMeldRequestContext);
  const organizationId = c.var.openMeldRequestContext.activeOrganizationId;
  if (!organizationId) {
    return c.json(
      {
        error: {
          code: "organization.context_required",
          message: "Active organization context is required.",
        },
      },
      403
    );
  }
  const hasPassword = Object.hasOwn(body, "password");
  const metaInitializationBody = buildCreateSpaceMetaInitializationBody(
    body,
    creator,
    organizationId
  );

  const response = hasPassword
    ? await initializeSpaceMetaWithPasswordAtomic(
        stub,
        spaceId,
        {
          ...metaInitializationBody,
          password: body.password ?? "",
        },
        c.var.openMeldRequestContext
      )
    : await initializeSpaceMeta(
        stub,
        spaceId,
        metaInitializationBody,
        c.var.openMeldRequestContext,
        {
          initializeIfAbsent: true,
        }
      );
  if (!response.ok) {
    if (hasPassword) {
      return await mapPasswordUpsertError(c, response, {
        fallbackMessage: "Failed to create password-protected space",
      });
    }
    const raw = await response.text().catch(() => "");
    const statusCode = resolveSpaceMetaInitializationStatusCode(
      response.status
    );
    return c.json(
      {
        error: {
          code: "space_meta_initialization_failed",
          message: raw || "Failed to initialize space metadata",
        },
      },
      statusCode
    );
  }

  const initializedMeta = await readSpaceMetaResponseJson(response, spaceId);
  if (!initializedMeta.ok) {
    return c.json(
      {
        error: {
          code: "space_meta_invalid_json",
          message: "Invalid JSON from Space",
          details: initializedMeta.details,
        },
      },
      502
    );
  }
  return c.json({ spaceId, meta: initializedMeta.meta });
}

async function readCreateSpaceBodySafely(
  c: Context<HonoBindings>
): Promise<
  { ok: true; body: CreateSpaceBody } | { ok: false; response: Response }
> {
  try {
    return {
      ok: true,
      body: await readCreateSpaceBody(c),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid create payload";
    return {
      ok: false,
      response: c.json(
        {
          error: {
            code: "invalid_create_payload",
            message,
          },
        },
        400
      ),
    };
  }
}

async function mapPasswordUpsertError(
  c: Context<HonoBindings>,
  response: Response,
  options?: { fallbackMessage?: string }
): Promise<Response> {
  const statusCode = resolveSpaceMetaInitializationStatusCode(response.status);
  const raw = (await response.text().catch(() => "")).trim();
  const parsed = parsePasswordUpsertErrorPayload(raw);
  if (parsed) {
    return c.json(
      {
        ok: false,
        ...(parsed.code ? { code: parsed.code } : {}),
        message: parsed.message,
        ...(parsed.requestId ? { requestId: parsed.requestId } : {}),
      },
      statusCode
    );
  }

  return c.json(
    {
      ok: false,
      code: "upstream_error",
      message:
        raw || options?.fallbackMessage || "Failed to set space password",
    },
    statusCode
  );
}

function resolveSpaceMetaInitializationStatusCode(
  status: number
): ErrorStatusCode {
  if (isErrorStatusCode(status)) {
    return status;
  }

  return status >= 500 ? 500 : 400;
}

function isErrorStatusCode(status: number): status is ErrorStatusCode {
  return status >= 400 && status < 600;
}

function resolveSpaceId(c: Context<HonoBindings>): DurableObjectId {
  return resolveNewSpaceId(c.env.OPENMELD_SPACES);
}

function initializeSpaceMeta(
  stub: DurableObjectStub<Space>,
  spaceId: string,
  body: SpaceMetaInitializationBody,
  context: Context<HonoBindings>["var"]["openMeldRequestContext"],
  options?: { initializeIfAbsent?: boolean }
): Promise<Response> {
  const headers = applyResolvedOpenMeldContextHeaders(
    new Headers({
      "content-type": "application/json",
    }),
    { context }
  );

  return stub.fetch(
    new Request(
      buildSpaceMetaUrl(spaceId, {
        initializeIfAbsent: options?.initializeIfAbsent === true,
      }),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(serializeSpaceMetaInitializationBody(body)),
      }
    )
  );
}

function initializeSpaceMetaWithPasswordAtomic(
  stub: DurableObjectStub<Space>,
  spaceId: string,
  body: SpaceMetaInitializationBody & {
    password: string;
  },
  context: Context<HonoBindings>["var"]["openMeldRequestContext"]
): Promise<Response> {
  const headers = applyResolvedOpenMeldContextHeaders(
    new Headers({
      "content-type": "application/json",
    }),
    { context }
  );

  return stub.fetch(
    new Request(buildSpaceMetaInitWithPasswordUrl(spaceId), {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        ...serializeSpaceMetaInitializationBody(body),
        password: body.password,
      }),
    })
  );
}

function buildCreateSpaceMetaInitializationBody(
  body: CreateSpaceBody,
  creator: ReturnType<typeof toSpaceCreator>,
  organizationId: string
): SpaceMetaInitializationBody {
  return {
    organizationId,
    visibility: body.visibility,
    ...(body.name ? { name: body.name } : {}),
    ...(typeof body.purpose === "string" ? { purpose: body.purpose } : {}),
    ...(creator ? { creator } : {}),
    ...(typeof body.guide === "string" ? { guide: body.guide } : {}),
    ...(body.accessMode ? { accessMode: body.accessMode } : {}),
  };
}

function serializeSpaceMetaInitializationBody(
  body: SpaceMetaInitializationBody
): Record<string, unknown> {
  return {
    organizationId: body.organizationId,
    visibility: body.visibility,
    ...(body.name ? { name: body.name } : {}),
    ...(typeof body.purpose === "string" ? { purpose: body.purpose } : {}),
    ...(body.creator ? { creator: body.creator } : {}),
    ...(typeof body.guide === "string" ? { guide: body.guide } : {}),
    ...(body.accessMode ? { accessMode: body.accessMode } : {}),
  };
}

function buildSpaceMetaUrl(
  spaceId: string,
  options?: { initializeIfAbsent?: boolean }
): string {
  const requestUrl = new URL(
    options?.initializeIfAbsent
      ? "https://openmeld-core.internal/meta/init"
      : "https://openmeld-core.internal/meta"
  );
  requestUrl.searchParams.set("space", spaceId);
  return requestUrl.toString();
}

function buildSpaceMetaInitWithPasswordUrl(spaceId: string): string {
  const requestUrl = new URL(
    "https://openmeld-core.internal/meta/init-with-password"
  );
  requestUrl.searchParams.set("space", spaceId);
  return requestUrl.toString();
}

async function readSpaceMetaResponseJson(
  response: Response,
  spaceId: string
): Promise<{ ok: true; meta: unknown } | { ok: false; details: string }> {
  try {
    const meta = await response.json();
    return { ok: true, meta };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[core] space_meta_invalid_json", {
      event: CORE_LOG_EVENTS.spaceMetaInvalidJson,
      context: "create_space_meta_response",
      spaceId,
      details,
    });
    return { ok: false, details };
  }
}

async function forwardPostMembersToSpace(
  c: Context<HonoBindings>
): Promise<Response> {
  const blockedResponse =
    await rejectAdditionalCenterAgentDirectMessageMembers(c);
  if (blockedResponse) {
    return blockedResponse;
  }
  return await forwardToSpace(c, "/members");
}

async function rejectAdditionalCenterAgentDirectMessageMembers(
  c: Context<HonoBindings>
): Promise<Response | null> {
  const spaceId = c.req.param("spaceId");
  if (!isHexSpaceId(spaceId)) {
    return null;
  }

  const spaceIndexDb = localStateDb(c.env);
  if (!spaceIndexDb) {
    return c.json(
      {
        error: {
          code: "space_index.store_unavailable",
          message: "Space Index store is unavailable.",
        },
      },
      503
    );
  }

  const candidate = await readCenterAgentDirectMessageCandidateForMemberGuard({
    db: spaceIndexDb,
    spaceId,
  });
  if (!candidate) {
    return null;
  }

  const centerAgentDb = identityDb(c.env);
  if (!centerAgentDb) {
    return c.json(
      {
        error: {
          code: "center_agent.designation_store_unavailable",
          message: "Center Agent store is unavailable.",
        },
      },
      503
    );
  }
  const designation = await readCenterAgentDesignationForMemberGuard({
    db: centerAgentDb,
    organizationId: candidate.organizationId,
  });
  if (!designation) {
    return null;
  }

  const projection = deriveCenterAgentDirectMessageSpaceProjection({
    centerAgentProfileId: designation.agentProfileId,
    directMessagePairKey: candidate.directMessagePairKey,
    organizationId: candidate.organizationId,
    spaceId: candidate.spaceId,
    spacePurpose: candidate.spacePurpose,
  });
  if (!projection) {
    return null;
  }

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  const parsed = postResolvedSpaceMembersBodySchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }

  const allowedProfileIds = new Set([
    projection.memberProfileId,
    projection.centerAgentProfileId,
  ]);
  const hasAdditionalMember = parsed.data.members.some((member) => {
    const normalizedProfileId = normalizeProfileId(member.profileId);
    return (
      normalizedProfileId === null ||
      !allowedProfileIds.has(normalizedProfileId)
    );
  });
  if (!hasAdditionalMember) {
    return null;
  }

  await c.req.raw.text().catch(() => undefined);
  return c.json(
    {
      error: {
        code: "space.forbidden",
        message: "Center Agent Direct Messages cannot add additional members.",
      },
    },
    403
  );
}

async function readCenterAgentDirectMessageCandidateForMemberGuard(input: {
  db: D1Database;
  spaceId: string;
}) {
  try {
    return await readCenterAgentDirectMessageProjectionCandidateBySpaceId(
      input
    );
  } catch (error) {
    console.warn("[core.center_agent_dm_member_guard_projection_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
      spaceId: input.spaceId,
    });
    return null;
  }
}

async function readCenterAgentDesignationForMemberGuard(input: {
  db: D1Database;
  organizationId: string;
}) {
  try {
    return await readCenterAgentDesignationRecord(input);
  } catch (error) {
    console.warn(
      "[core.center_agent_dm_member_guard_designation_unavailable]",
      {
        error: error instanceof Error ? error.message : String(error),
        organizationId: input.organizationId,
      }
    );
    return null;
  }
}

async function forwardToSpace(c: Context<HonoBindings>, path: string) {
  const spaceId = c.req.param("spaceId");
  if (!isHexSpaceId(spaceId)) {
    return c.json(
      {
        error: {
          code: "invalid_space_id",
          message: "invalid space id: expected 64-char hex id",
        },
      },
      404
    );
  }

  const stub = resolveSpaceStub(c.env.OPENMELD_SPACES, spaceId);
  if (!stub) {
    return c.json(
      {
        error: {
          code: "space.not_found",
          message: "space not found",
        },
      },
      404
    );
  }

  const url = new URL(c.req.url);
  url.pathname = path;
  url.searchParams.set("space", spaceId);

  const request = new Request(url.toString(), c.req.raw);
  applyResolvedOpenMeldContextHeaders(request.headers, {
    context: c.var.openMeldRequestContext,
    ...(c.var.spacePassword === undefined
      ? {}
      : { spacePassword: c.var.spacePassword }),
  });
  const response = await stub.fetch(request);
  if (path === "/stream") {
    return response;
  }

  // DO fetch responses can carry immutable headers; clone to allow downstream
  // middleware (e.g., secure headers) to append response headers safely.
  return new Response(response.body, response);
}

function forwardCursorToSpace(
  c: Context<HonoBindings>
): Response | Promise<Response> {
  const profileIdRaw = c.req.param("profileId");
  const profileId = normalizeProfileId(profileIdRaw);
  if (!profileId) {
    return c.json(
      {
        error: {
          code: "invalid_profile_id",
          message: "profile id is invalid",
        },
      },
      400
    );
  }

  if (
    profileId !== c.var.openMeldRequestContext.actorContext.openMeldProfileId
  ) {
    return c.json(
      {
        error: {
          code: "profile_not_found",
          message: "profile not found",
        },
      },
      404
    );
  }

  return forwardToSpace(c, `/cursors/${encodeURIComponent(profileId)}`);
}

async function readCreateSpaceBody(
  c: Context<HonoBindings>
): Promise<CreateSpaceBody> {
  const rawBody = (await c.req.text()).trim();
  if (rawBody.length === 0) {
    throw new Error("Invalid create payload: expected object");
  }

  const obj = parseCreateSpaceBodyObject(rawBody);

  const nameRaw = typeof obj.name === "string" ? obj.name.trim() : "";
  if (nameRaw.length > MAX_SPACE_NAME_LENGTH) {
    throw new Error("Invalid name: too long");
  }
  const name = nameRaw.length > 0 ? nameRaw : undefined;
  const purpose = readSpacePurpose(obj.purpose);
  if (obj.purpose !== undefined && purpose === null) {
    throw new Error("Invalid purpose");
  }

  const guide = readGuide(obj.guide);
  if (obj.guide !== undefined && guide === null) {
    throw new Error("Invalid guide");
  }

  const visibility = readCreateSpaceVisibility(obj);
  const password = readCreateSpacePassword(obj);
  const accessMode = readCreateSpaceAccessMode(obj);
  validateCreateSpaceAccessModePasswordContract({ accessMode, password });

  return {
    ...(name ? { name } : {}),
    ...(purpose !== undefined && purpose !== null ? { purpose } : {}),
    ...(guide !== undefined && guide !== null ? { guide } : {}),
    visibility,
    ...(accessMode === undefined ? {} : { accessMode }),
    ...(password === undefined ? {} : { password }),
  };
}

function parseCreateSpaceBodyObject(rawBody: string): CreateSpaceBodyObject {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw new Error("Invalid create payload: malformed JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid create payload: expected object");
  }

  const obj = body as CreateSpaceBodyObject;
  const unknownFields = Object.keys(obj).filter(
    (key) => !CREATE_SPACE_ALLOWED_FIELDS.has(key)
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `Invalid create payload: unknown field "${unknownFields[0]}"`
    );
  }

  return obj;
}

function readCreateSpacePassword(
  body: CreateSpaceBodyObject
): string | undefined {
  if (!Object.hasOwn(body, "password")) {
    return undefined;
  }
  if (typeof body.password !== "string") {
    throw new Error("Invalid password");
  }
  return body.password;
}

function readCreateSpaceAccessMode(
  body: CreateSpaceBodyObject
): SpaceAccessMode | undefined {
  if (!Object.hasOwn(body, "accessMode")) {
    return undefined;
  }

  const parsed = spaceAccessModeSchema.safeParse(body.accessMode);
  if (!parsed.success) {
    throw new Error("Invalid accessMode");
  }
  return parsed.data;
}

function readCreateSpaceVisibility(
  body: CreateSpaceBodyObject
): SpaceOrganizationVisibility {
  if (!Object.hasOwn(body, "visibility")) {
    throw new Error("Visibility required");
  }

  const parsed = spaceOrganizationVisibilitySchema.safeParse(body.visibility);
  if (!parsed.success) {
    throw new Error("Invalid visibility");
  }
  return parsed.data;
}

function validateCreateSpaceAccessModePasswordContract(input: {
  accessMode: SpaceAccessMode | undefined;
  password: string | undefined;
}): void {
  const accessModeUsesPassword =
    input.accessMode === "public_view_join_password" ||
    input.accessMode === "protected";
  if (
    input.accessMode !== undefined &&
    !accessModeUsesPassword &&
    input.password !== undefined
  ) {
    throw new Error("Password cannot be set for this access");
  }

  if (
    input.accessMode !== undefined &&
    accessModeUsesPassword &&
    input.password === undefined
  ) {
    throw new Error("Password required for this access");
  }
}

function readSpacePurpose(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const purpose = value.trim();
  if (purpose.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return purpose;
}

function readGuide(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const guide = value.trim();
  if (guide.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return guide;
}

function parseJsonObject(value: string): unknown | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parsePasswordUpsertErrorPayload(raw: string): {
  code?: string;
  message: string;
  requestId?: string;
} | null {
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const payload = parsed as {
    code?: unknown;
    error?: {
      code?: unknown;
      message?: unknown;
    };
    message?: unknown;
    requestId?: unknown;
  };
  const nestedError =
    payload.error && typeof payload.error === "object" ? payload.error : null;
  const codeValue =
    (typeof nestedError?.code === "string" ? nestedError.code : null) ??
    (typeof payload.code === "string" ? payload.code : null) ??
    undefined;
  const messageValue =
    (typeof nestedError?.message === "string" ? nestedError.message : null) ??
    (typeof payload.message === "string" ? payload.message : null) ??
    "Failed to set space password";
  const requestIdValue =
    (typeof payload.requestId === "string" ? payload.requestId : null) ??
    undefined;

  return {
    ...(codeValue ? { code: codeValue } : {}),
    message: messageValue,
    ...(requestIdValue ? { requestId: requestIdValue } : {}),
  };
}
