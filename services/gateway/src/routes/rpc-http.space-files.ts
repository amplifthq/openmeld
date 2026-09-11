import type { GatewayErrorCode } from "@openmeld/gateway-contract";
import {
  contextAuditFields,
  jsonErrorResponse,
  toErrorMessage,
  withRequestIdHeader,
} from "@openmeld/gateway-contract";
import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
  commitSpaceFileWriteInputSchema,
  createSpaceFileUploadQuerySchema,
  createSpaceFolderBodySchema,
  createSpaceFolderResponseSchema,
  discardSpaceComposerUploadResponseSchema,
  getSpaceFileResponseSchema,
  listSpaceFileRevisionsResponseSchema,
  listSpaceFilesQuerySchema,
  listSpaceFilesResponseSchema,
  publishSpaceComposerUploadBodySchema,
  publishSpaceComposerUploadResponseSchema,
  resolveSpaceFileContentResponseSchema,
  restoreSpaceFileEntryBodySchema,
  restoreSpaceFileEntryResponseSchema,
  restoreSpaceFileRevisionBodySchema,
  restoreSpaceFileRevisionResponseSchema,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceComposerUploadIdSchema,
  spaceFileContentQuerySchema,
  spaceFileEntryIdSchema,
  spaceFileMimeTypeSchema,
  spaceFileRevisionNumberSchema,
  spaceFileUpdateSettingsCommandSchema,
  spaceFileUpdateSettingsSchema,
  spaceFileUploadCommandSchema,
  spaceFileUploadResponseSchema,
  stageSpaceComposerUploadQuerySchema,
  stageSpaceComposerUploadResponseSchema,
  trashSpaceFileEntryBodySchema,
  trashSpaceFileEntryResponseSchema,
  updateSpaceFileContentQuerySchema,
  updateSpaceFileEntryBodySchema,
  updateSpaceFileEntryResponseSchema,
  uploadSpaceFileResponseSchema,
} from "@openmeld/schemas";
import type {
  CommitSpaceFileWriteInput,
  ResolveSpaceFileContentResponse,
  SpaceFileDescriptor,
} from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import { logAuditEvent } from "../audit";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  formatAuditValue,
  resolveGatewayStructuredRpcErrorResponse,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const SPACE_FILES_ROUTE = "/v1/spaces/:spaceId/files";
const SPACE_FILE_FOLDERS_ROUTE = "/v1/spaces/:spaceId/files/folders";
const SPACE_FILE_ENTRY_ROUTE = "/v1/spaces/:spaceId/files/:entryId";
const SPACE_FILE_REVISIONS_ROUTE =
  "/v1/spaces/:spaceId/files/:entryId/revisions";
const SPACE_FILE_REVISION_RESTORE_ROUTE =
  "/v1/spaces/:spaceId/files/:entryId/revisions/:revision/restore";
const SPACE_FILE_RESTORE_ROUTE = "/v1/spaces/:spaceId/files/:entryId/restore";
const SPACE_FILE_CONTENT_ROUTE = "/v1/spaces/:spaceId/files/:entryId/content";
const SPACE_COMPOSER_UPLOAD_ROUTE =
  "/v1/spaces/:spaceId/composer-uploads/:entryId";
const SPACE_COMPOSER_UPLOAD_PUBLISH_ROUTE =
  "/v1/spaces/:spaceId/composer-uploads/:entryId/publish";
const PRIVATE_CONTENT_CACHE_CONTROL = "private, no-store";

