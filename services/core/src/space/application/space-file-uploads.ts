import { createHash } from "node:crypto";
import {
  SPACE_FILE_UPLOAD_PART_BYTES,
  SPACE_FILE_UPLOAD_TTL_MS,
  spaceComposerUploadIdSchema,
  spaceFileUploadCommandSchema,
} from "@openmeld/schemas";
import type {
  SpaceFileUploadCommand,
  SpaceFileUploadMetadata,
  SpaceFileUploadResponse,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";

type UploadState = {
  actorId: string;
  metadata: SpaceFileUploadMetadata;
  key: string;
  multipartId: string;
  response: SpaceFileUploadResponse;
  lease?: { id: string; until: number };
};

type UploadInput = {
  uploadId: string;
  actorId: string;
  scope: string;
  command: SpaceFileUploadCommand;
  body?: ReadableStream<Uint8Array>;
  prepare?: (metadata: SpaceFileUploadMetadata) => Promise<void>;
  finish: (
    metadata: SpaceFileUploadMetadata,
    key: string
  ) => Promise<Pick<SpaceFileUploadResponse, "file" | "upload">>;
};

/** Space-owned sessions; R2 identifiers never leave the server. */
export class SpaceFileUploads {
  private readonly sql: SqlStorage;
  private readonly bucket: R2Bucket;
  constructor(sql: SqlStorage, bucket: R2Bucket) {
    this.sql = sql;
    this.bucket = bucket;
    sql.exec(`CREATE TABLE IF NOT EXISTS space_file_upload_sessions (
      id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, state TEXT NOT NULL
    )`);
  }

  async execute(input: UploadInput): Promise<SpaceFileUploadResponse> {
    const parsedId = spaceComposerUploadIdSchema.safeParse(input.uploadId);
    const parsedCommand = spaceFileUploadCommandSchema.safeParse(input.command);
    if (!(parsedId.success && parsedCommand.success)) {
      fail("Invalid upload request.", 400);
    }
    const id = parsedId.data;
    const command = parsedCommand.data;
    const state = this.read(id);
    if (state && state.actorId !== input.actorId) {
      fail("Upload not found.", 404);
    }
    if (state && Date.parse(state.response.expiresAt) <= Date.now()) {
      fail("This upload expired. Choose the file again.", 410);
    }
    if (command.action === "start") {
      return await this.start(input, command.metadata, state);
    }
    return await this.update(input, command, state);
  }

  private async start(
    input: UploadInput,
    metadata: SpaceFileUploadMetadata,
    existing?: UploadState
  ): Promise<SpaceFileUploadResponse> {
    const id = input.uploadId;
    if (
      metadata.partDigests.length !==
      Math.ceil(metadata.sizeBytes / SPACE_FILE_UPLOAD_PART_BYTES)
    ) {
      fail("Invalid upload checksums.", 400);
    }
    if (existing) {
      if (JSON.stringify(existing.metadata) !== JSON.stringify(metadata)) {
        fail("This upload ID was already used for a different file.", 409);
      }
      return existing.response;
    }
    await input.prepare?.(metadata);
    const key = `multipart-uploads/v1/${input.scope}/${input.actorId}/${id}`;
    const multipart = await this.bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: metadata.mimeType },
    });
    const state: UploadState = {
      actorId: input.actorId,
      metadata,
      key,
      multipartId: multipart.uploadId,
      response: {
        uploadId: id,
        expiresAt: new Date(
          Date.now() + SPACE_FILE_UPLOAD_TTL_MS
        ).toISOString(),
        partSizeBytes: SPACE_FILE_UPLOAD_PART_BYTES,
        parts: [],
      },
    };
    // A racing start must not replace an existing session or orphan its MPU.
    if (this.read(id)) {
      await multipart.abort();
      return await this.execute(input);
    }
    this.save(id, state);
    return state.response;
  }

  private async update(
    input: UploadInput,
    command: Exclude<SpaceFileUploadCommand, { action: "start" }>,
    state?: UploadState
  ): Promise<SpaceFileUploadResponse> {
    const id = input.uploadId;
    if (!state) {
      fail("Upload not found. Choose the file again.", 404);
    }
    if (command.action === "status") {
      return state.response;
    }
    if (state.response.cancelled) {
      if (command.action === "cancel") {
        return state.response;
      }
      fail("This upload was cancelled.", 409);
    }
    if (state.response.file || state.response.upload) {
      if (command.action === "complete") {
        return state.response;
      }
      fail("This upload is already complete.", 409);
    }
    if (state.lease && state.lease.until > Date.now()) {
      fail(
        "This upload is still processing a request. Try again shortly.",
        503
      );
    }
    const leaseId = crypto.randomUUID();
    state.lease = { id: leaseId, until: Date.now() + 5 * 60 * 1000 };
    this.save(id, state);
    const multipart = this.bucket.resumeMultipartUpload(
      state.key,
      state.multipartId
    );
    try {
      if (command.action === "cancel") {
        await multipart.abort();
        await this.bucket.delete(state.key);
        state.response.cancelled = true;
      } else if (command.action === "part") {
        await uploadPart(state, multipart, command.partNumber, input.body);
      } else {
        await this.completeObject(state, multipart);
        Object.assign(
          state.response,
          await input.finish(state.metadata, state.key)
        );
      }
      if (this.read(id)?.lease?.id !== leaseId) {
        fail("This upload request was superseded. Retry it.", 409);
      }
      state.lease = undefined;
      this.save(id, state);
      return state.response;
    } catch (error) {
      const current = this.read(id);
      if (current?.lease?.id === leaseId) {
        current.lease = undefined;
        this.save(id, current);
      }
      throw error;
    }
  }

  private async completeObject(
    state: UploadState,
    multipart: R2MultipartUpload
  ) {
    const parts = state.response.parts;
    const count = Math.ceil(
      state.metadata.sizeBytes / SPACE_FILE_UPLOAD_PART_BYTES
    );
    if (
      parts.length !== count ||
      parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      fail(
        "Some parts are missing. Resume the upload before completing it.",
        409
      );
    }
    // A lost completion response is recovered from the session's private object.
    const object =
      (await this.bucket.head(state.key)) ?? (await multipart.complete(parts));
    if (object.size !== state.metadata.sizeBytes) {
      fail("The uploaded file is incomplete.", 409);
    }
  }

  nextExpiry(): number | null {
    return (
      this.sql
        .exec<{ expiry: number | null }>(
          "SELECT MIN(expires_at) AS expiry FROM space_file_upload_sessions"
        )
        .toArray()[0]?.expiry ?? null
    );
  }

  async cleanup(): Promise<void> {
    const rows = this.sql
      .exec<{ id: string; state: string }>(
        "SELECT id, state FROM space_file_upload_sessions WHERE expires_at <= ? LIMIT 32",
        Date.now()
      )
      .toArray();
    for (const row of rows) {
      const state: UploadState = JSON.parse(row.state);
      if (!((await this.bucket.head(state.key)) || state.response.cancelled)) {
        await this.bucket
          .resumeMultipartUpload(state.key, state.multipartId)
          .abort();
      }
      await this.bucket.delete(state.key);
      this.sql.exec(
        "DELETE FROM space_file_upload_sessions WHERE id = ?",
        row.id
      );
    }
  }

  private read(id: string): UploadState | undefined {
    const row = this.sql
      .exec<{ state: string }>(
        "SELECT state FROM space_file_upload_sessions WHERE id = ?",
        id
      )
      .toArray()[0];
    return row ? JSON.parse(row.state) : undefined;
  }

  private save(id: string, state: UploadState): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO space_file_upload_sessions (id, expires_at, state) VALUES (?, ?, ?)",
      id,
      Date.parse(state.response.expiresAt),
      JSON.stringify(state)
    );
  }
}

