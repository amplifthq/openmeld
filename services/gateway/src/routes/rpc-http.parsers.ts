import type { SignalText } from "@openmeld/protocol";
import { normalizeProfileId } from "@openmeld/protocol";
import {
  addCenterAgentToSpaceBodySchema,
  addOrganizationDirectoryProfilesToSpaceBodySchema,
  createSpaceBodySchema,
  listProfileSpaceHistoryQuerySchema,
  normalizeSpaceCursorPatch,
  patchProfileSpaceHistoryStatusBodySchema,
  patchSpaceMetaBodySchema,
  postNormalMessageBodySchema,
  postSpaceMembersBodySchema,
  querySpaceDeletionTombstonesBodySchema,
  removeSpaceMembersBodySchema,
  setSpaceAccessModeBodySchema,
  spaceRouteParamsSchema,
  upsertProfileSpaceHistoryBodySchema,
  upsertSpaceDeletionTombstoneBodySchema,
  upsertSpacePasswordBodySchema,
} from "@openmeld/schemas";
import type {
  AddCenterAgentToSpaceBody,
  AddOrganizationDirectoryProfilesToSpaceBody,
  CreateSpaceBody,
  ListProfileSpaceHistoryQuery,
  PatchProfileSpaceHistoryStatusBody,
  PatchSpaceCursorBody,
  PatchSpaceMetaBody,
  PostSpaceMembersBody,
  QuerySpaceDeletionTombstonesBody,
  RemoveSpaceMembersBody,
  SetSpaceAccessModeBody,
  SpaceRouteParams,
  UpsertProfileSpaceHistoryBody,
  UpsertSpaceDeletionTombstoneBody,
  UpsertSpacePasswordBody,
} from "@openmeld/schemas/types";

type ParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      message: string;
      code?:
        | "invalid_payload"
        | "invalid_password_payload"
        | "space.password_too_short";
    };

export type JsonRequestBodyResult =
  | {
      ok: true;
      value: unknown;
      rawBody: string;
    }
  | {
      ok: false;
      message: "Invalid JSON" | "Payload too large";
      rawBody: string;
    };

const CREATE_SPACE_ALLOWED_FIELDS = new Set([
  "name",
  "purpose",
  "guide",
  "visibility",
  "accessMode",
  "password",
]);
const PATCH_SPACE_META_ALLOWED_FIELDS = new Set([
  "name",
  "purpose",
  "guide",
  "visibility",
]);

export async function readJsonRequestBody(
  request: Request,
  options?: { maxBytes?: number }
): Promise<JsonRequestBodyResult> {
  let rawBody = "";

  const contentLength = Number(request.headers.get("content-length"));
  if (
    options?.maxBytes !== undefined &&
    Number.isFinite(contentLength) &&
    contentLength > options.maxBytes
  ) {
    return { ok: false, message: "Payload too large", rawBody };
  }

  try {
    const body = await readRequestBodyText(request, options?.maxBytes);
    if (!body.ok) {
      return { ok: false, message: "Payload too large", rawBody: "" };
    }
    rawBody = body.value;
  } catch {
    return {
      ok: false,
      message: "Invalid JSON",
      rawBody,
    };
  }

  const trimmedBody = rawBody.trim();
  if (trimmedBody.length === 0) {
    return {
      ok: true,
      value: undefined,
      rawBody,
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmedBody),
      rawBody,
    };
  } catch {
    return {
      ok: false,
      message: "Invalid JSON",
      rawBody,
    };
  }
}

async function readRequestBodyText(
  request: Request,
  maxBytes: number | undefined
): Promise<{ ok: true; value: string } | { ok: false }> {
  if (maxBytes === undefined) {
    return { ok: true, value: await request.text() };
  }
  if (!request.body) {
    return { ok: true, value: "" };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let value = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        return { ok: true, value: value + decoder.decode() };
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        return { ok: false };
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function normalizeProfileIdParam(value: string): string | null {
  return normalizeProfileId(value);
}

export function parseSpaceRouteParams(
  spaceId: unknown
): ParseResult<SpaceRouteParams> {
  const parsed = spaceRouteParamsSchema.safeParse({ spaceId });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid spaceId",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parsePostSignalBody(body: unknown): ParseResult<{
  text: string;
  attachments?: SignalText["data"]["attachments"];
  files?: SignalText["data"]["files"];
  messageEnvelope?: SignalText["data"]["messageEnvelope"];
  meta?: SignalText["data"]["meta"];
  replyTo?: SignalText["data"]["replyTo"];
}> {
  const parsed = postNormalMessageBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid signal payload",
    };
  }

  return {
    ok: true,
    value: {
      text: parsed.data.text,
      ...(parsed.data.attachments
        ? { attachments: parsed.data.attachments }
        : {}),
      ...(parsed.data.files ? { files: parsed.data.files } : {}),
      ...(parsed.data.messageEnvelope
        ? { messageEnvelope: parsed.data.messageEnvelope }
        : {}),
      ...(parsed.data.meta ? { meta: parsed.data.meta } : {}),
      ...(parsed.data.replyTo ? { replyTo: parsed.data.replyTo } : {}),
    },
  };
}

