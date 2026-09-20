import {
  SPACE_FILE_MAX_FOLDER_DEPTH,
  SPACE_FILE_MAX_NAME_LENGTH,
  spaceFileActorSchema,
  spaceFileDescriptorSchema,
  spaceFileEntrySchema,
} from "@openmeld/schemas";
import type {
  CommitSpaceFileWriteInput,
  ListSpaceFilesResponse,
  SpaceFileActor,
  SpaceFileAuditEvent,
  SpaceFileDescriptor,
  SpaceFileEntry,
  SpaceFileMutationErrorCode,
  SpaceFileRevision,
  SpaceFolderDescriptor,
  TrashSpaceFileEntryResponse,
  UpdateSpaceFileEntryBody,
} from "@openmeld/schemas/types";
import { SpaceFileAuditRepository } from "./space-file-audit-repo";
import { SpaceFileUpdateRepository } from "./space-file-update-repo";
import { timestampMsToIso } from "./space-schema-repo";

type SpaceFileEntryRow = {
  entry_id: string;
  space_id: string;
  kind: "file" | "folder";
  parent_id: string | null;
  name: string;
  created_at_ms: number;
  updated_at_ms: number;
  created_by_json: string;
  updated_by_json: string;
  trashed_at_ms: number | null;
  trashed_by_json: string | null;
};

type SpaceFileRevisionRow = {
  revision_id: string;
  file_id: string;
  revision: number;
  mime_type: string;
  size_bytes: number;
  created_at_ms: number;
  created_by_json: string;
};

type SpaceFileMutationRow = {
  action: string;
  request_fingerprint: string;
  response_json: string;
};

type SpaceFileStorage = {
  sql: SqlStorage;
  transactionSync: <T>(closure: () => T) => T;
};

const NUMBERED_FILE_STEM_PATTERN = /^(.*) \((\d+)\)$/u;

export class SpaceFileRepositoryError extends Error {
  readonly code: SpaceFileMutationErrorCode;
  readonly currentFile?: SpaceFileDescriptor;

  constructor(input: {
    code: SpaceFileMutationErrorCode;
    message: string;
    currentFile?: SpaceFileDescriptor;
  }) {
    super(input.message);
    this.name = "SpaceFileRepositoryError";
    this.code = input.code;
    this.currentFile = input.currentFile;
  }
}

export class SpaceFileRepository {
  private readonly sql: SqlStorage;
  private readonly storage: SpaceFileStorage;

  constructor(storage: SpaceFileStorage) {
    this.storage = storage;
    this.sql = storage.sql;
  }

  list(input: {
    spaceId: string;
    parentId?: string | null;
    view?: "active" | "trash";
    canWrite: boolean;
  }): ListSpaceFilesResponse {
    const view = input.view ?? "active";
    const parentId = view === "trash" ? null : (input.parentId ?? null);
    if (view === "active" && parentId) {
      this.requireActiveFolder(parentId);
    }
    const rows = this.sql
      .exec<SpaceFileEntryRow>(
        `
          SELECT
            entry_id,
            space_id,
            kind,
            parent_id,
            name,
            created_at_ms,
            updated_at_ms,
            created_by_json,
            updated_by_json,
            trashed_at_ms,
            trashed_by_json
          FROM space_file_entries
          WHERE ${
            view === "trash"
              ? "trashed_at_ms IS NOT NULL"
              : "parent_key = ? AND trashed_at_ms IS NULL"
          }
          ORDER BY
            ${view === "trash" ? "trashed_at_ms DESC," : "CASE kind WHEN 'folder' THEN 0 ELSE 1 END,"}
            name_key ASC,
            entry_id ASC
        `,
        ...(view === "trash" ? [] : [parentKey(parentId)])
      )
      .toArray();

    return {
      spaceId: input.spaceId,
      parentId,
      view,
      breadcrumbs:
        view === "trash"
          ? [
              { id: null, name: "Files" },
              { id: null, name: "Trash" },
            ]
          : this.buildBreadcrumbs(parentId),
      entries: rows.map((row) => this.readEntryRow(row)),
      capabilities: { canRead: true, canWrite: input.canWrite },
    };
  }

