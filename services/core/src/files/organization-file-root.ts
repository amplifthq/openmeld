import { DurableObject } from "cloudflare:workers";
import {
  getPostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  type AccountDeletionFileRoot,
  accountDeletionFileRootSchema,
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdFromDigest,
  commitSpaceFileWriteInputSchema,
  createSpaceFolderBodySchema,
  listSpaceFilesQuerySchema,
  restoreSpaceFileEntryBodySchema,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceFileAuditEventSchema,
  spaceFileUploadCommandSchema,
  trashSpaceFileEntryBodySchema,
  updateSpaceFileEntryBodySchema,
} from "@openmeld/schemas";
import type {
  FileRoot as AnyFileRoot,
  CenterAgentVerifiedMemberToolSpeaker,
  CommitSpaceFileWriteInput,
  ListSpaceFilesResponse,
  OpenMeldRequestContext,
  SpaceFileActor,
  SpaceFileAuditEvent,
  SpaceFileDescriptor,
  SpaceFileEntry,
  SpaceFileMutationErrorCode,
  SpaceFileRevision,
  SpaceFileUploadCommand,
  SpaceFileUploadMetadata,
  SpaceFileUploadResponse,
  SpaceFolderDescriptor,
  TrashSpaceFileEntryResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { hashSpaceFileStream } from "../space/application/space-file-stream";
import { SpaceFileAuditRepository } from "../space/infrastructure/sql/space-file-audit-repo";
import {
  SpaceFileRepository,
  SpaceFileRepositoryError,
} from "../space/infrastructure/sql/space-file-repo";
import { reserveFileCopyRequest } from "./file-copy-request";
import { prepareOrganizationFileRootAccess } from "./file-root-access";
import {
  buildOrganizationFileObjectKey,
  type OrganizationFileRoot as FileRoot,
  organizationFileRootName,
} from "./file-root-identity";
import { ensureFileRepositorySchema } from "./file-schema-repo";
import { FileUploadSessions } from "./file-upload-sessions";
import { purgeFileObjectPrefix } from "./purge-file-objects";

type RootRequest = {
  context: OpenMeldRequestContext;
  root: FileRoot;
  speakerMember?: CenterAgentVerifiedMemberToolSpeaker;
};
/** The single SQLite metadata writer for one Team or member Files root. */
export class OrganizationFileRoot extends DurableObject<CoreBindings> {
  private accountDeletionPending = false;
  private activeContentWrites = 0;
  private async withContentWrite<T>(operation: () => Promise<T>): Promise<T> {
    this.activeContentWrites++;
    try {
      return await operation();
    } finally {
      this.activeContentWrites--;
    }
  }
  /** Internal lifecycle RPC. A live account or Organization can never be purged. */
  async purgeDeletedAccountRoot(
    raw: AccountDeletionFileRoot
  ): Promise<boolean> {
    const parsed = accountDeletionFileRootSchema.parse(raw);
    if (parsed.root.kind === "space") {
      throw new Error("Space Files belong to the Space owner.");
    }
    const input = { userId: parsed.userId, root: parsed.root };
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const db = getPostgresDatabase(this.env);
      const allowed = await db.query({
        text: `SELECT 1 FROM "openmeld"."users" u WHERE u.id = $1 AND u.deleted_at IS NOT NULL
          AND ($3 = 'member' OR EXISTS (SELECT 1 FROM "openmeld"."organizations" o WHERE o.id = $2 AND o.deletion_requested_at IS NOT NULL))`,
        values: [input.userId, input.root.organizationId, input.root.kind],
      });
      if (
        !allowed.rows.length ||
        (input.root.kind === "member" &&
          input.root.memberUserId !== input.userId)
      ) {
        throw new Error("File root deletion is not authorized.");
      }
      // Deletion is irreversible, so authorization cannot revert while this
      // request waits for the root gate. Reject invalid callers outside it.
      return this.ctx.blockConcurrencyWhile(async () => {
        const name = organizationFileRootName(input.root);
        const identity = this.ctx.storage.sql
          .exec<{ root_json: string }>(
            "SELECT root_json FROM file_root_identity WHERE id = 1"
          )
          .toArray()[0];
        if (identity && identity.root_json !== name) {
          throw new Error("File root identity mismatch.");
        }
        await this.ctx.storage.put("accountDeletionPending", true);
        this.accountDeletionPending = true;
        // Existing R2 puts may finish after the fence. Let them settle before
        // erasing their prefixes or reporting completion; new writes are denied.
        if (this.activeContentWrites > 0) {
          return false;
        }
        const bucket = this.env.OPENMELD_SPACE_ATTACHMENTS;
        if (!bucket) {
          throw new Error("File storage unavailable.");
        }
        const uploads = new FileUploadSessions(this.ctx.storage.sql, bucket);
        await uploads.cleanup(true);
        if (uploads.hasUploads()) {
          return false;
        }
        const location =
          input.root.kind === "team"
            ? "team"
            : `member/${encodeURIComponent(input.userId)}`;
        if (
          !(await purgeFileObjectPrefix(
            bucket,
            `org/${encodeURIComponent(input.root.organizationId)}/file-roots/${location}/`
          ))
        ) {
          return false;
        }
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.put("accountDeletionPending", true);
        ensureFileRepositorySchema(this.ctx.storage.sql);
        this.ctx.storage.sql.exec(
          "CREATE TABLE IF NOT EXISTS file_root_identity (id INTEGER PRIMARY KEY CHECK (id = 1), root_json TEXT NOT NULL)"
        );
        return true;
      });
    });
  }
  constructor(ctx: DurableObjectState, env: CoreBindings) {
    super(ctx, env);
    ensureFileRepositorySchema(this.ctx.storage.sql);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS file_root_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1), root_json TEXT NOT NULL
    )`);
  }
  async list(
    input: RootRequest & {
      query?: unknown;
    }
  ): Promise<ListSpaceFilesResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      const query = listSpaceFilesQuerySchema.parse(input.query ?? {});
      return this.repositoryOperation(() =>
        this.repository.list({
          spaceId: this.ctx.id.toString(),
          parentId: query.parentId,
          view: query.view,
          origin: "artifact",
          canWrite: true,
        })
      );
    });
  }
  async getFile(
    input: RootRequest & {
      fileId: string;
    }
  ): Promise<SpaceFileDescriptor> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      return this.repositoryOperation(() =>
        this.repository.getFile(input.fileId)
      );
    });
  }
  async listRevisions(
    input: RootRequest & {
      fileId: string;
    }
  ): Promise<SpaceFileRevision[]> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      return this.repositoryOperation(() =>
        this.repository.listRevisions(input.fileId)
      );
    });
  }
  async resolveRevision(
    input: RootRequest & {
      fileId: string;
      revision?: number;
    }
  ) {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      return this.repositoryOperation(() =>
        this.repository.resolveRevision({
          fileId: input.fileId,
          revision: input.revision,
        })
      );
    });
  }
  async prepareWrite(
    input: RootRequest & {
      write: CommitSpaceFileWriteInput;
    }
  ): Promise<SpaceFileDescriptor | null> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      const write = this.requireRootWrite(input.write);
      return this.repositoryOperation(() =>
        this.repository.prepareWrite(write)
      );
    });
  }
  async reserveCopy(
    input: RootRequest & {
      clientMutationId: string;
      sourceRoot: AnyFileRoot;
      sourceFileId: string;
      sourceRevisionId: string;
      name: string;
      parentId: string | null;
    }
  ): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.authorize(input);
      const requestJson = JSON.stringify({
        sourceRoot:
          input.sourceRoot.kind === "space"
            ? JSON.stringify([
                "files",
                "space",
                input.sourceRoot.organizationId,
                input.sourceRoot.spaceId,
              ])
            : organizationFileRootName(input.sourceRoot),
        sourceFileId: input.sourceFileId,
        sourceRevisionId: input.sourceRevisionId,
        name: input.name,
        parentId: input.parentId,
      });
      reserveFileCopyRequest({
        sql: this.ctx.storage.sql,
        clientMutationId: input.clientMutationId,
        requestJson,
      });
    });
  }
  async commitWrite(
    input: RootRequest & {
      write: CommitSpaceFileWriteInput;
    }
  ): Promise<SpaceFileDescriptor> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const write = this.requireRootWrite(input.write);
      const bucket = this.env.OPENMELD_SPACE_ATTACHMENTS;
      if (!bucket) {
        throw createCoreRpcHttpError({
          code: "file_root.storage_unavailable",
          reason: "Files are temporarily unavailable.",
          status: 503,
        });
      }
      const key = buildOrganizationFileObjectKey({
        root: input.root,
        fileId: write.fileId,
        revisionId: write.revisionId,
      });
      const object = await bucket.head(key);
      if (!object || object.size !== write.sizeBytes) {
        throw createCoreRpcHttpError({
          code: "file_root.storage_failed",
          reason: "This file revision is unavailable or incomplete.",
          status: 503,
        });
      }
      // Membership may change while R2 responds; the repository owns the final CAS.
      await this.authorize(input);
      const nowMs = Date.now();
      const auditEvent = this.audit({
        actor,
        context: input.context,
        entryId: write.fileId,
        operation: "content_write",
        operationId: write.clientMutationId,
        organizationId: input.root.organizationId,
        nowMs,
        revisionId: write.revisionId,
      });
      return this.mutate(auditEvent, () =>
        this.repository.commitWrite({ actor, auditEvent, nowMs, write })
      );
    });
  }
  async writeContent(
    input: RootRequest & {
      bytes: ArrayBuffer;
      write: CommitSpaceFileWriteInput;
    }
  ): Promise<SpaceFileDescriptor> {
    return await this.withContentWrite(() =>
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
        const write = this.requireRootWrite(input.write);
        if (
          !(input.bytes instanceof ArrayBuffer) ||
          input.bytes.byteLength !== write.sizeBytes ||
          input.bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES
        ) {
          throw createCoreRpcHttpError({
            code: "file_root.invalid_content",
            reason: "The file content does not match its declared size.",
            status: 400,
          });
        }
        const committed = await this.prepareWrite(input);
        if (committed) {
          return committed;
        }
        const bucket = this.env.OPENMELD_SPACE_ATTACHMENTS;
        if (!bucket) {
          throw createCoreRpcHttpError({
            code: "file_root.storage_unavailable",
            reason: "Files are temporarily unavailable.",
            status: 503,
          });
        }
        const key = buildOrganizationFileObjectKey({
          root: input.root,
          fileId: write.fileId,
          revisionId: write.revisionId,
        });
        try {
          await bucket.put(key, input.bytes, {
            httpMetadata: { contentType: write.mimeType },
            customMetadata: {
              fileId: write.fileId,
              revisionId: write.revisionId,
            },
          });
        } catch {
          await this.recordContentAudit({
            ...input,
            entryId: write.fileId,
            revisionId: write.revisionId,
            operation: "content_write",
            operationId: write.clientMutationId,
            errorCode: "file_root.storage_failed",
          });
          throw createCoreRpcHttpError({
            code: "file_root.storage_failed",
            reason: "This file could not be stored right now.",
            status: 503,
          });
        }
        return await this.commitWrite(input);
      })
    );
  }
  async upload(
    input: RootRequest & {
      uploadId: string;
      command: SpaceFileUploadCommand;
      body?: ReadableStream<Uint8Array>;
    }
  ): Promise<SpaceFileUploadResponse> {
    return await this.withContentWrite(() =>
      withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
        const actor = await this.authorize(input);
        const command = spaceFileUploadCommandSchema.parse(input.command);
        if (
          command.action === "start" &&
          (command.metadata.target.kind === "composer" ||
            (command.metadata.target.kind === "file" &&
              command.metadata.target.origin === "chat_upload"))
        ) {
          throw createCoreRpcHttpError({
            code: "invalid_payload",
            reason: "This Files location accepts ordinary files only.",
            status: 400,
          });
        }
        const bucket = this.env.OPENMELD_SPACE_ATTACHMENTS;
        if (!bucket) {
          throw createCoreRpcHttpError({
            code: "file_root.storage_unavailable",
            reason: "Files are temporarily unavailable.",
            status: 503,
          });
        }
        const uploads = new FileUploadSessions(this.ctx.storage.sql, bucket);
        try {
          const result = await uploads.execute({
            actorId: actor.profileId,
            scope: organizationFileRootName(input.root),
            uploadId: input.uploadId,
            command,
            body: input.body,
            prepare: async (metadata) => {
              const write = await this.uploadWrite(
                metadata,
                `upload-${input.uploadId}`
              );
              await this.prepareWrite({ ...input, write });
            },
            finish: async (metadata, key) => ({
              file: await this.finishUpload({
                ...input,
                metadata,
                key,
                bucket,
              }),
            }),
          });
          if (this.accountDeletionPending) {
            await uploads.cleanup(true);
            throw new Error("This Files location has been deleted.");
          }
          return result;
        } finally {
          const expiry = uploads.nextExpiry();
          if (expiry !== null) {
            await this.ctx.storage.setAlarm(expiry);
          }
        }
      })
    );
  }
  async alarm(): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const bucket = this.env.OPENMELD_SPACE_ATTACHMENTS;
      if (!bucket) {
        return;
      }
      const uploads = new FileUploadSessions(this.ctx.storage.sql, bucket);
      await uploads.cleanup();
      const expiry = uploads.nextExpiry();
      if (expiry !== null) {
        await this.ctx.storage.setAlarm(expiry);
      }
    });
  }
  private async uploadWrite(
    metadata: SpaceFileUploadMetadata,
    revisionId: string
  ): Promise<CommitSpaceFileWriteInput> {
    const target = metadata.target;
    if (target.kind === "composer") {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: "Invalid file upload.",
        status: 400,
      });
    }
    return commitSpaceFileWriteInputSchema.parse({
      spaceId: this.ctx.id.toString(),
      fileId:
        target.kind === "file"
          ? await buildSpaceFileEntryIdForMutation(target.clientMutationId)
          : target.fileId,
      revisionId,
      baseRevision: target.kind === "file" ? null : target.baseRevision,
      clientMutationId: target.clientMutationId,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      ...(target.kind === "file"
        ? { name: target.name, parentId: target.parentId }
        : {}),
    });
  }
  private async finishUpload(
    input: RootRequest & {
      metadata: SpaceFileUploadMetadata;
      key: string;
      bucket: R2Bucket;
    }
  ): Promise<SpaceFileDescriptor> {
    await this.authorize(input);
    const object = await input.bucket.get(input.key);
    if (!object || object.size !== input.metadata.sizeBytes) {
      throw createCoreRpcHttpError({
        code: "file_root.storage_failed",
        reason: "The uploaded file is incomplete.",
        status: 503,
      });
    }
    const target = input.metadata.target;
    if (target.kind === "composer") {
      throw createCoreRpcHttpError({
        code: "invalid_payload",
        reason: "Invalid file upload.",
        status: 400,
      });
    }
    const revisionId = await buildSpaceFileRevisionIdFromDigest({
      baseRevision: target.kind === "file" ? null : target.baseRevision,
      clientMutationId: target.clientMutationId,
      mimeType: input.metadata.mimeType,
      contentDigest: await hashSpaceFileStream(object.body),
      ...(target.kind === "file"
        ? { name: target.name, parentId: target.parentId }
        : {}),
    });
    const write = await this.uploadWrite(input.metadata, revisionId);
    const committed = await this.prepareWrite({ ...input, write });
    if (committed) {
      return committed;
    }
    const source = await input.bucket.get(input.key);
    if (!source) {
      throw createCoreRpcHttpError({
        code: "file_root.storage_failed",
        reason: "The uploaded file is unavailable.",
        status: 503,
      });
    }
    const destinationKey = buildOrganizationFileObjectKey({
      root: input.root,
      fileId: write.fileId,
      revisionId,
    });
    await input.bucket.put(destinationKey, source.body, {
      httpMetadata: { contentType: input.metadata.mimeType },
    });
    try {
      return await this.commitWrite({ ...input, write });
    } catch (error) {
      let committed: SpaceFileDescriptor | null;
      try {
        committed = this.repositoryOperation(() =>
          this.repository.resolveCommittedWrite(
            write.clientMutationId,
            write.fileId,
            write
          )
        );
      } catch (reconciliationError) {
        await input.bucket.delete(destinationKey);
        throw reconciliationError;
      }
      if (committed) {
        return committed;
      }
      await input.bucket.delete(destinationKey);
      throw error;
    }
  }
  async recordContentAudit(
    input: RootRequest & {
      entryId: string;
      revisionId: string;
      operation: "content_read" | "content_write";
      operationId: string;
      errorCode?: string;
    }
  ): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const event = this.audit({
        actor,
        context: input.context,
        entryId: input.entryId,
        operation: input.operation,
        operationId: input.operationId,
        organizationId: input.root.organizationId,
        nowMs: Date.now(),
        revisionId: input.revisionId,
        errorCode: input.errorCode,
      });
      new SpaceFileAuditRepository(this.ctx.storage.sql).record(event);
    });
  }
  async createFolder(
    input: RootRequest & {
      body: unknown;
    }
  ): Promise<SpaceFolderDescriptor> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const body = createSpaceFolderBodySchema.parse(input.body);
      const folderId = crypto.randomUUID();
      const nowMs = Date.now();
      const auditEvent = this.audit({
        actor,
        context: input.context,
        entryId: folderId,
        operation: "folder_create",
        operationId: body.clientMutationId,
        organizationId: input.root.organizationId,
        nowMs,
      });
      return this.mutate(auditEvent, () =>
        this.repository.createFolder({
          actor,
          auditEvent,
          clientMutationId: body.clientMutationId,
          folderId,
          name: body.name,
          nowMs,
          parentId: body.parentId,
          spaceId: this.ctx.id.toString(),
        })
      );
    });
  }
  async updateEntry(
    input: RootRequest & {
      body: unknown;
      entryId: string;
    }
  ): Promise<SpaceFileEntry> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const body = updateSpaceFileEntryBodySchema.parse(input.body);
      const nowMs = Date.now();
      const auditEvent = this.audit({
        actor,
        context: input.context,
        entryId: input.entryId,
        operation: "entry_update",
        operationId: body.clientMutationId,
        organizationId: input.root.organizationId,
        nowMs,
      });
      return this.mutate(auditEvent, () =>
        this.repository.updateEntry({
          actor,
          auditEvent,
          body,
          entryId: input.entryId,
          nowMs,
        })
      );
    });
  }
  async trashEntry(
    input: RootRequest & {
      body: unknown;
      entryId: string;
    }
  ): Promise<TrashSpaceFileEntryResponse> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const body = trashSpaceFileEntryBodySchema.parse(input.body);
      const nowMs = Date.now();
      const auditEvent = this.audit({
        actor,
        context: input.context,
        entryId: input.entryId,
        operation: "entry_trash",
        operationId: body.clientMutationId,
        organizationId: input.root.organizationId,
        nowMs,
      });
      return this.mutate(auditEvent, () =>
        this.repository.trashEntry({
          actor,
          auditEvent,
          clientMutationId: body.clientMutationId,
          entryId: input.entryId,
          nowMs,
        })
      );
    });
  }
  async restoreEntry(
    input: RootRequest & {
      body: unknown;
      entryId: string;
    }
  ): Promise<SpaceFileEntry> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const actor = await this.authorize(input);
      const body = restoreSpaceFileEntryBodySchema.parse(input.body);
      const nowMs = Date.now();
      const auditEvent = this.audit({
        actor,
        context: input.context,
        entryId: input.entryId,
        operation: "entry_restore",
        operationId: body.clientMutationId,
        organizationId: input.root.organizationId,
        nowMs,
      });
      return this.mutate(auditEvent, () =>
        this.repository.restoreEntry({
          actor,
          auditEvent,
          clientMutationId: body.clientMutationId,
          entryId: input.entryId,
          nowMs,
        })
      );
    });
  }
  private async authorize(input: RootRequest): Promise<SpaceFileActor> {
    if (
      this.accountDeletionPending ||
      (await this.ctx.storage.get("accountDeletionPending"))
    ) {
      throw new Error("This Files location is being deleted.");
    }
    const name = organizationFileRootName(input.root);
    const { actor } = await prepareOrganizationFileRootAccess({
      context: input.context,
      env: this.env,
      root: input.root,
      speakerMember: input.speakerMember,
    });
    const row = this.ctx.storage.sql
      .exec<{
        root_json: string;
      }>("SELECT root_json FROM file_root_identity WHERE id = 1")
      .toArray()[0];
    if (row && row.root_json !== name) {
      throw createCoreRpcHttpError({
        code: "file_root.identity_mismatch",
        reason: "This Files location does not match its storage root.",
        status: 409,
      });
    }
    if (!row) {
      this.ctx.storage.sql.exec(
        "INSERT INTO file_root_identity (id, root_json) VALUES (1, ?)",
        name
      );
    }
    return actor;
  }
  private audit(input: {
    actor: SpaceFileActor;
    context: OpenMeldRequestContext;
    entryId: string;
    operation: SpaceFileAuditEvent["operation"];
    operationId: string;
    organizationId: string;
    nowMs: number;
    revisionId?: string | null;
    errorCode?: string;
  }): SpaceFileAuditEvent {
    const requestId = input.context.actorContext.requestId;
    return spaceFileAuditEventSchema.parse({
      eventId: JSON.stringify([
        "file-root",
        input.operation,
        requestId,
        input.operationId,
      ]),
      operationId: input.operationId,
      requestId,
      organizationId: input.organizationId,
      spaceId: this.ctx.id.toString(),
      entryId: input.entryId,
      revisionId: input.revisionId ?? null,
      operation: input.operation,
      actorKind: "authenticated",
      actorProfileId: input.actor.profileId,
      representedHumanProfileId: null,
      result: input.errorCode ? "failed" : "succeeded",
      errorCode: input.errorCode ?? null,
      occurredAtMs: input.nowMs,
    });
  }
  private get repository(): SpaceFileRepository {
    if (this.accountDeletionPending) {
      throw new Error("This Files location is being deleted.");
    }
    return new SpaceFileRepository(this.ctx.storage, {
      enqueueSpaceUpdate: false,
    });
  }
  private requireRootWrite(
    rawWrite: CommitSpaceFileWriteInput
  ): CommitSpaceFileWriteInput {
    const write = commitSpaceFileWriteInputSchema.parse(rawWrite);
    if (
      write.spaceId !== this.ctx.id.toString() ||
      write.origin === "chat_upload"
    ) {
      throw createCoreRpcHttpError({
        code: "file_root.invalid_write",
        reason: "This write does not belong to the selected Files location.",
        status: 400,
      });
    }
    return write;
  }
  private repositoryOperation<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (!(error instanceof SpaceFileRepositoryError)) {
        throw error;
      }
      throw createCoreRpcHttpError({
        code: error.code.replace("space_file.", "file_root."),
        reason: error.message,
        status: repositoryErrorStatus(error.code),
      });
    }
  }
  private mutate<T>(auditEvent: SpaceFileAuditEvent, operation: () => T): T {
    try {
      return this.repositoryOperation(operation);
    } catch (error) {
      new SpaceFileAuditRepository(this.ctx.storage.sql).record({
        ...auditEvent,
        errorCode:
          error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code.slice(0, 128)
            : "file_root.internal_error",
        result: "failed",
      });
      throw error;
    }
  }
}
function repositoryErrorStatus(code: SpaceFileMutationErrorCode): number {
  switch (code) {
    case "space_file.not_found":
      return 404;
    case "space_file.invalid_parent":
    case "space_file.type_unsupported":
      return 400;
    case "space_file.conflict":
    case "space_file.folder_not_empty":
    case "space_file.name_conflict":
      return 409;
    case "space_file.too_large":
      return 413;
    case "space_file.storage_failed":
      return 503;
    default:
      return 500;
  }
}
