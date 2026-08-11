import type { GatewayErrorCode } from "@openmeld/gateway-contract";
import {
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  buildSpaceAttachmentObjectKey,
  detectSpaceAttachmentMimeType,
  SPACE_ATTACHMENT_MAX_SIZE_BYTES,
  spaceAttachmentDescriptorSchema,
  spaceAttachmentIdSchema,
  spaceAttachmentMimeTypeSchema,
  spaceAttachmentUploadQuerySchema,
  uploadSpaceAttachmentResponseSchema,
} from "@openmeld/schemas";
import type {
  SpaceAttachmentDescriptor,
  SpaceAttachmentMimeType,
  SpaceAttachmentUploadQuery,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import { withUpstreamRetry } from "../lib/upstream-retry";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  formatAuditValue,
  resolveGatewayStructuredRpcErrorResponse,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const SPACE_ATTACHMENTS_ROUTE = "/v1/spaces/:spaceId/attachments";
const SPACE_ATTACHMENT_ROUTE = "/v1/spaces/:spaceId/attachments/:attachmentId";
const ATTACHMENT_CACHE_CONTROL = "private, max-age=3600";

const CONTENT_LENGTH_PATTERN = /^\d+$/u;

export function registerSpaceAttachmentRoutes(app: Hono<HonoBindings>): void {
  app.post(SPACE_ATTACHMENTS_ROUTE, uploadSpaceAttachment);
  app.get(SPACE_ATTACHMENT_ROUTE, downloadSpaceAttachment);
}

async function uploadSpaceAttachment(
  c: Context<HonoBindings>
): Promise<Response> {
  const spaceResult = parseSpaceRouteParams(c.req.param("spaceId"));
  if (!spaceResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      status: 400,
      code: "invalid_space_id",
      message: spaceResult.message,
      reason: `invalid_space_id_param spaceId=${formatAuditValue(
        c.req.param("spaceId")
      )}`,
    });
  }
  const spaceId = spaceResult.value.spaceId;

  const contentLengthResult = parseAttachmentContentLength(
    c.req.raw.headers.get("content-length")
  );
  if (!contentLengthResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      ...contentLengthResult.error,
    });
  }

  const mimeTypeResult = parseAttachmentMimeType(
    c.req.raw.headers.get("content-type")
  );
  if (!mimeTypeResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      status: 415,
      code: "attachment_type_unsupported",
      message: "Only JPEG and PNG attachments are supported.",
    });
  }

  const queryResult = parseAttachmentUploadQuery(c);
  if (!queryResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      status: 400,
      code: "invalid_payload",
      message: queryResult.message,
    });
  }

  const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
  if (!bucket) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      status: 503,
      code: "gateway.misconfigured",
      message: "Missing worker binding: OPENMELD_SPACE_ATTACHMENTS.",
    });
  }

  const bodyResult = await readAttachmentBody(c.req.raw);
  if (!bodyResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      ...bodyResult.error,
    });
  }
  const bytes = bodyResult.bytes;
  if (detectSpaceAttachmentMimeType(bytes) !== mimeTypeResult.mimeType) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENTS_ROUTE,
      method: "POST",
      spaceId,
      status: 415,
      code: "attachment_content_mismatch",
      message: "Attachment bytes do not match the declared Content-Type.",
    });
  }

  return executeRpcRoute({
    c,
    route: SPACE_ATTACHMENTS_ROUTE,
    method: "POST",
    spaceId,
    successStatus: 201,
    responseSchema: uploadSpaceAttachmentResponseSchema,
    resolveSuccessPayload: (result) => ({ attachment: result }),
    execute: async () => {
      const descriptorResult = spaceAttachmentDescriptorSchema.safeParse(
        await c.var.coreRpc.recordSpaceAttachment({
          spaceId,
          mimeType: mimeTypeResult.mimeType,
          sizeBytes: bytes.byteLength,
          ...queryResult.query,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
          context: buildCoreRpcContext(c),
        })
      );
      if (!descriptorResult.success) {
        throw createAttachmentRouteError({
          status: 502,
          code: "upstream_error",
          message: "Core returned an invalid attachment descriptor.",
        });
      }

      const descriptor = descriptorResult.data;
      assertRecordedDescriptorMatchesUpload({
        descriptor,
        mimeType: mimeTypeResult.mimeType,
        organizationId:
          c.var.openMeldRequestContext.activeOrganizationId ?? null,
        sizeBytes: bytes.byteLength,
        spaceId,
      });
      const key = buildSpaceAttachmentObjectKey(descriptor);

      try {
        const stored = await bucket.put(key, bytes, {
          httpMetadata: { contentType: descriptor.mimeType },
        });
        if (!stored) {
          throw new Error("R2 put returned no stored object metadata.");
        }
      } catch (storageError) {
        let compensationError: unknown = null;
        try {
          await c.var.coreRpc.deleteSpaceAttachmentRecord({
            attachmentId: descriptor.id,
          });
        } catch (error) {
          compensationError = error;
        }
        logAttachmentStorageFailure({
          attachmentId: descriptor.id,
          compensationError,
          requestId: c.var.openMeldRequestContext.actorContext.requestId,
          spaceId,
          storageError,
        });
        throw createAttachmentRouteError({
          status: 500,
          code: "attachment_storage_failed",
          message: "The attachment could not be stored.",
        });
      }

      return descriptor;
    },
  });
}