  getFile(fileId: string): SpaceFileDescriptor {
    const row = this.requireActiveEntry(fileId);
    if (row.kind !== "file") {
      throw notFound("File not found.");
    }
    return this.readFileRow(row);
  }

  listRevisions(fileId: string): SpaceFileRevision[] {
    this.getFile(fileId);
    return this.sql
      .exec<SpaceFileRevisionRow>(
        `
          SELECT
            revision_id,
            file_id,
            revision,
            mime_type,
            size_bytes,
            created_at_ms,
            created_by_json
          FROM space_file_revisions
          WHERE file_id = ?
          ORDER BY revision DESC
        `,
        fileId
      )
      .toArray()
      .map(readRevisionRow);
  }

  resolveRevision(input: { fileId: string; revision?: number }): {
    file: SpaceFileDescriptor;
    revision: SpaceFileRevision;
  } {
    const file = this.getFile(input.fileId);
    if (input.revision === undefined) {
      return { file, revision: file.latestRevision };
    }
    const row = first(
      this.sql.exec<SpaceFileRevisionRow>(
        `
          SELECT
            revision_id,
            file_id,
            revision,
            mime_type,
            size_bytes,
            created_at_ms,
            created_by_json
          FROM space_file_revisions
          WHERE file_id = ? AND revision = ?
          LIMIT 1
        `,
        input.fileId,
        input.revision
      )
    );
    if (!row) {
      throw notFound("File revision not found.");
    }
    return { file, revision: readRevisionRow(row) };
  }

  prepareWrite(input: CommitSpaceFileWriteInput): SpaceFileDescriptor | null {
    const replay = this.readMutation<SpaceFileDescriptor>({
      action: "commit_write",
      clientMutationId: input.clientMutationId,
      fingerprint: mutationFingerprint(input),
    });
    if (replay) {
      return replay;
    }
    if (input.baseRevision === null) {
      if (!(input.name && input.parentId !== undefined)) {
        throw invalidParent("A new file requires a name and destination.");
      }
      this.requireValidParent(input.parentId);
      if (this.readEntry(input.fileId)) {
        throw conflict("This file already exists.");
      }
      return null;
    }
    const current = this.getFile(input.fileId);
    if (current.latestRevision.revision !== input.baseRevision) {
      throw conflict(
        "This file changed after you opened it. Reload the latest version before saving.",
        current
      );
    }
    return null;
  }

  resolveCommittedWrite(
    clientMutationId: string,
    expectedFileId: string
  ): SpaceFileDescriptor | null {
    const row = first(
      this.sql.exec<SpaceFileMutationRow>(
        `
          SELECT action, request_fingerprint, response_json
          FROM space_file_mutations
          WHERE client_mutation_id = ?
          LIMIT 1
        `,
        clientMutationId
      )
    );
    if (!row) {
      return null;
    }
    if (row.action !== "commit_write") {
      throw conflict("This request ID was already used for another change.");
    }
    const committedFile = spaceFileDescriptorSchema.parse(
      JSON.parse(row.response_json)
    );
    if (committedFile.id !== expectedFileId) {
      throw conflict("This request ID was already used for another change.");
    }
    return committedFile;
  }

