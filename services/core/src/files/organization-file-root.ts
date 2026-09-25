import { DurableObject } from "cloudflare:workers";
import {
  createSpaceFolderBodySchema,
  listSpaceFilesQuerySchema,
  restoreSpaceFileEntryBodySchema,
  spaceFileAuditEventSchema,
  trashSpaceFileEntryBodySchema,
  updateSpaceFileEntryBodySchema,
} from "@openmeld/schemas";
import type {
  ListSpaceFilesResponse,
  OpenMeldRequestContext,
  SpaceFileActor,
  SpaceFileAuditEvent,
  SpaceFileDescriptor,
  SpaceFileEntry,
  SpaceFileMutationErrorCode,
  SpaceFileRevision,
  SpaceFolderDescriptor,
  TrashSpaceFileEntryResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { SpaceFileAuditRepository } from "../space/infrastructure/sql/space-file-audit-repo";
import {
  SpaceFileRepository,
  SpaceFileRepositoryError,
} from "../space/infrastructure/sql/space-file-repo";
import { prepareOrganizationFileRootAccess } from "./file-root-access";
import {
  type OrganizationFileRoot as FileRoot,
  organizationFileRootName,
} from "./file-root-identity";
import { ensureFileRepositorySchema } from "./file-schema-repo";

type RootRequest = { context: OpenMeldRequestContext; root: FileRoot };

/** The single SQLite metadata writer for one Team or member Files root. */
export class OrganizationFileRoot extends DurableObject<CoreBindings> {
  constructor(ctx: DurableObjectState, env: CoreBindings) {
    super(ctx, env);
    ensureFileRepositorySchema(this.ctx.storage.sql);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS file_root_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1), root_json TEXT NOT NULL
    )`);
  }

  async list(
    input: RootRequest & { query?: unknown }
  ): Promise<ListSpaceFilesResponse> {
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
  }

  async getFile(
    input: RootRequest & { fileId: string }
  ): Promise<SpaceFileDescriptor> {
    await this.authorize(input);
    return this.repositoryOperation(() =>
      this.repository.getFile(input.fileId)
    );
  }

  async listRevisions(
    input: RootRequest & { fileId: string }
  ): Promise<SpaceFileRevision[]> {
    await this.authorize(input);
    return this.repositoryOperation(() =>
      this.repository.listRevisions(input.fileId)
    );
  }

  async createFolder(
    input: RootRequest & { body: unknown }
  ): Promise<SpaceFolderDescriptor> {
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
  }

  async updateEntry(
    input: RootRequest & { body: unknown; entryId: string }
  ): Promise<SpaceFileEntry> {
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
  }

  async trashEntry(
    input: RootRequest & { body: unknown; entryId: string }
  ): Promise<TrashSpaceFileEntryResponse> {
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
  }

  async restoreEntry(
    input: RootRequest & { body: unknown; entryId: string }
  ): Promise<SpaceFileEntry> {
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
  }

  private async authorize(input: RootRequest): Promise<SpaceFileActor> {
    const name = organizationFileRootName(input.root);
    const { actor } = await prepareOrganizationFileRootAccess({
      context: input.context,
      env: this.env,
      root: input.root,
    });
    const row = this.ctx.storage.sql
      .exec<{ root_json: string }>(
        "SELECT root_json FROM file_root_identity WHERE id = 1"
      )
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
      revisionId: null,
      operation: input.operation,
      actorKind: "authenticated",
      actorProfileId: input.actor.profileId,
      representedHumanProfileId: null,
      result: "succeeded",
      errorCode: null,
      occurredAtMs: input.nowMs,
    });
  }

  private get repository(): SpaceFileRepository {
    return new SpaceFileRepository(this.ctx.storage);
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