async function downloadSpaceAttachment(
  c: Context<HonoBindings>
): Promise<Response> {
  const spaceResult = parseSpaceRouteParams(c.req.param("spaceId"));
  if (!spaceResult.ok) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      status: 400,
      code: "invalid_space_id",
      message: spaceResult.message,
    });
  }
  const spaceId = spaceResult.value.spaceId;
  const attachmentIdResult = spaceAttachmentIdSchema.safeParse(
    c.req.param("attachmentId")
  );
  if (!attachmentIdResult.success) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      spaceId,
      status: 400,
      code: "invalid_payload",
      message: "Attachment ID is invalid.",
    });
  }
  const attachmentId = attachmentIdResult.data;

  const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
  if (!bucket) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      spaceId,
      status: 503,
      code: "gateway.misconfigured",
      message: "Missing worker binding: OPENMELD_SPACE_ATTACHMENTS.",
    });
  }

  let descriptor: SpaceAttachmentDescriptor;
  try {
    const result = await withUpstreamRetry(async () =>
      c.var.coreRpc.resolveSpaceAttachmentForDownload({
        spaceId,
        attachmentId,
        spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        context: buildCoreRpcContext(c),
      })
    );
    const parsed = spaceAttachmentDescriptorSchema.safeParse(result);
    if (!parsed.success) {
      return respondAttachmentError({
        c,
        route: SPACE_ATTACHMENT_ROUTE,
        method: "GET",
        spaceId,
        status: 502,
        code: "upstream_error",
        message: "Core returned an invalid attachment descriptor.",
      });
    }
    descriptor = parsed.data;
  } catch (error) {
    return respondCoreDownloadError({ c, error, spaceId });
  }

  if (
    descriptor.spaceId !== spaceId ||
    descriptor.id !== attachmentId ||
    descriptor.organizationId !==
      c.var.openMeldRequestContext.activeOrganizationId
  ) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      spaceId,
      status: 502,
      code: "upstream_error",
      message: "Core returned an attachment outside the requested scope.",
    });
  }

  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(buildSpaceAttachmentObjectKey(descriptor));
  } catch (error) {
    logAttachmentStorageFailure({
      attachmentId,
      compensationError: null,
      requestId: c.var.openMeldRequestContext.actorContext.requestId,
      spaceId,
      storageError: error,
    });
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      spaceId,
      status: 500,
      code: "attachment_storage_failed",
      message: "The attachment could not be read.",
    });
  }
  if (!object) {
    return respondAttachmentError({
      c,
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      spaceId,
      status: 404,
      code: "attachment_not_found",
      message: "Attachment not found.",
    });
  }

  logAuditEvent({
    event: "http.forward",
    route: SPACE_ATTACHMENT_ROUTE,
    method: "GET",
    spaceId,
    status: 200,
    latencyMs: Date.now() - c.var.startedAt,
    ...contextAuditFields(c.var.openMeldRequestContext),
  });
  return withRequestIdHeader(
    new Response(object.body, {
      headers: {
        "cache-control": ATTACHMENT_CACHE_CONTROL,
        "content-type": descriptor.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    c.var.openMeldRequestContext.actorContext.requestId
  );
}

type AttachmentErrorSurface = {
  status: number;
  code: GatewayErrorCode;
  message: string;
  reason?: string;
};

function respondAttachmentError(
  input: AttachmentErrorSurface & {
    c: Context<HonoBindings>;
    route: string;
    method: RpcHttpMethod;
    spaceId?: string;
  }
): Response {
  const context = input.c.var.openMeldRequestContext;
  logAuditEvent({
    event: input.status >= 500 ? "http.forward.error" : "http.forward",
    route: input.route,
    method: input.method,
    status: input.status,
    latencyMs: Date.now() - input.c.var.startedAt,
    errorCode: input.code,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    ...(input.reason ? { reason: formatAuditValue(input.reason, 320) } : {}),
    ...contextAuditFields(context),
  });
  return jsonErrorResponse({
    status: input.status,
    code: input.code,
    message: input.message,
    requestId: context.actorContext.requestId,
  });
}

function respondCoreDownloadError(input: {
  c: Context<HonoBindings>;
  error: unknown;
  spaceId: string;
}): Response {
  const context = input.c.var.openMeldRequestContext;
  const structured = resolveGatewayStructuredRpcErrorResponse({
    err: input.error,
    requestId: context.actorContext.requestId,
  });
  if (structured) {
    logAuditEvent({
      event: "http.forward",
      route: SPACE_ATTACHMENT_ROUTE,
      method: "GET",
      status: structured.status,
      latencyMs: Date.now() - input.c.var.startedAt,
      spaceId: input.spaceId,
      errorCode: structured.code,
      ...contextAuditFields(context),
    });
    return jsonErrorResponse(structured);
  }
  return respondAttachmentError({
    c: input.c,
    route: SPACE_ATTACHMENT_ROUTE,
    method: "GET",
    spaceId: input.spaceId,
    status: 502,
    code: "upstream_unreachable",
    message: toErrorMessage(input.error),
  });
}

function parseAttachmentContentLength(
  rawValue: string | null
): { ok: true } | { ok: false; error: AttachmentErrorSurface } {
  if (rawValue === null) {
    return {
      ok: false,
      error: {
        status: 411,
        code: "bad_request",
        message: "Content-Length is required for attachment uploads.",
      },
    };
  }
  const normalized = rawValue.trim();
  if (!CONTENT_LENGTH_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: {
        status: 400,
        code: "invalid_payload",
        message: "Content-Length must be a non-negative integer.",
      },
    };
  }
  const contentLength = Number(normalized);
  if (!Number.isSafeInteger(contentLength)) {
    return {
      ok: false,
      error: {
        status: 400,
        code: "invalid_payload",
        message: "Content-Length is invalid.",
      },
    };
  }
  if (contentLength > SPACE_ATTACHMENT_MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: {
        status: 413,
        code: "attachment_too_large",
        message: "Attachments must be 5 MiB or smaller.",
      },
    };
  }
  return { ok: true };
}