  createFolder(input: {
    actor: SpaceFileActor;
    auditEvent: SpaceFileAuditEvent;
    clientMutationId: string;
    folderId: string;
    name: string;
    nowMs: number;
    parentId?: string | null;
    spaceId: string;
  }): SpaceFolderDescriptor {
    return this.storage.transactionSync(() => {
      const fingerprint = mutationFingerprint({
        name: input.name,
        parentId: input.parentId ?? null,
        spaceId: input.spaceId,
      });
      const replay = this.readMutation<SpaceFolderDescriptor>({
        action: "create_folder",
        clientMutationId: input.clientMutationId,
        fingerprint,
      });
      if (replay) {
        this.recordAuditEvent(input.auditEvent);
        return replay;
      }
      const parentId = input.parentId ?? null;
      this.requireValidParent(parentId);
      this.requireNameAvailable({ parentId, name: input.name });
      const actorJson = JSON.stringify(spaceFileActorSchema.parse(input.actor));
      this.sql.exec(
        `
          INSERT INTO space_file_entries (
            entry_id,
            space_id,
            kind,
            parent_id,
            parent_key,
            name,
            name_key,
            created_at_ms,
            updated_at_ms,
            created_by_json,
            updated_by_json,
            trashed_at_ms,
            trashed_by_json
          ) VALUES (?, ?, 'folder', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `,
        input.folderId,
        input.spaceId,
        parentId,
        parentKey(parentId),
        input.name,
        nameKey(input.name),
        input.nowMs,
        input.nowMs,
        actorJson,
        actorJson
      );
      const folder = this.readEntryDescriptor(input.folderId);
      if (folder.kind !== "folder") {
        throw new Error("Created Space folder has an invalid kind.");
      }
      this.recordMutation({
        action: "create_folder",
        clientMutationId: input.clientMutationId,
        fingerprint,
        nowMs: input.nowMs,
        response: folder,
      });
      this.recordAuditEvent(input.auditEvent);
      return folder;
    });
  }

  updateEntry(input: {
    actor: SpaceFileActor;
    auditEvent: SpaceFileAuditEvent;
    body: UpdateSpaceFileEntryBody;
    entryId: string;
    nowMs: number;
  }): SpaceFileEntry {
    return this.storage.transactionSync(() => {
      const fingerprint = mutationFingerprint({
        entryId: input.entryId,
        name: input.body.name ?? null,
        parentId:
          input.body.parentId === undefined ? "unchanged" : input.body.parentId,
      });
      const replay = this.readMutation<SpaceFileEntry>({
        action: "update_entry",
        clientMutationId: input.body.clientMutationId,
        fingerprint,
      });
      if (replay) {
        this.recordAuditEvent(input.auditEvent);
        return replay;
      }
      const current = this.requireActiveEntry(input.entryId);
      const nextParentId =
        input.body.parentId === undefined
          ? current.parent_id
          : input.body.parentId;
      const nextName = input.body.name ?? current.name;
      this.requireValidParent(nextParentId, input.entryId);
      this.requireNameAvailable({
        excludeEntryId: input.entryId,
        parentId: nextParentId,
        name: nextName,
      });
      const actorJson = JSON.stringify(spaceFileActorSchema.parse(input.actor));
      this.sql.exec(
        `
          UPDATE space_file_entries
          SET parent_id = ?,
              parent_key = ?,
              name = ?,
              name_key = ?,
              updated_at_ms = ?,
              updated_by_json = ?
          WHERE entry_id = ? AND trashed_at_ms IS NULL
        `,
        nextParentId,
        parentKey(nextParentId),
        nextName,
        nameKey(nextName),
        input.nowMs,
        actorJson,
        input.entryId
      );
      const entry = this.readEntryDescriptor(input.entryId);
      this.recordMutation({
        action: "update_entry",
        clientMutationId: input.body.clientMutationId,
        fingerprint,
        nowMs: input.nowMs,
        response: entry,
      });
      this.recordAuditEvent(input.auditEvent);
      return entry;
    });
  }