export function registerSpaceFileRoutes(app: Hono<HonoBindings>): void {
  const settingsRoute = "/v1/spaces/:spaceId/files/:entryId/update-settings";
  for (const method of ["GET", "PATCH"] as const) {
    app.on(method, settingsRoute, async (c) => {
      const target = parseEntryTarget(c, settingsRoute, method);
      if (!target.ok) {
        return target.response;
      }
      const command = spaceFileUpdateSettingsCommandSchema.safeParse(
        method === "GET"
          ? { action: "read" }
          : await c.req.json().catch(() => null)
      );
      if (!command.success) {
        return respondInvalidBody(
          c,
          target.spaceId,
          settingsRoute,
          "PATCH",
          command
        );
      }
      return executeRpcRoute({
        c,
        route: settingsRoute,
        method,
        spaceId: target.spaceId,
        responseSchema: spaceFileUpdateSettingsSchema,
        execute: () =>
          c.var.coreRpc.spaceFileUpdateSettings({
            spaceId: target.spaceId,
            fileId: target.entryId,
            command: command.data,
            context: buildCoreRpcContext(c),
            spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
          }),
      });
    });
  }
  app.post("/v1/spaces/:spaceId/file-uploads/:entryId", async (c) => {
    const route = "/v1/spaces/:spaceId/file-uploads/:entryId";
    const target = parseEntryTarget(c, route, "POST");
    if (!target.ok) {
      return target.response;
    }
    const command = spaceFileUploadCommandSchema.safeParse(
      c.req.query("part")
        ? { action: "part", partNumber: Number(c.req.query("part")) }
        : await c.req.json().catch(() => null)
    );
    if (!command.success) {
      return jsonErrorResponse({
        code: "invalid_payload",
        message: "Invalid upload request.",
        status: 400,
        requestId: c.var.openMeldRequestContext.actorContext.requestId,
      });
    }
    return await executeRpcRoute({
      c,
      route,
      method: "POST",
      spaceId: target.spaceId,
      responseSchema: spaceFileUploadResponseSchema,
      execute: () =>
        c.var.coreRpc.spaceFileUpload({
          spaceId: target.spaceId,
          uploadId: target.entryId,
          command: command.data,
          ...(command.data.action === "part" && c.req.raw.body
            ? { body: c.req.raw.body }
            : {}),
          context: buildCoreRpcContext(c),
          spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        }),
    });
  });
  app.put(SPACE_COMPOSER_UPLOAD_ROUTE, stageSpaceComposerUpload);
  app.delete(SPACE_COMPOSER_UPLOAD_ROUTE, discardSpaceComposerUpload);
  app.post(SPACE_COMPOSER_UPLOAD_PUBLISH_ROUTE, publishSpaceComposerUpload);
  app.get(SPACE_FILES_ROUTE, listSpaceFiles);
  app.post(SPACE_FILES_ROUTE, uploadSpaceFile);
  app.post(SPACE_FILE_FOLDERS_ROUTE, createSpaceFolder);
  app.get(SPACE_FILE_REVISIONS_ROUTE, listSpaceFileRevisions);
  app.post(SPACE_FILE_REVISION_RESTORE_ROUTE, restoreSpaceFileRevision);
  app.post(SPACE_FILE_RESTORE_ROUTE, restoreSpaceFileEntry);
  app.get(SPACE_FILE_CONTENT_ROUTE, downloadSpaceFileContent);
  app.put(SPACE_FILE_CONTENT_ROUTE, updateSpaceFileContent);
  app.get(SPACE_FILE_ENTRY_ROUTE, getSpaceFile);
  app.patch(SPACE_FILE_ENTRY_ROUTE, updateSpaceFileEntry);
  app.delete(SPACE_FILE_ENTRY_ROUTE, trashSpaceFileEntry);
}