export function parsePostSpaceMembersBody(
  body: unknown
): ParseResult<PostSpaceMembersBody> {
  const parsed = postSpaceMembersBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid members payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseAddCenterAgentToSpaceBody(
  body: unknown
): ParseResult<AddCenterAgentToSpaceBody> {
  const parsed = addCenterAgentToSpaceBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Invalid Center Agent Space member payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseAddOrganizationDirectoryProfilesToSpaceBody(
  body: unknown
): ParseResult<AddOrganizationDirectoryProfilesToSpaceBody> {
  const parsed =
    addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Invalid Organization Directory Space member payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseRemoveSpaceMembersBody(
  body: unknown
): ParseResult<RemoveSpaceMembersBody> {
  const parsed = removeSpaceMembersBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid members payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseCreateSpaceBody(
  body: unknown
): ParseResult<CreateSpaceBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON" };
  }

  const bodyCandidate = body as Record<string, unknown>;
  const unknownField = findFirstUnknownField(
    bodyCandidate,
    CREATE_SPACE_ALLOWED_FIELDS
  );
  if (unknownField) {
    return {
      ok: false,
      message: `Invalid create payload: unknown field "${unknownField}"`,
    };
  }

  const parsed = createSpaceBodySchema.safeParse(bodyCandidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { ok: false, message: firstIssue?.message ?? "Invalid guide" };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseUpsertSpacePasswordBody(
  body: unknown
): ParseResult<UpsertSpacePasswordBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload",
    };
  }

  const parsed = upsertSpacePasswordBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_password_payload",
      message: "Invalid password payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseSetSpaceAccessModeBody(
  body: unknown
): ParseResult<SetSpaceAccessModeBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Invalid access mode payload",
    };
  }

  const parsed = setSpaceAccessModeBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_payload",
      message: parsed.error.issues[0]?.message ?? "Invalid access mode payload",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parsePatchSpaceMetaBody(
  body: unknown
): ParseResult<PatchSpaceMetaBody> {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Invalid JSON" };
  }

  const bodyCandidate =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const unknownField = findFirstUnknownField(
    bodyCandidate,
    PATCH_SPACE_META_ALLOWED_FIELDS
  );
  if (unknownField) {
    return { ok: false, message: `Unknown field: ${unknownField}` };
  }

  const parsed = patchSpaceMetaBodySchema.safeParse(bodyCandidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      message: firstIssue?.message ?? "Invalid space meta patch",
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

function findFirstUnknownField(
  body: Record<string, unknown>,
  allowedFields: ReadonlySet<string>
): string | undefined {
  for (const fieldName of Object.keys(body)) {
    if (!allowedFields.has(fieldName)) {
      return fieldName;
    }
  }
  return undefined;
}

export function parsePatchSpaceCursorBody(
  body: unknown
): ParseResult<PatchSpaceCursorBody> {
  return normalizeSpaceCursorPatch(body);
}

export function parseProfileSpaceHistoryListQuery(
  query: unknown
): ParseResult<ListProfileSpaceHistoryQuery> {
  const parsed = listProfileSpaceHistoryQuerySchema.safeParse(query);
  if (!parsed.success) {
    return {
      ok: false,
      message: mapProfileSpaceHistoryFieldError(
        parsed.error.issues[0]?.path[0]
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseUpsertProfileSpaceHistoryBody(
  body: unknown
): ParseResult<UpsertProfileSpaceHistoryBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON" };
  }

  const parsed = upsertProfileSpaceHistoryBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: mapProfileSpaceHistoryFieldError(
        parsed.error.issues[0]?.path[0]
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parsePatchProfileSpaceHistoryStatusBody(
  body: unknown
): ParseResult<PatchProfileSpaceHistoryStatusBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON" };
  }

  const parsed = patchProfileSpaceHistoryStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: mapProfileSpaceHistoryFieldError(
        parsed.error.issues[0]?.path[0]
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseQuerySpaceDeletionTombstonesBody(
  body: unknown
): ParseResult<QuerySpaceDeletionTombstonesBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON" };
  }

  const parsed = querySpaceDeletionTombstonesBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: mapSpaceDeletionTombstoneFieldError(
        parsed.error.issues[0]?.path[0]
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function parseUpsertSpaceDeletionTombstoneBody(
  body: unknown
): ParseResult<UpsertSpaceDeletionTombstoneBody> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON" };
  }

  const parsed = upsertSpaceDeletionTombstoneBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      message: mapSpaceDeletionTombstoneFieldError(
        parsed.error.issues[0]?.path[0]
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

function mapProfileSpaceHistoryFieldError(field: unknown): string {
  if (field === "gatewayHost") {
    return "Invalid gatewayHost";
  }
  if (field === "status") {
    return "Invalid status";
  }
  if (field === "limit") {
    return "Invalid limit";
  }
  if (field === "pinned") {
    return "Invalid pinned";
  }
  if (field === "spaceName") {
    return "Invalid spaceName";
  }
  if (field === "creatorProfileId") {
    return "Invalid creatorProfileId";
  }
  if (field === "creatorKind") {
    return "Invalid creatorKind";
  }
  if (field === "spaceCreatedAt") {
    return "Invalid spaceCreatedAt";
  }
  if (field === "spaceUpdatedAt") {
    return "Invalid spaceUpdatedAt";
  }
  if (field === "lastJoinedAt") {
    return "Invalid lastJoinedAt";
  }
  if (field === "lastSeenTs") {
    return "Invalid lastSeenTs";
  }
  if (field === "pinnedAt") {
    return "Invalid pinnedAt";
  }
  if (field === "reason") {
    return "Invalid reason";
  }

  return "Invalid profile space history payload";
}

function mapSpaceDeletionTombstoneFieldError(field: unknown): string {
  if (field === "gatewayHost") {
    return "Invalid gatewayHost";
  }
  if (field === "spaceIds") {
    return "Invalid spaceIds";
  }
  if (field === "spaceName") {
    return "Invalid spaceName";
  }
  if (field === "creatorProfileId") {
    return "Invalid creatorProfileId";
  }
  if (field === "creatorKind") {
    return "Invalid creatorKind";
  }
  if (field === "deletedAt") {
    return "Invalid deletedAt";
  }
  return "Invalid space deletion tombstone payload";
}