  trashEntry(input: {
    actor: SpaceFileActor;
    auditEvent: SpaceFileAuditEvent;
    clientMutationId: string;
    entryId: string;
    nowMs: number;
  }): TrashSpaceFileEntryResponse {
    return this.storage.transactionSync(() => {
      const fingerprint = mutationFingerprint({ entryId: input.entryId });
      const replay = this.readMutation<TrashSpaceFileEntryResponse>({
        action: "trash_entry",
        clientMutationId: input.clientMutationId,
        fingerprint,
      });
      if (replay) {
        this.recordAuditEvent(input.auditEvent);
        return replay;
      }
      const current = this.requireActiveEntry(input.entryId);
      if (current.kind === "folder") {
        const child = first(
          this.sql.exec<{ entry_id: string }>(
            `
              SELECT entry_id
              FROM space_file_entries
              WHERE parent_key = ? AND trashed_at_ms IS NULL
              LIMIT 1
            `,
            parentKey(input.entryId)
          )
        );
        if (child) {
          throw new SpaceFileRepositoryError({
            code: "space_file.folder_not_empty",
            message: "Move or trash the items in this folder first.",
          });
        }
      }
      const actorJson = JSON.stringify(spaceFileActorSchema.parse(input.actor));
      this.sql.exec(
        `
          UPDATE space_file_entries
          SET trashed_at_ms = ?,
              trashed_by_json = ?,
              updated_at_ms = ?,
              updated_by_json = ?
          WHERE entry_id = ? AND trashed_at_ms IS NULL
        `,
        input.nowMs,
        actorJson,
        input.nowMs,
        actorJson,
        input.entryId
      );
      const response = {
        entryId: input.entryId,
        trashedAt: timestampMsToIso(input.nowMs),
      };
      this.recordMutation({
        action: "trash_entry",
        clientMutationId: input.clientMutationId,
        fingerprint,
        nowMs: input.nowMs,
        response,
      });
      this.recordAuditEvent(input.auditEvent);
      return response;
    });
  }

  restoreEntry(input: {
    actor: SpaceFileActor;
    auditEvent: SpaceFileAuditEvent;
    clientMutationId: string;
    entryId: string;
    nowMs: number;
  }): SpaceFileEntry {
    return this.storage.transactionSync(() => {
      const fingerprint = mutationFingerprint({ entryId: input.entryId });
      const replay = this.readMutation<SpaceFileEntry>({
        action: "restore_entry",
        clientMutationId: input.clientMutationId,
        fingerprint,
      });
      if (replay) {
        this.recordAuditEvent(input.auditEvent);
        return replay;
      }
      const current = this.requireTrashedEntry(input.entryId);
      this.requireValidParent(current.parent_id);
      this.requireNameAvailable({
        parentId: current.parent_id,
        name: current.name,
      });
      const actorJson = JSON.stringify(spaceFileActorSchema.parse(input.actor));
      this.sql.exec(
        `
          UPDATE space_file_entries
          SET trashed_at_ms = NULL,
              trashed_by_json = NULL,
              updated_at_ms = ?,
              updated_by_json = ?
          WHERE entry_id = ? AND trashed_at_ms IS NOT NULL
        `,
        input.nowMs,
        actorJson,
        input.entryId
      );
      const entry = this.readEntryDescriptor(input.entryId);
      this.recordMutation({
        action: "restore_entry",
        clientMutationId: input.clientMutationId,
        fingerprint,
        nowMs: input.nowMs,
        response: entry,
      });
      this.recordAuditEvent(input.auditEvent);
      return entry;
    });
  }