function parseAttachmentMimeType(
  rawValue: string | null
): { ok: true; mimeType: SpaceAttachmentMimeType } | { ok: false } {
  const parsed = spaceAttachmentMimeTypeSchema.safeParse(
    rawValue?.trim().toLowerCase()
  );
  return parsed.success ? { ok: true, mimeType: parsed.data } : { ok: false };
}

function parseAttachmentUploadQuery(
  c: Context<HonoBindings>
):
  | { ok: true; query: SpaceAttachmentUploadQuery }
  | { ok: false; message: string } {
  const parsed = spaceAttachmentUploadQuerySchema.safeParse({
    fileName: c.req.query("fileName"),
    width: c.req.query("width"),
    height: c.req.query("height"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Attachment upload metadata is invalid.",
    };
  }
  return { ok: true, query: parsed.data };
}

async function readAttachmentBody(
  request: Request
): Promise<
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; error: AttachmentErrorSurface }
> {
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      error: {
        status: 400,
        code: "invalid_payload",
        message: "Attachment bytes could not be read.",
      },
    };
  }
  if (bytes.byteLength > SPACE_ATTACHMENT_MAX_SIZE_BYTES) {
    return {
      ok: false,
      error: {
        status: 413,
        code: "attachment_too_large",
        message: "Attachments must be 5 MiB or smaller.",
      },
    };
  }
  return { ok: true, bytes };
}

function assertRecordedDescriptorMatchesUpload(input: {
  descriptor: SpaceAttachmentDescriptor;
  mimeType: SpaceAttachmentMimeType;
  organizationId: string | null;
  sizeBytes: number;
  spaceId: string;
}): void {
  if (
    input.descriptor.spaceId !== input.spaceId ||
    input.descriptor.organizationId !== input.organizationId ||
    input.descriptor.mimeType !== input.mimeType ||
    input.descriptor.sizeBytes !== input.sizeBytes
  ) {
    throw createAttachmentRouteError({
      status: 502,
      code: "upstream_error",
      message: "Core returned attachment metadata outside the upload scope.",
    });
  }
}

function createAttachmentRouteError(input: {
  status: number;
  code: GatewayErrorCode;
  message: string;
}): Error {
  const error = new Error(input.message) as Error & {
    status: number;
    code: GatewayErrorCode;
  };
  error.status = input.status;
  error.code = input.code;
  return error;
}

function logAttachmentStorageFailure(input: {
  attachmentId: string;
  compensationError: unknown;
  requestId: string;
  spaceId: string;
  storageError: unknown;
}): void {
  console.error(
    JSON.stringify({
      event: "gateway.space_attachment.storage_failed",
      requestId: input.requestId,
      spaceId: input.spaceId,
      attachmentId: input.attachmentId,
      storageError: toErrorMessage(input.storageError),
      ...(input.compensationError
        ? { compensationError: toErrorMessage(input.compensationError) }
        : {}),
    })
  );
}
