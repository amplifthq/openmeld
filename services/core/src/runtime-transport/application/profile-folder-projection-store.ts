import { profileFolderProjectionRecordSchema } from "@openmeld/schemas";
import type {
  ProfileFolderProjection,
  ProfileFolderProjectionRecord,
} from "@openmeld/schemas/types";

// Per-owner hub storage of each Profile's folders on one computer. The record
// is written only from a Service folder-save receipt and contains no path, so
// it is a recomputable projection, never the folder authority.
const PROFILE_FOLDER_PROJECTION_STORAGE_PREFIX = "profile-folder-projection:";

type ProjectionStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

type ProjectionTarget = {
  deviceId: string;
  lane: ProfileFolderProjectionRecord["lane"];
  targetProfileId: string;
};

export function profileFolderProjectionStorageKey(
  target: ProjectionTarget
): string {
  return `${PROFILE_FOLDER_PROJECTION_STORAGE_PREFIX}${[
    target.deviceId,
    target.lane,
    target.targetProfileId,
  ]
    .map(encodeURIComponent)
    .join(":")}`;
}

export async function writeProfileFolderProjectionRecord(input: {
  observedAtMs: number;
  projection: ProfileFolderProjection;
  /**
   * A repair receipt replaces the list the Service could no longer read, so
   * it replaces the record whatever revision Core holds.
   */
  replaces?: boolean;
  storage: ProjectionStorage;
  target: ProjectionTarget;
}): Promise<ProfileFolderProjectionRecord> {
  // The strict record schema has no path field and rejects unknown fields, so
  // nothing wider than the projection can be stored.
  const record = profileFolderProjectionRecordSchema.parse({
    deviceId: input.target.deviceId,
    lane: input.target.lane,
    observedAtMs: input.observedAtMs,
    projection: input.projection,
    targetProfileId: input.target.targetProfileId,
  });
  // Receipts can arrive out of order. Storage calls without another await in
  // between run under the Durable Object input gate, so this read and write
  // are not interleaved with another receipt's.
  const stored = await readProfileFolderProjectionRecord(input);
  if (
    !input.replaces &&
    stored &&
    stored.projection.revision > record.projection.revision
  ) {
    return stored;
  }
  await input.storage.put(
    profileFolderProjectionStorageKey(input.target),
    record
  );
  return record;
}

export async function readProfileFolderProjectionRecord(input: {
  storage: ProjectionStorage;
  target: ProjectionTarget;
}): Promise<ProfileFolderProjectionRecord | null> {
  const stored = await input.storage.get<unknown>(
    profileFolderProjectionStorageKey(input.target)
  );
  if (stored === undefined) {
    return null;
  }
  const parsed = profileFolderProjectionRecordSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/**
 * Core may only ask the Service to use a folder id it has seen in this
 * Computer's projection. A Project folder is never the default; the Profile's
 * Default Project is the only Profile-wide Project default.
 */
export function resolveProjectedDefaultFolder(input: {
  folderId: string;
  record: ProfileFolderProjectionRecord | null;
}):
  | { folderId: string; status: "eligible" }
  | { status: "not_found" | "project_default_unsupported" } {
  const folder = input.record?.projection.folders.find(
    (item) => item.folderId === input.folderId
  );
  if (!folder) {
    return { status: "not_found" };
  }
  if (folder.kind === "project") {
    return { status: "project_default_unsupported" };
  }
  return { folderId: folder.folderId, status: "eligible" };
}

/**
 * A folder Core may ask the Service to remove. The Service protects the
 * default folder; Core also protects the Default Project's folder, which is
 * where new work starts while a Default Project is set.
 */
export function resolveRemovableFolder(input: {
  defaultProjectId: string | null;
  folderId: string;
  record: ProfileFolderProjectionRecord | null;
}): { status: "removable" | "not_found" | "default_project_folder" } {
  const folder = input.record?.projection.folders.find(
    (item) => item.folderId === input.folderId
  );
  if (!folder) {
    return { status: "not_found" };
  }
  if (
    folder.kind === "project" &&
    input.defaultProjectId !== null &&
    folder.projectId === input.defaultProjectId
  ) {
    return { status: "default_project_folder" };
  }
  return { status: "removable" };
}