async function uploadPart(
  state: UploadState,
  multipart: R2MultipartUpload,
  partNumber: number,
  body?: ReadableStream<Uint8Array>
) {
  if (!body) {
    fail("The upload part is empty.", 400);
  }
  const expected = Math.min(
    SPACE_FILE_UPLOAD_PART_BYTES,
    state.metadata.sizeBytes - (partNumber - 1) * SPACE_FILE_UPLOAD_PART_BYTES
  );
  const digest = state.metadata.partDigests[partNumber - 1];
  if (expected <= 0 || !digest) {
    fail("Invalid upload part number.", 400);
  }
  // biome-ignore lint/correctness/noUndeclaredVariables: Workers native stream enforces the declared R2 part length.
  const fixed = new FixedLengthStream(expected);
  const [part] = await Promise.all([
    multipart.uploadPart(partNumber, fixed.readable),
    transferPart(body, fixed.writable, digest),
  ]);
  state.response.parts = state.response.parts.filter(
    (p) => p.partNumber !== partNumber
  );
  state.response.parts.push({ ...part, sizeBytes: expected });
  state.response.parts.sort((a, b) => a.partNumber - b.partNumber);
}

function fail(reason: string, status: 400 | 404 | 409 | 410 | 503): never {
  throw createCoreRpcHttpError({
    code: (
      {
        400: "invalid_payload",
        404: "space_file.not_found",
        409: "space_file.conflict",
        410: "space_file.not_found",
        503: "space_file.storage_failed",
      } as const
    )[status],
    reason,
    status,
  });
}

async function transferPart(
  body: ReadableStream<Uint8Array>,
  destination: WritableStream<Uint8Array>,
  expectedDigest: string
) {
  const reader = body.getReader();
  const writer = destination.getWriter();
  const hash = createHash("sha256");
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      hash.update(chunk.value);
      await writer.write(chunk.value);
    }
    if (hash.digest("hex") !== expectedDigest) {
      fail(
        "The upload part does not match the selected file. Choose the file again.",
        409
      );
    }
    await writer.close();
  } catch (error) {
    await Promise.allSettled([reader.cancel(error), writer.abort(error)]);
    throw error;
  } finally {
    reader.releaseLock();
    writer.releaseLock();
  }
}
