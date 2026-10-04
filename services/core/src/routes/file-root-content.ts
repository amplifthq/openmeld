import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  commitSpaceFileWriteInputSchema,
  copyFileRootRevisionBodySchema,
  copyFileRootRevisionResponseSchema,
  copyFileRootToSpaceBodySchema,
  createSpaceFileUploadQuerySchema,
  fileRootFileDescriptorSchema,
  fileRootUploadResponseSchema,
  resolveSpaceFileStreamMetadata,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileDescriptorSchema,
  spaceFileMimeTypeSchema,
  spaceFileRevisionNumberSchema,
  spaceFileStreamOptionsSchema,
  spaceFileUploadCommandSchema,
  updateSpaceFileContentQuerySchema,
} from "@openmeld/schemas";
import type {
  CopyFileRootRevisionBody,
  FileRoot,
  SpaceFileRevision,
} from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import type { Context, Hono } from "hono";
import { buildOrganizationFileObjectKey } from "../files/file-root-identity";
import type { HonoBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { rpcStreamSpaceFileContent } from "../rpc/methods";
import { resolveSpaceStub } from "../rpc/space-ref";
import { hashSpaceFileStream } from "../space/application/space-file-stream";
import {
  resolveFileRootTarget,
  resolveTarget,
  rootRequest,
  toFileRootEntry,
} from "./file-roots";
import { mapRpcHttpError } from "./rpc-http-error";
import { registerSpaceFileExcerptRoutes } from "./space-file-excerpts";

const ROOT_ROUTE = "/v1/organizations/current/files/:location";
const CONTENT_ROUTE = `${ROOT_ROUTE}/:entryId/content`;
const MULTIPART_ROUTE = `${ROOT_ROUTE}/file-uploads/:uploadId`;
const COPY_TO_SPACE_ROUTE = "/v1/spaces/:spaceId/files/copies";

export function registerFileRootContentRoutes(app: Hono<HonoBindings>): void {
  registerSpaceFileExcerptRoutes(app);
  app.post(ROOT_ROUTE, (c) => upload(c));
  app.post(`${ROOT_ROUTE}/copies`, (c) => copyRevision(c));
  app.post(COPY_TO_SPACE_ROUTE, (c) => copyToSpace(c));
  app.post(MULTIPART_ROUTE, (c) => multipartUpload(c));
  app.put(CONTENT_ROUTE, (c) => update(c));
  app.get(CONTENT_ROUTE, (c) => read(c));
  app.on("HEAD", CONTENT_ROUTE, (c) => read(c));
}

async function copyToSpace(c: Context<HonoBindings>): Promise<Response> {
  const body = copyFileRootToSpaceBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return invalid(c);
  }
  const spaceId = c.req.param("spaceId");
  const stub = resolveSpaceStub(c.env.OPENMELD_SPACES, spaceId);
  if (!stub) {
    return c.json(
      { error: { code: "space.not_found", message: "Space not found." } },
      404
    );
  }
  const spaceAccess = createAuthenticatedSpaceAccessContext({
    spaceId,
    requestContext: c.var.openMeldRequestContext,
    password: c.var.spacePassword,
  });
  try {
    const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
    if (!bucket) {
      throw storageUnavailable();
    }
    const source = await openCopySource(c, body.data, bucket);
    if (source instanceof Response) {
      return source;
    }
    const digest = await hashSpaceFileStream(source.bytes);
    const [fileId, revisionId] = await Promise.all([
      buildSpaceFileEntryIdForMutation(body.data.clientMutationId),
      buildSpaceFileRevisionIdFromDigest({
        baseRevision: null,
        contentDigest: digest,
        clientMutationId: body.data.clientMutationId,
        mimeType: source.revision.mimeType,
        name: body.data.name,
        parentId: body.data.parentId,
      }),
    ]);
    const write = commitSpaceFileWriteInputSchema.parse({
      spaceId,
      fileId,
      revisionId,
      name: body.data.name,
      parentId: body.data.parentId,
      baseRevision: null,
      clientMutationId: body.data.clientMutationId,
      mimeType: source.revision.mimeType,
      sizeBytes: source.revision.sizeBytes,
    });
    const prepared = await stub.rpcPrepareSpaceFileWrite({
      spaceAccess,
      write,
    });
    if (prepared.organizationId !== source.root.organizationId) {
      throw createCoreRpcHttpError({
        code: "space.not_found",
        reason: "Space not found.",
        status: 404,
      });
    }
    await stub.rpcReserveSpaceFileCopy({
      spaceAccess,
      spaceId,
      clientMutationId: body.data.clientMutationId,
      sourceRoot: source.root,
      sourceFileId: body.data.sourceFileId,
      sourceRevisionId: source.revision.id,
      name: body.data.name,
      parentId: body.data.parentId,
    });
    await source.recordAudit();
    if (prepared.committedFile) {
      return c.json(
        { file: spaceFileDescriptorSchema.parse(prepared.committedFile) },
        201
      );
    }
    const bytes = await source.reopen();
    await bucket.put(prepared.objectKey, bytes, {
      httpMetadata: { contentType: source.revision.mimeType },
      customMetadata: {
        sourceRoot: JSON.stringify(source.root),
        sourceFileId: body.data.sourceFileId,
        sourceRevisionId: source.revision.id,
      },
    });
    await source.recheckAccess();
    const file = await stub.rpcCommitSpaceFileWrite({ spaceAccess, write });
    return c.json({ file: spaceFileDescriptorSchema.parse(file) }, 201);
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function copyRevision(c: Context<HonoBindings>): Promise<Response> {
  const destination = resolveTarget(c);
  if (destination instanceof Response) {
    return destination;
  }
  const body = copyFileRootRevisionBodySchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!body.success) {
    return invalid(c);
  }
  try {
    const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
    if (!bucket) {
      throw storageUnavailable();
    }
    const source = await openCopySource(c, body.data, bucket);
    if (source instanceof Response) {
      return source;
    }
    const digest = await hashSpaceFileStream(source.bytes);
    const [fileId, revisionId] = await Promise.all([
      buildSpaceFileEntryIdForMutation(body.data.clientMutationId),
      buildSpaceFileRevisionIdFromDigest({
        baseRevision: null,
        contentDigest: digest,
        clientMutationId: body.data.clientMutationId,
        mimeType: source.revision.mimeType,
        name: body.data.name,
        parentId: body.data.parentId,
      }),
    ]);
    const write = commitSpaceFileWriteInputSchema.parse({
      spaceId: destination.rootId,
      fileId,
      revisionId,
      name: body.data.name,
      parentId: body.data.parentId,
      baseRevision: null,
      clientMutationId: body.data.clientMutationId,
      mimeType: source.revision.mimeType,
      sizeBytes: source.revision.sizeBytes,
    });
    await destination.stub.reserveCopy({
      ...rootRequest(destination),
      clientMutationId: body.data.clientMutationId,
      sourceRoot: source.root,
      sourceFileId: body.data.sourceFileId,
      sourceRevisionId: source.revision.id,
      name: body.data.name,
      parentId: body.data.parentId,
    });
    await source.recordAudit();
    let file = await destination.stub.prepareWrite({
      ...rootRequest(destination),
      write,
    });
    if (!file) {
      const bytes = await source.reopen();
      const destinationKey = buildOrganizationFileObjectKey({
        root: destination.root,
        fileId,
        revisionId,
      });
      await bucket.put(destinationKey, bytes, {
        httpMetadata: { contentType: source.revision.mimeType },
        customMetadata: {
          sourceRoot: JSON.stringify(source.root),
          sourceFileId: body.data.sourceFileId,
          sourceRevisionId: source.revision.id,
        },
      });
      await source.recheckAccess();
      file = await destination.stub.commitWrite({
        ...rootRequest(destination),
        write,
      });
    }
    return c.json(
      copyFileRootRevisionResponseSchema.parse({
        file: toFileRootEntry(destination.root, file),
        source: {
          root: source.root,
          fileId: body.data.sourceFileId,
          revision: body.data.sourceRevision,
          revisionId: source.revision.id,
        },
      }),
      201
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function openCopySource(
  c: Context<HonoBindings>,
  body: CopyFileRootRevisionBody,
  bucket: R2Bucket
): Promise<
  | Response
  | {
      root: FileRoot;
      revision: SpaceFileRevision;
      bytes: ReadableStream<Uint8Array>;
      reopen: () => Promise<ReadableStream<Uint8Array>>;
      recheckAccess: () => Promise<void>;
      recordAudit: () => Promise<void>;
    }
> {
  if (body.sourceLocation === "space") {
    const spaceId = body.sourceSpaceId;
    const stub = resolveSpaceStub(c.env.OPENMELD_SPACES, spaceId);
    if (!stub) {
      return c.json(
        { error: { code: "space.not_found", message: "Space not found." } },
        404
      );
    }
    const spaceAccess = createAuthenticatedSpaceAccessContext({
      spaceId,
      requestContext: c.var.openMeldRequestContext,
      password: c.var.spacePassword,
    });
    const read = () =>
      rpcStreamSpaceFileContent(c.env, {
        spaceId,
        spaceAccess,
        content: {
          spaceId,
          fileId: body.sourceFileId,
          revision: body.sourceRevision,
        },
      });
    const first = await read();
    const organizationId = c.var.openMeldRequestContext.activeOrganizationId;
    if (!organizationId || first.organizationId !== organizationId) {
      await first.bytes.cancel();
      throw createCoreRpcHttpError({
        code: "space.not_found",
        reason: "Space not found.",
        status: 404,
      });
    }
    const reopen = async () => {
      const current = await read();
      if (
        current.organizationId !== organizationId ||
        current.revision.id !== first.revision.id
      ) {
        await current.bytes.cancel();
        throw storageUnavailable();
      }
      return current.bytes;
    };
    return {
      root: { kind: "space", organizationId, spaceId },
      revision: first.revision,
      bytes: first.bytes,
      reopen,
      recheckAccess: async () => {
        const current = await stub.rpcResolveSpaceFileContent({
          spaceAccess,
          content: {
            spaceId,
            fileId: body.sourceFileId,
            revision: body.sourceRevision,
          },
        });
        if (
          current.organizationId !== organizationId ||
          current.revision.id !== first.revision.id
        ) {
          throw storageUnavailable();
        }
      },
      recordAudit: async () => undefined,
    };
  }
  const target = resolveFileRootTarget(c, body.sourceLocation);
  if (target instanceof Response) {
    return target;
  }
  const resolved = await target.stub.resolveRevision({
    ...rootRequest(target),
    fileId: body.sourceFileId,
    revision: body.sourceRevision,
  });
  const key = buildOrganizationFileObjectKey({
    root: target.root,
    fileId: body.sourceFileId,
    revisionId: resolved.revision.id,
  });
  const getBytes = async () => {
    const object = await bucket.get(key);
    if (!object || object.size !== resolved.revision.sizeBytes) {
      throw storageUnavailable();
    }
    return object.body;
  };
  const recheckAccess = async () => {
    await target.stub.resolveRevision({
      ...rootRequest(target),
      fileId: body.sourceFileId,
      revision: body.sourceRevision,
    });
  };
  return {
    root: target.root,
    revision: resolved.revision,
    bytes: await getBytes(),
    reopen: async () => {
      await recheckAccess();
      return getBytes();
    },
    recheckAccess,
    recordAudit: () =>
      target.stub.recordContentAudit({
        ...rootRequest(target),
        entryId: body.sourceFileId,
        revisionId: resolved.revision.id,
        operation: "content_read",
        operationId: body.clientMutationId,
      }),
  };
}

async function multipartUpload(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const command = spaceFileUploadCommandSchema.safeParse(
    c.req.query("part")
      ? { action: "part", partNumber: Number(c.req.query("part")) }
      : await c.req.json().catch(() => null)
  );
  if (!command.success) {
    return invalid(c);
  }
  try {
    const result = await target.stub.upload({
      ...rootRequest(target),
      uploadId: c.req.param("uploadId"),
      command: command.data,
      ...(command.data.action === "part" && c.req.raw.body
        ? { body: c.req.raw.body }
        : {}),
    });
    return c.json(
      fileRootUploadResponseSchema.parse({
        ...result,
        ...(result.file
          ? { file: toFileRootEntry(target.root, result.file) }
          : {}),
      })
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function upload(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const query = createSpaceFileUploadQuerySchema.safeParse({
    name: c.req.query("name"),
    parentId: c.req.query("parentId"),
    clientMutationId: c.req.query("clientMutationId"),
    origin: c.req.query("origin"),
  });
  if (!query.success || query.data.origin === "chat_upload") {
    return invalid(c);
  }
  const body = await readBoundedBody(c);
  if (body instanceof Response) {
    return body;
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
  const write = commitSpaceFileWriteInputSchema.parse({
    spaceId: target.rootId,
    fileId,
    revisionId,
    name: query.data.name,
    parentId: query.data.parentId ?? null,
    baseRevision: null,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
    sizeBytes: body.bytes.byteLength,
  });
  try {
    const file = await target.stub.writeContent({
      ...rootRequest(target),
      write,
      bytes: body.bytes,
    });
    return c.json(
      {
        file: fileRootFileDescriptorSchema.parse(
          toFileRootEntry(target.root, file)
        ),
      },
      201
    );
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function update(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const query = updateSpaceFileContentQuerySchema.safeParse({
    baseRevision: c.req.query("baseRevision"),
    clientMutationId: c.req.query("clientMutationId"),
  });
  if (!query.success) {
    return invalid(c);
  }
  const body = await readBoundedBody(c);
  if (body instanceof Response) {
    return body;
  }
  const revisionId = await buildSpaceFileRevisionIdForMutation({
    baseRevision: query.data.baseRevision,
    bytes: body.bytes,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
  });
  const write = commitSpaceFileWriteInputSchema.parse({
    spaceId: target.rootId,
    fileId: c.req.param("entryId"),
    revisionId,
    baseRevision: query.data.baseRevision,
    clientMutationId: query.data.clientMutationId,
    mimeType: body.mimeType,
    sizeBytes: body.bytes.byteLength,
  });
  try {
    const file = await target.stub.writeContent({
      ...rootRequest(target),
      write,
      bytes: body.bytes,
    });
    return c.json({
      file: fileRootFileDescriptorSchema.parse(
        toFileRootEntry(target.root, file)
      ),
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}

async function readBoundedBody(
  c: Context<HonoBindings>
): Promise<{ bytes: ArrayBuffer; mimeType: string } | Response> {
  const mimeType = spaceFileMimeTypeSchema.safeParse(
    (c.req.header("content-type") ?? "application/octet-stream")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase()
  );
  if (!mimeType.success) {
    return invalid(c);
  }
  const reader = c.req.raw.body?.getReader();
  if (!reader) {
    return { bytes: new ArrayBuffer(0), mimeType: mimeType.data };
  }
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
        return c.json(
          {
            error: {
              code: "file_root.too_large",
              message: "Use a multipart upload for files larger than 10 MiB.",
            },
          },
          413
        );
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes: bytes.buffer, mimeType: mimeType.data };
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function invalid(c: Context<HonoBindings>): Response {
  return c.json(
    { error: { code: "invalid_payload", message: "Invalid file request." } },
    400
  );
}

function storageUnavailable(): Error {
  return createCoreRpcHttpError({
    code: "file_root.storage_failed",
    reason: "This file revision is unavailable.",
    status: 503,
  });
}

async function openStoredContent(input: {
  bucket: R2Bucket;
  key: string;
  sizeBytes: number;
  head: boolean;
  status: number;
  offset: number;
  length: number;
}): Promise<ReadableStream<Uint8Array> | null> {
  if (input.status === 416) {
    return null;
  }
  const object = input.head
    ? await input.bucket.head(input.key)
    : await input.bucket.get(
        input.key,
        input.status === 206
          ? { range: { offset: input.offset, length: input.length } }
          : undefined
      );
  if (!object || object.size !== input.sizeBytes) {
    throw storageUnavailable();
  }
  if (input.head) {
    return null;
  }
  if (!("body" in object && object.body instanceof ReadableStream)) {
    throw storageUnavailable();
  }
  return object.body;
}

function responseLength(input: {
  status: number;
  rangeLength: number;
  sizeBytes: number;
}): number {
  if (input.status === 416) {
    return 0;
  }
  if (input.status === 206) {
    return input.rangeLength;
  }
  return input.sizeBytes;
}

async function read(c: Context<HonoBindings>): Promise<Response> {
  const target = resolveTarget(c);
  if (target instanceof Response) {
    return target;
  }
  const rawRevision = c.req.query("revision");
  const revision =
    rawRevision === undefined
      ? undefined
      : spaceFileRevisionNumberSchema.safeParse(Number(rawRevision));
  if (revision && !revision.success) {
    return invalid(c);
  }
  const options = spaceFileStreamOptionsSchema.safeParse({
    head: c.req.method === "HEAD",
    ...(c.req.header("Range") ? { range: c.req.header("Range") } : {}),
    ...(c.req.header("If-Range") ? { ifRange: c.req.header("If-Range") } : {}),
  });
  if (!options.success) {
    return invalid(c);
  }
  const fileId = c.req.param("entryId");
  try {
    const resolved = await target.stub.resolveRevision({
      ...rootRequest(target),
      fileId,
      ...(revision?.success ? { revision: revision.data } : {}),
    });
    const stream = resolveSpaceFileStreamMetadata({
      options: options.data,
      revisionId: resolved.revision.id,
      sizeBytes: resolved.revision.sizeBytes,
    });
    const bucket = c.env.OPENMELD_SPACE_ATTACHMENTS;
    if (!bucket) {
      throw storageUnavailable();
    }
    const key = buildOrganizationFileObjectKey({
      root: target.root,
      fileId,
      revisionId: resolved.revision.id,
    });
    let content: ReadableStream<Uint8Array> | null = null;
    try {
      content = await openStoredContent({
        bucket,
        key,
        sizeBytes: resolved.revision.sizeBytes,
        head: options.data.head === true,
        status: stream.status,
        offset: stream.status === 206 ? stream.offset : 0,
        length: stream.status === 206 ? stream.length : 0,
      });
    } catch {
      await target.stub.recordContentAudit({
        ...rootRequest(target),
        entryId: fileId,
        revisionId: resolved.revision.id,
        operation: "content_read",
        operationId: target.context.actorContext.requestId,
        errorCode: "file_root.storage_failed",
      });
      throw storageUnavailable();
    }
    await target.stub.recordContentAudit({
      ...rootRequest(target),
      entryId: fileId,
      revisionId: resolved.revision.id,
      operation: "content_read",
      operationId: target.context.actorContext.requestId,
    });
    const length = responseLength({
      status: stream.status,
      rangeLength: stream.status === 206 ? stream.length : 0,
      sizeBytes: resolved.revision.sizeBytes,
    });
    const body =
      content && c.req.method !== "HEAD"
        ? content.pipeThrough(
            // biome-ignore lint/correctness/noUndeclaredVariables: Workers native stream detects truncated downloads.
            new FixedLengthStream(length)
          )
        : null;
    return new Response(body, {
      status: stream.status,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
        "content-length": String(length),
        "content-type": resolved.revision.mimeType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resolved.file.name)}`,
        etag: stream.etag,
        "x-content-type-options": "nosniff",
        "x-openmeld-file-revision": String(resolved.revision.revision),
        ...(stream.status === 206
          ? {
              "content-range": `bytes ${stream.offset}-${stream.offset + stream.length - 1}/${resolved.revision.sizeBytes}`,
            }
          : {}),
        ...(stream.status === 416
          ? { "content-range": `bytes */${resolved.revision.sizeBytes}` }
          : {}),
      },
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}
