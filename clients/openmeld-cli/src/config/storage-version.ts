import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { systemDir } from "./paths";

const STORAGE_VERSION_SCHEMA = "openmeld-local-state-v1";
export const CURRENT_STORAGE_VERSION = 1;

export type StorageVersionStateV1 = {
  v: 1;
  schema: typeof STORAGE_VERSION_SCHEMA;
  storageVersion: typeof CURRENT_STORAGE_VERSION;
  updatedAt: string;
};

export async function readStorageVersionState(): Promise<StorageVersionStateV1 | null> {
  const raw = await readFile(storageVersionPath(), "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StorageVersionStateV1>;
    if (parsed.v !== 1) {
      return null;
    }
    if (parsed.schema !== STORAGE_VERSION_SCHEMA) {
      return null;
    }
    if (parsed.storageVersion !== CURRENT_STORAGE_VERSION) {
      return null;
    }
    if (typeof parsed.updatedAt !== "string") {
      return null;
    }
    return {
      v: 1,
      schema: STORAGE_VERSION_SCHEMA,
      storageVersion: CURRENT_STORAGE_VERSION,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function writeStorageVersionState(
  state: StorageVersionStateV1
): Promise<void> {
  await mkdir(systemDir(), { recursive: true });
  const outputPath = storageVersionPath();
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function ensureStorageVersionState(): Promise<StorageVersionStateV1> {
  const existing = await readStorageVersionState();
  if (existing) {
    return existing;
  }

  const next: StorageVersionStateV1 = {
    v: 1,
    schema: STORAGE_VERSION_SCHEMA,
    storageVersion: CURRENT_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await writeStorageVersionState(next);
  return next;
}

export function createNextStorageVersionState(): StorageVersionStateV1 {
  return {
    v: 1,
    schema: STORAGE_VERSION_SCHEMA,
    storageVersion: CURRENT_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

export function storageVersionPath(): string {
  return join(systemDir(), "storage-version.json");
}