async function stageSpaceComposerUpload(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_COMPOSER_UPLOAD_ROUTE, "PUT");
  if (!target.ok) {
    return target.response;
  }
  const uploadId = spaceComposerUploadIdSchema.safeParse(target.entryId);
  const query = stageSpaceComposerUploadQuerySchema.safeParse({
    name: c.req.query("name"),
  });
  if (!(uploadId.success && query.success)) {
    return respondFileError({
      c,
      code: "invalid_payload",
      message:
        uploadId.error?.issues[0]?.message ??
        query.error?.issues[0]?.message ??
        "Invalid Composer upload.",
      method: "PUT",
      route: SPACE_COMPOSER_UPLOAD_ROUTE,
      spaceId: target.spaceId,
      status: 400,
    });
  }
  const body = await readSpaceFileBody({
    c,
    method: "PUT",
    route: SPACE_COMPOSER_UPLOAD_ROUTE,
    spaceId: target.spaceId,
  });
  if (!body.ok) {
    return body.response;
  }
  return await executeRpcRoute({
    c,
    execute: () =>
      c.var.coreRpc.stageSpaceComposerUpload({
        bytes: body.bytes,
        context: buildCoreRpcContext(c),
        mimeType: body.mimeType,
        name: query.data.name,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        spaceId: target.spaceId,
        uploadId: uploadId.data,
      }),
    method: "PUT",
    resolveSuccessPayload: (upload) => ({ upload }),
    responseSchema: stageSpaceComposerUploadResponseSchema,
    route: SPACE_COMPOSER_UPLOAD_ROUTE,
    spaceId: target.spaceId,
    successStatus: 201,
  });
}

async function publishSpaceComposerUpload(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(
    c,
    SPACE_COMPOSER_UPLOAD_PUBLISH_ROUTE,
    "POST"
  );
  if (!target.ok) {
    return target.response;
  }
  const uploadId = spaceComposerUploadIdSchema.safeParse(target.entryId);
  const body = publishSpaceComposerUploadBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!(uploadId.success && body.success)) {
    return respondFileError({
      c,
      code: "invalid_payload",
      message:
        uploadId.error?.issues[0]?.message ??
        body.error?.issues[0]?.message ??
        "Invalid Composer upload publication.",
      method: "POST",
      route: SPACE_COMPOSER_UPLOAD_PUBLISH_ROUTE,
      spaceId: target.spaceId,
      status: 400,
    });
  }
  return await executeRpcRoute({
    c,
    execute: () =>
      c.var.coreRpc.publishSpaceComposerUpload({
        clientMutationId: body.data.clientMutationId,
        context: buildCoreRpcContext(c),
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        spaceId: target.spaceId,
        uploadId: uploadId.data,
      }),
    method: "POST",
    resolveSuccessPayload: (file) => ({ file }),
    responseSchema: publishSpaceComposerUploadResponseSchema,
    route: SPACE_COMPOSER_UPLOAD_PUBLISH_ROUTE,
    spaceId: target.spaceId,
  });
}

async function discardSpaceComposerUpload(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_COMPOSER_UPLOAD_ROUTE, "DELETE");
  if (!target.ok) {
    return target.response;
  }
  const uploadId = spaceComposerUploadIdSchema.safeParse(target.entryId);
  if (!uploadId.success) {
    return respondFileError({
      c,
      code: "invalid_payload",
      message: uploadId.error.issues[0]?.message ?? "Invalid Composer upload.",
      method: "DELETE",
      route: SPACE_COMPOSER_UPLOAD_ROUTE,
      spaceId: target.spaceId,
      status: 400,
    });
  }
  return await executeRpcRoute({
    c,
    execute: () =>
      c.var.coreRpc.discardSpaceComposerUpload({
        context: buildCoreRpcContext(c),
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        spaceId: target.spaceId,
        uploadId: uploadId.data,
      }),
    method: "DELETE",
    responseSchema: discardSpaceComposerUploadResponseSchema,
    route: SPACE_COMPOSER_UPLOAD_ROUTE,
    spaceId: target.spaceId,
  });
}

