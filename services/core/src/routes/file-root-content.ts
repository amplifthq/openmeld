import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
  commitSpaceFileWriteInputSchema,
  createSpaceFileUploadQuerySchema,
  fileRootFileDescriptorSchema,
  resolveSpaceFileStreamMetadata,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileMimeTypeSchema,
  spaceFileRevisionNumberSchema,
  spaceFileStreamOptionsSchema,
  updateSpaceFileContentQuerySchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import { buildOrganizationFileObjectKey } from "../files/file-root-identity";
import type { HonoBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { resolveTarget, rootRequest, toFileRootEntry } from "./file-roots";
import { mapRpcHttpError } from "./rpc-http-error";

const ROOT_ROUTE = "/v1/organizations/current/files/:location";
const CONTENT_ROUTE = `${ROOT_ROUTE}/:entryId/content`;

export function registerFileRootContentRoutes(app: Hono<HonoBindings>): void {
  app.post(ROOT_ROUTE, (c) => upload(c));
  app.put(CONTENT_ROUTE, (c) => update(c));
  app.get(CONTENT_ROUTE, (c) => read(c));
  app.on("HEAD", CONTENT_ROUTE, (c) => read(c));
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