  commitWrite(input: {
    actor: SpaceFileActor;
    auditEvent: SpaceFileAuditEvent;
    nowMs: number;
    write: CommitSpaceFileWriteInput;
  }): SpaceFileDescriptor {
    return this.storage.transactionSync(() => {
      const fingerprint = mutationFingerprint(input.write);
      const replay = this.readMutation<SpaceFileDescriptor>({
        action: "commit_write",
        clientMutationId: input.write.clientMutationId,
        fingerprint,
      });
      if (replay) {
        this.recordAuditEvent(input.auditEvent);
        return replay;
      }
      this.prepareWrite(input.write);
      const actorJson = JSON.stringify(spaceFileActorSchema.parse(input.actor));
      let revision: number;
      if (input.write.baseRevision === null) {
        revision = 1;
        const parentId = input.write.parentId ?? null;
        const name = this.resolveAvailableFileName({
          name: input.write.name ?? "",
          parentId,
        });
        this.sql.exec(
          `
            INSERT INTO space_file_entries (
              entry_id,
              space_id,
              kind,
              parent_id,
              parent_key,
              name,
              name_key,
              created_at_ms,
              updated_at_ms,
              created_by_json,
              updated_by_json,
              trashed_at_ms,
              trashed_by_json
            ) VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
          `,
          input.write.fileId,
          input.write.spaceId,
          parentId,
          parentKey(parentId),
          name,
          nameKey(name),
          input.nowMs,
          input.nowMs,
          actorJson,
          actorJson
        );
      } else {
        revision = input.write.baseRevision + 1;
        this.sql.exec(
          `
            UPDATE space_file_entries
            SET updated_at_ms = ?, updated_by_json = ?
            WHERE entry_id = ? AND trashed_at_ms IS NULL
          `,
          input.nowMs,
          actorJson,
          input.write.fileId
        );
      }
      this.sql.exec(
        `
          INSERT INTO space_file_revisions (
            revision_id,
            file_id,
            revision,
            mime_type,
            size_bytes,
            created_at_ms,
            created_by_json,
            client_mutation_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        input.write.revisionId,
        input.write.fileId,
        revision,
        input.write.mimeType,
        input.write.sizeBytes,
        input.nowMs,
        actorJson,
        input.write.clientMutationId
      );
      const file = this.getFile(input.write.fileId);
      new SpaceFileUpdateRepository(this.sql).enqueue(file, input.nowMs);
      this.recordMutation({
        action: "commit_write",
        clientMutationId: input.write.clientMutationId,
        fingerprint,
        nowMs: input.nowMs,
        response: file,
      });
      this.recordAuditEvent(input.auditEvent);
      return file;
    });
  }

  private buildBreadcrumbs(parentId: string | null) {
    const breadcrumbs: Array<{ id: string | null; name: string }> = [
      { id: null, name: "Files" },
    ];
    if (!parentId) {
      return breadcrumbs;
    }
    const ancestors: SpaceFileEntryRow[] = [];
    let currentId: string | null = parentId;
    while (currentId) {
      const row: SpaceFileEntryRow = this.requireActiveEntry(currentId);
      if (row.kind !== "folder") {
        throw invalidParent("The requested folder is unavailable.");
      }
      ancestors.unshift(row);
      currentId = row.parent_id;
      if (ancestors.length > SPACE_FILE_MAX_FOLDER_DEPTH) {
        throw invalidParent("This folder is nested too deeply.");
      }
    }
    return breadcrumbs.concat(
      ancestors.map((row) => ({ id: row.entry_id, name: row.name }))
    );
  }

  private readEntryDescriptor(entryId: string): SpaceFileEntry {
    return this.readEntryRow(this.requireActiveEntry(entryId));
  }

  private readEntryRow(row: SpaceFileEntryRow): SpaceFileEntry {
    const base = {
      id: row.entry_id,
      spaceId: row.space_id,
      parentId: row.parent_id,
      name: row.name,
      path: this.buildPath(row),
      createdAt: timestampMsToIso(row.created_at_ms),
      updatedAt: timestampMsToIso(row.updated_at_ms),
      createdBy: parseActor(row.created_by_json),
      updatedBy: parseActor(row.updated_by_json),
      trashedAt:
        row.trashed_at_ms === null ? null : timestampMsToIso(row.trashed_at_ms),
      trashedBy:
        row.trashed_by_json === null ? null : parseActor(row.trashed_by_json),
    };
    return spaceFileEntrySchema.parse(
      row.kind === "folder"
        ? { ...base, kind: "folder" }
        : {
            ...base,
            kind: "file",
            latestRevision: this.latestRevision(row.entry_id),
          }
    );
  }

  private readFileRow(row: SpaceFileEntryRow): SpaceFileDescriptor {
    const entry = this.readEntryRow(row);
    if (entry.kind !== "file") {
      throw new Error("Expected a Space file.");
    }
    return entry;
  }

  private latestRevision(fileId: string): SpaceFileRevision {
    const row = first(
      this.sql.exec<SpaceFileRevisionRow>(
        `
          SELECT
            revision_id,
            file_id,
            revision,
            mime_type,
            size_bytes,
            created_at_ms,
            created_by_json
          FROM space_file_revisions
          WHERE file_id = ?
          ORDER BY revision DESC
          LIMIT 1
        `,
        fileId
      )
    );
    if (!row) {
      throw new Error(`Space file ${fileId} has no revision.`);
    }
    return readRevisionRow(row);
  }

  private buildPath(row: SpaceFileEntryRow): string {
    const segments = [row.name];
    let currentId = row.parent_id;
    while (currentId) {
      const parent = this.requireActiveEntry(currentId);
      segments.unshift(parent.name);
      currentId = parent.parent_id;
      if (segments.length > SPACE_FILE_MAX_FOLDER_DEPTH + 1) {
        throw invalidParent("This file is nested too deeply.");
      }
    }
    return `/${segments.join("/")}`;
  }

  private requireValidParent(parentId: string | null, movingEntryId?: string) {
    if (!parentId) {
      return;
    }
    let currentId: string | null = parentId;
    let depth = 0;
    while (currentId) {
      if (currentId === movingEntryId) {
        throw invalidParent("A folder cannot be moved inside itself.");
      }
      const parent: SpaceFileEntryRow = this.requireActiveFolder(currentId);
      currentId = parent.parent_id;
      depth += 1;
      if (depth > SPACE_FILE_MAX_FOLDER_DEPTH) {
        throw invalidParent(
          `Folders can be nested up to ${SPACE_FILE_MAX_FOLDER_DEPTH} levels.`
        );
      }
    }
  }

  private requireActiveFolder(entryId: string): SpaceFileEntryRow {
    const row = this.requireActiveEntry(entryId);
    if (row.kind !== "folder") {
      throw invalidParent("Choose an available folder.");
    }
    return row;
  }

  private requireActiveEntry(entryId: string): SpaceFileEntryRow {
    const row = this.readEntry(entryId);
    if (!row || row.trashed_at_ms !== null) {
      throw notFound("File or folder not found.");
    }
    return row;
  }

  private requireTrashedEntry(entryId: string): SpaceFileEntryRow {
    const row = this.readEntry(entryId);
    if (!row || row.trashed_at_ms === null) {
      throw notFound("File or folder not found in Trash.");
    }
    return row;
  }

  private readEntry(entryId: string): SpaceFileEntryRow | null {
    return first(
      this.sql.exec<SpaceFileEntryRow>(
        `
          SELECT
            entry_id,
            space_id,
            kind,
            parent_id,
            name,
            created_at_ms,
            updated_at_ms,
            created_by_json,
            updated_by_json,
            trashed_at_ms,
            trashed_by_json
          FROM space_file_entries
          WHERE entry_id = ?
          LIMIT 1
        `,
        entryId
      )
    );
  }

  private requireNameAvailable(input: {
    parentId: string | null;
    name: string;
    excludeEntryId?: string;
  }): void {
    const row = first(
      this.sql.exec<{ entry_id: string }>(
        `
          SELECT entry_id
          FROM space_file_entries
          WHERE parent_key = ?
            AND name_key = ?
            AND trashed_at_ms IS NULL
            ${input.excludeEntryId ? "AND entry_id <> ?" : ""}
          LIMIT 1
        `,
        parentKey(input.parentId),
        nameKey(input.name),
        ...(input.excludeEntryId ? [input.excludeEntryId] : [])
      )
    );
    if (row) {
      throw new SpaceFileRepositoryError({
        code: "space_file.name_conflict",
        message: `“${input.name}” already exists in this folder.`,
      });
    }
  }

  private resolveAvailableFileName(input: {
    name: string;
    parentId: string | null;
  }): string {
    const occupiedNames = new Set(
      this.sql
        .exec<{ name_key: string }>(
          `
            SELECT name_key
            FROM space_file_entries
            WHERE parent_key = ? AND trashed_at_ms IS NULL
          `,
          parentKey(input.parentId)
        )
        .toArray()
        .map((row) => row.name_key)
    );
    if (!occupiedNames.has(nameKey(input.name))) {
      return input.name;
    }

    const { extension, stem } = splitFileName(input.name);
    const numberedStem = NUMBERED_FILE_STEM_PATTERN.exec(stem);
    const baseStem = numberedStem?.[1] ?? stem;
    const parsedOrdinal = Number(numberedStem?.[2] ?? 1);
    let ordinal = Number.isSafeInteger(parsedOrdinal)
      ? Math.max(2, parsedOrdinal + 1)
      : 2;

    while (Number.isSafeInteger(ordinal)) {
      const suffix = ` (${ordinal})`;
      const availableStemLength =
        SPACE_FILE_MAX_NAME_LENGTH - suffix.length - extension.length;
      if (availableStemLength < 1) {
        throw conflict(
          "OpenMeld could not assign a unique file name without changing its extension."
        );
      }
      const candidate = `${baseStem.slice(0, availableStemLength)}${suffix}${extension}`;
      if (!occupiedNames.has(nameKey(candidate))) {
        return candidate;
      }
      ordinal += 1;
    }
    throw conflict("OpenMeld could not assign a unique file name.");
  }

  private readMutation<T>(input: {
    action: string;
    clientMutationId: string;
    fingerprint: string;
  }): T | null {
    const row = first(
      this.sql.exec<SpaceFileMutationRow>(
        `
          SELECT action, request_fingerprint, response_json
          FROM space_file_mutations
          WHERE client_mutation_id = ?
          LIMIT 1
        `,
        input.clientMutationId
      )
    );
    if (!row) {
      return null;
    }
    if (
      row.action !== input.action ||
      row.request_fingerprint !== input.fingerprint
    ) {
      throw conflict("This request ID was already used for another change.");
    }
    return JSON.parse(row.response_json) as T;
  }

  private recordMutation<T>(input: {
    action: string;
    clientMutationId: string;
    fingerprint: string;
    nowMs: number;
    response: T;
  }): void {
    this.sql.exec(
      `
        INSERT INTO space_file_mutations (
          client_mutation_id,
          action,
          request_fingerprint,
          response_json,
          created_at_ms
        ) VALUES (?, ?, ?, ?, ?)
      `,
      input.clientMutationId,
      input.action,
      input.fingerprint,
      JSON.stringify(input.response),
      input.nowMs
    );
  }

  private recordAuditEvent(event: SpaceFileAuditEvent): void {
    new SpaceFileAuditRepository(this.sql).record(event);
  }
}

function readRevisionRow(row: SpaceFileRevisionRow): SpaceFileRevision {
  return {
    id: row.revision_id,
    fileId: row.file_id,
    revision: Number(row.revision),
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: timestampMsToIso(row.created_at_ms),
    createdBy: parseActor(row.created_by_json),
  };
}

function parseActor(json: string): SpaceFileActor {
  return spaceFileActorSchema.parse(JSON.parse(json));
}

function parentKey(parentId: string | null): string {
  return parentId ?? "";
}

function nameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}

function splitFileName(name: string): { extension: string; stem: string } {
  const extensionStart = name.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === name.length - 1) {
    return { extension: "", stem: name };
  }
  return {
    extension: name.slice(extensionStart),
    stem: name.slice(0, extensionStart),
  };
}

function mutationFingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function first<T>(cursor: { toArray(): T[] }): T | null {
  return cursor.toArray()[0] ?? null;
}

function notFound(message: string): SpaceFileRepositoryError {
  return new SpaceFileRepositoryError({
    code: "space_file.not_found",
    message,
  });
}

function invalidParent(message: string): SpaceFileRepositoryError {
  return new SpaceFileRepositoryError({
    code: "space_file.invalid_parent",
    message,
  });
}

function conflict(
  message: string,
  currentFile?: SpaceFileDescriptor
): SpaceFileRepositoryError {
  return new SpaceFileRepositoryError({
    code: "space_file.conflict",
    message,
    currentFile,
  });
}