async function restoreSpaceFileEntry(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_RESTORE_ROUTE, "POST");
  if (!target.ok) {
    return target.response;
  }
  const body = restoreSpaceFileEntryBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return respondInvalidBody(
      c,
      target.spaceId,
      SPACE_FILE_RESTORE_ROUTE,
      "POST",
      body
    );
  }
  return executeRpcRoute({
    c,
    route: SPACE_FILE_RESTORE_ROUTE,
    method: "POST",
    spaceId: target.spaceId,
    responseSchema: restoreSpaceFileEntryResponseSchema,
    execute: () =>
      c.var.coreRpc.restoreSpaceFileEntry({
        body: body.data,
        entryId: target.entryId,
        spaceId: target.spaceId,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function restoreSpaceFileRevision(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_REVISION_RESTORE_ROUTE, "POST");
  if (!target.ok) {
    return target.response;
  }
  const body = restoreSpaceFileRevisionBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return respondInvalidBody(
      c,
      target.spaceId,
      SPACE_FILE_REVISION_RESTORE_ROUTE,
      "POST",
      body
    );
  }
  const revision = spaceFileRevisionNumberSchema.safeParse(
    Number(c.req.param("revision"))
  );
  if (!revision.success) {
    return respondFileError({
      c,
      route: SPACE_FILE_REVISION_RESTORE_ROUTE,
      method: "POST",
      spaceId: target.spaceId,
      status: 400,
      code: "invalid_payload",
      message: revision.error.issues[0]?.message ?? "Invalid file revision.",
    });
  }
  return executeRpcRoute({
    c,
    route: SPACE_FILE_REVISION_RESTORE_ROUTE,
    method: "POST",
    spaceId: target.spaceId,
    responseSchema: restoreSpaceFileRevisionResponseSchema,
    resolveSuccessPayload: (file) => ({ file }),
    execute: () =>
      c.var.coreRpc.restoreSpaceFileRevision({
        body: body.data,
        fileId: target.entryId,
        revision: revision.data,
        spaceId: target.spaceId,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function listSpaceFiles(c: Context<HonoBindings>): Promise<Response> {
  const target = parseTarget(c, SPACE_FILES_ROUTE, "GET");
  if (!target.ok) {
    return target.response;
  }
  const parsed = listSpaceFilesQuerySchema.safeParse({
    ...(c.req.query("parentId") === undefined
      ? {}
      : { parentId: c.req.query("parentId") }),
    ...(c.req.query("view") === undefined ? {} : { view: c.req.query("view") }),
  });
  if (!parsed.success) {
    return respondFileError({
      c,
      route: SPACE_FILES_ROUTE,
      method: "GET",
      spaceId: target.spaceId,
      status: 400,
      code: "invalid_payload",
      message:
        parsed.error.issues[0]?.message ?? "Invalid Space Files request.",
    });
  }
  return await executeRpcRoute({
    c,
    route: SPACE_FILES_ROUTE,
    method: "GET",
    spaceId: target.spaceId,
    responseSchema: listSpaceFilesResponseSchema,
    execute: () =>
      c.var.coreRpc.listSpaceFiles({
        spaceId: target.spaceId,
        query: parsed.data,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function getSpaceFile(c: Context<HonoBindings>): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_ENTRY_ROUTE, "GET");
  if (!target.ok) {
    return target.response;
  }
  return await executeRpcRoute({
    c,
    route: SPACE_FILE_ENTRY_ROUTE,
    method: "GET",
    spaceId: target.spaceId,
    responseSchema: getSpaceFileResponseSchema,
    resolveSuccessPayload: (file) => ({ file }),
    execute: () =>
      c.var.coreRpc.getSpaceFile({
        spaceId: target.spaceId,
        fileId: target.entryId,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function listSpaceFileRevisions(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_REVISIONS_ROUTE, "GET");
  if (!target.ok) {
    return target.response;
  }
  return await executeRpcRoute({
    c,
    route: SPACE_FILE_REVISIONS_ROUTE,
    method: "GET",
    spaceId: target.spaceId,
    responseSchema: listSpaceFileRevisionsResponseSchema,
    execute: () =>
      c.var.coreRpc.listSpaceFileRevisions({
        spaceId: target.spaceId,
        fileId: target.entryId,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function createSpaceFolder(c: Context<HonoBindings>): Promise<Response> {
  const target = parseTarget(c, SPACE_FILE_FOLDERS_ROUTE, "POST");
  if (!target.ok) {
    return target.response;
  }
  const body = createSpaceFolderBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return respondInvalidBody(
      c,
      target.spaceId,
      SPACE_FILE_FOLDERS_ROUTE,
      "POST",
      body
    );
  }
  return executeRpcRoute({
    c,
    route: SPACE_FILE_FOLDERS_ROUTE,
    method: "POST",
    spaceId: target.spaceId,
    successStatus: 201,
    responseSchema: createSpaceFolderResponseSchema,
    execute: () =>
      c.var.coreRpc.createSpaceFolder({
        spaceId: target.spaceId,
        body: body.data,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function updateSpaceFileEntry(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_ENTRY_ROUTE, "PATCH");
  if (!target.ok) {
    return target.response;
  }
  const body = updateSpaceFileEntryBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return respondInvalidBody(
      c,
      target.spaceId,
      SPACE_FILE_ENTRY_ROUTE,
      "PATCH",
      body
    );
  }
  return executeRpcRoute({
    c,
    route: SPACE_FILE_ENTRY_ROUTE,
    method: "PATCH",
    spaceId: target.spaceId,
    responseSchema: updateSpaceFileEntryResponseSchema,
    execute: () =>
      c.var.coreRpc.updateSpaceFileEntry({
        spaceId: target.spaceId,
        entryId: target.entryId,
        body: body.data,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function trashSpaceFileEntry(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_ENTRY_ROUTE, "DELETE");
  if (!target.ok) {
    return target.response;
  }
  const body = trashSpaceFileEntryBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return respondInvalidBody(
      c,
      target.spaceId,
      SPACE_FILE_ENTRY_ROUTE,
      "DELETE",
      body
    );
  }
  return executeRpcRoute({
    c,
    route: SPACE_FILE_ENTRY_ROUTE,
    method: "DELETE",
    spaceId: target.spaceId,
    responseSchema: trashSpaceFileEntryResponseSchema,
    execute: () =>
      c.var.coreRpc.trashSpaceFileEntry({
        spaceId: target.spaceId,
        entryId: target.entryId,
        clientMutationId: body.data.clientMutationId,
        spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
        context: buildCoreRpcContext(c),
      }),
  });
}

async function uploadSpaceFile(c: Context<HonoBindings>): Promise<Response> {
  const target = parseTarget(c, SPACE_FILES_ROUTE, "POST");
  if (!target.ok) {
    return target.response;
  }
  const query = createSpaceFileUploadQuerySchema.safeParse({
    name: c.req.query("name"),
    parentId: c.req.query("parentId"),
    clientMutationId: c.req.query("clientMutationId"),
  });
  if (!query.success) {
    return respondFileError({
      c,
      route: SPACE_FILES_ROUTE,
      method: "POST",
      spaceId: target.spaceId,
      status: 400,
      code: "invalid_payload",
      message: query.error.issues[0]?.message ?? "Invalid file upload.",
    });
  }
  const body = await readSpaceFileBody({
    c,
    method: "POST",
    route: SPACE_FILES_ROUTE,
    spaceId: target.spaceId,
  });
  if (!body.ok) {
    return body.response;
  }
  const [fileId, revisionId] = await Promise.all([
    buildSpaceFileEntryIdForMutation(query.data.clientMutationId),
    buildSpaceFileRevisionIdForMutation({
      baseRevision: null,
      bytes: body.bytes,
      clientMutationId: query.data.clientMutationId,
      mimeType: body.mimeType,
      name: query.data.name,
      parentId: query.data.parentId ?? null,
    }),
  ]);
  const write: CommitSpaceFileWriteInput = {
    spaceId: target.spaceId,
    fileId,
    revisionId,
    name: query.data.name,
    parentId: query.data.parentId ?? null,
    baseRevision: null,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
    sizeBytes: body.bytes.byteLength,
  };
  const result = await persistSpaceFileRevision({
    c,
    route: SPACE_FILES_ROUTE,
    method: "POST",
    write,
    bytes: body.bytes,
  });
  if (!result.ok) {
    return result.response;
  }
  return withRequestIdHeader(
    Response.json(uploadSpaceFileResponseSchema.parse({ file: result.file }), {
      status: 201,
    }),
    c.var.openMeldRequestContext.actorContext.requestId
  );
}

async function updateSpaceFileContent(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_CONTENT_ROUTE, "PUT");
  if (!target.ok) {
    return target.response;
  }
  const query = updateSpaceFileContentQuerySchema.safeParse({
    baseRevision: c.req.query("baseRevision"),
    clientMutationId: c.req.query("clientMutationId"),
  });
  if (!query.success) {
    return respondFileError({
      c,
      route: SPACE_FILE_CONTENT_ROUTE,
      method: "PUT",
      spaceId: target.spaceId,
      status: 400,
      code: "invalid_payload",
      message: query.error.issues[0]?.message ?? "Invalid file update.",
    });
  }
  const body = await readSpaceFileBody({
    c,
    method: "PUT",
    route: SPACE_FILE_CONTENT_ROUTE,
    spaceId: target.spaceId,
  });
  if (!body.ok) {
    return body.response;
  }
  const revisionId = await buildSpaceFileRevisionIdForMutation({
    baseRevision: query.data.baseRevision,
    bytes: body.bytes,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
  });
  const write = commitSpaceFileWriteInputSchema.parse({
    spaceId: target.spaceId,
    fileId: target.entryId,
    revisionId,
    baseRevision: query.data.baseRevision,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
    sizeBytes: body.bytes.byteLength,
  });
  const result = await persistSpaceFileRevision({
    c,
    route: SPACE_FILE_CONTENT_ROUTE,
    method: "PUT",
    write,
    bytes: body.bytes,
  });
  if (!result.ok) {
    return result.response;
  }
  return withRequestIdHeader(
    Response.json(uploadSpaceFileResponseSchema.parse({ file: result.file })),
    c.var.openMeldRequestContext.actorContext.requestId
  );
}

async function downloadSpaceFileContent(
  c: Context<HonoBindings>
): Promise<Response> {
  const target = parseEntryTarget(c, SPACE_FILE_CONTENT_ROUTE, "GET");
  if (!target.ok) {
    return target.response;
  }
  const query = spaceFileContentQuerySchema.safeParse({
    ...(c.req.query("revision") === undefined
      ? {}
      : { revision: c.req.query("revision") }),
  });
  if (!query.success) {
    return respondFileError({
      c,
      route: SPACE_FILE_CONTENT_ROUTE,
      method: "GET",
      spaceId: target.spaceId,
      status: 400,
      code: "invalid_payload",
      message: query.error.issues[0]?.message ?? "Invalid file revision.",
    });
  }
  let resolved: ResolveSpaceFileContentResponse & {
    bytes: ReadableStream<Uint8Array>;
  };
  try {
    const response = await c.var.coreRpc.streamSpaceFileContent({
      spaceId: target.spaceId,
      content: {
        spaceId: target.spaceId,
        fileId: target.entryId,
        revision: query.data.revision,
      },
      spaceAccess: buildGatewaySpaceAccessContext(c, target.spaceId),
      context: buildCoreRpcContext(c),
    });
    const { bytes, ...metadata } = response;
    resolved = {
      ...resolveSpaceFileContentResponseSchema.parse(metadata),
      bytes,
    };
    if (!(resolved.bytes instanceof ReadableStream)) {
      throw new Error("Core returned invalid Space file bytes.");
    }
  } catch (error) {
    return respondCoreFileError({
      c,
      error,
      route: SPACE_FILE_CONTENT_ROUTE,
      method: "GET",
      spaceId: target.spaceId,
    });
  }
  logFileSuccess(c, SPACE_FILE_CONTENT_ROUTE, "GET", target.spaceId, 200);
  const content = resolved.bytes.pipeThrough(
    // biome-ignore lint/correctness/noUndeclaredVariables: Workers native stream detects truncated downloads without buffering.
    new FixedLengthStream(resolved.revision.sizeBytes)
  );
  return withRequestIdHeader(
    new Response(content, {
      headers: {
        "cache-control": PRIVATE_CONTENT_CACHE_CONTROL,
        "content-disposition": buildContentDisposition(resolved.file.name),
        "content-type": resolved.revision.mimeType,
        "x-content-type-options": "nosniff",
        "x-openmeld-file-revision": String(resolved.revision.revision),
      },
    }),
    c.var.openMeldRequestContext.actorContext.requestId
  );
}

async function persistSpaceFileRevision(input: {
  bytes: ArrayBuffer;
  c: Context<HonoBindings>;
  method: "POST" | "PUT";
  route: string;
  write: CommitSpaceFileWriteInput;
}): Promise<
  { ok: true; file: SpaceFileDescriptor } | { ok: false; response: Response }
> {
  try {
    const file = uploadSpaceFileResponseSchema.shape.file.parse(
      await input.c.var.coreRpc.writeSpaceFileContent({
        bytes: input.bytes,
        spaceId: input.write.spaceId,
        write: input.write,
        spaceAccess: buildGatewaySpaceAccessContext(
          input.c,
          input.write.spaceId
        ),
        context: buildCoreRpcContext(input.c),
      })
    );
    logFileSuccess(
      input.c,
      input.route,
      input.method,
      input.write.spaceId,
      input.method === "POST" ? 201 : 200
    );
    return { ok: true, file };
  } catch (error) {
    return {
      ok: false,
      response: respondCoreFileError({
        c: input.c,
        error,
        route: input.route,
        method: input.method,
        spaceId: input.write.spaceId,
      }),
    };
  }
}

async function readSpaceFileBody(input: {
  c: Context<HonoBindings>;
  method: "POST" | "PUT";
  route: string;
  spaceId: string;
}): Promise<
  | { ok: true; bytes: ArrayBuffer; mimeType: string }
  | { ok: false; response: Response }
> {
  const { c, method, route, spaceId } = input;
  const declaredLength = Number(c.req.raw.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES
  ) {
    return {
      ok: false,
      response: respondFileError({
        c,
        route,
        method,
        spaceId,
        status: 413,
        code: "space_file.too_large",
        message: "Files must be 10 MiB or smaller.",
      }),
    };
  }
  const mimeType = spaceFileMimeTypeSchema.safeParse(
    (c.req.raw.headers.get("content-type") ?? "application/octet-stream")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase()
  );
  if (!mimeType.success) {
    return {
      ok: false,
      response: respondFileError({
        c,
        route,
        method,
        spaceId,
        status: 415,
        code: "space_file.type_unsupported",
        message: "This file type is not supported.",
      }),
    };
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await readRawFileBody(c.req.raw.body);
  } catch (error) {
    return {
      ok: false,
      response: respondFileError({
        c,
        route,
        method,
        spaceId,
        status: error instanceof RangeError ? 413 : 400,
        code:
          error instanceof RangeError
            ? "space_file.too_large"
            : "invalid_payload",
        message:
          error instanceof RangeError
            ? "Use multipart upload for files larger than 10 MiB."
            : "File contents could not be read.",
      }),
    };
  }
  if (bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      response: respondFileError({
        c,
        route,
        method,
        spaceId,
        status: 413,
        code: "space_file.too_large",
        message: "Files must be 10 MiB or smaller.",
      }),
    };
  }
  return { ok: true, bytes, mimeType: mimeType.data };
}

async function readRawFileBody(
  body: ReadableStream<Uint8Array> | null
): Promise<ArrayBuffer> {
  if (!body) {
    return new ArrayBuffer(0);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
        throw new RangeError("Raw upload is too large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function parseTarget(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): { ok: true; spaceId: string } | { ok: false; response: Response } {
  const parsed = parseSpaceRouteParams(c.req.param("spaceId"));
  if (parsed.ok) {
    return { ok: true, spaceId: parsed.value.spaceId };
  }
  return {
    ok: false,
    response: respondFileError({
      c,
      route,
      method,
      status: 400,
      code: "invalid_space_id",
      message: parsed.message,
      reason: `invalid_space_id_param spaceId=${formatAuditValue(c.req.param("spaceId"))}`,
    }),
  };
}

function parseEntryTarget(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
):
  | { ok: true; spaceId: string; entryId: string }
  | { ok: false; response: Response } {
  const target = parseTarget(c, route, method);
  if (!target.ok) {
    return target;
  }
  const entryId = spaceFileEntryIdSchema.safeParse(c.req.param("entryId"));
  if (!entryId.success) {
    return {
      ok: false,
      response: respondFileError({
        c,
        route,
        method,
        spaceId: target.spaceId,
        status: 400,
        code: "invalid_payload",
        message: "File or folder ID is invalid.",
      }),
    };
  }
  return { ok: true, spaceId: target.spaceId, entryId: entryId.data };
}

function respondInvalidBody(
  c: Context<HonoBindings>,
  spaceId: string,
  route: string,
  method: "DELETE" | "PATCH" | "POST",
  parsed: { success: false; error: { issues: Array<{ message: string }> } }
): Response {
  return respondFileError({
    c,
    route,
    method,
    spaceId,
    status: 400,
    code: "invalid_payload",
    message: parsed.error.issues[0]?.message ?? "Invalid Space Files request.",
  });
}

function respondCoreFileError(input: {
  c: Context<HonoBindings>;
  error: unknown;
  method: RpcHttpMethod;
  route: string;
  spaceId: string;
}): Response {
  const requestId = input.c.var.openMeldRequestContext.actorContext.requestId;
  const structured = resolveGatewayStructuredRpcErrorResponse({
    err: input.error,
    requestId,
  });
  if (structured) {
    return respondFileError({
      c: input.c,
      route: input.route,
      method: input.method,
      spaceId: input.spaceId,
      status: structured.status,
      code: structured.code,
      message: structured.message,
      reason: structured.upstreamCode,
    });
  }
  return respondFileError({
    c: input.c,
    route: input.route,
    method: input.method,
    spaceId: input.spaceId,
    status: 502,
    code: "upstream_unreachable",
    message: toErrorMessage(input.error),
  });
}

function respondFileError(input: {
  c: Context<HonoBindings>;
  code: GatewayErrorCode;
  message: string;
  method: RpcHttpMethod;
  reason?: string;
  route: string;
  spaceId?: string;
  status: number;
}): Response {
  logAuditEvent({
    event: input.status >= 500 ? "http.forward.error" : "http.forward",
    route: input.route,
    method: input.method,
    status: input.status,
    latencyMs: Date.now() - input.c.var.startedAt,
    errorCode: input.code,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    ...(input.reason ? { reason: formatAuditValue(input.reason, 320) } : {}),
    ...contextAuditFields(input.c.var.openMeldRequestContext),
  });
  return jsonErrorResponse({
    status: input.status,
    code: input.code,
    message: input.message,
    requestId: input.c.var.openMeldRequestContext.actorContext.requestId,
  });
}

function logFileSuccess(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  spaceId: string,
  status: number
): void {
  logAuditEvent({
    event: "http.forward",
    route,
    method,
    status,
    latencyMs: Date.now() - c.var.startedAt,
    spaceId,
    ...contextAuditFields(c.var.openMeldRequestContext),
  });
}

function buildContentDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
