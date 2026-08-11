import type { Dirent } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { alignSelectedOpenMeldProfileStorage } from "../config/openmeld-profile-selection";
import {
  accountProfileSpaceCacheDir,
  accountProfileViewPath,
  accountsDir,
  normalizeAccountKey,
  openMeldBackupsDir,
  openMeldRootDir,
  profileDir,
  profileViewPath,
  spacesDir,
} from "../config/paths";
import { alignRuntimeConfigStorage } from "../config/runtime-config";
import {
  CURRENT_STORAGE_VERSION,
  createNextStorageVersionState,
  readStorageVersionState,
  writeStorageVersionState,
} from "../config/storage-version";
import { ensureSystemLayout } from "../config/system-layout";
import {
  inspectSpaceCacheFile,
  type SpaceCacheIntegrityIssue,
} from "../space/local-state";

type SpaceCacheAlignmentResult = {
  migratedAccountSpaceFiles: number;
  removedLegacyAccountSpaceDirs: number;
  migratedLegacyProfileFiles: number;
  removedLegacyProfilesDir: boolean;
  migratedLegacyViews: number;
  requiresRepair: boolean;
  detectedCorruptFiles: number;
  detectedCorruptSpaceConfigFiles: number;
  detectedCorruptMaintenanceFiles: number;
  detectedCorruptDeletionNoticeFiles: number;
  backedUpCorruptFiles: number;
  backupRootPath: string | null;
  failedBackupPaths: string[];
};

type StartupCleanupResult = {
  removedTemporaryFiles: number;
};

export type LocalStateAlignmentReport = {
  storageVersion: number;
  storageVersionUpdated: boolean;
  runtimeConfig: {
    migratedLegacyConfig: boolean;
    removedLegacyConfig: boolean;
  };
  selectedOpenMeldProfile: {
    migratedSessionSelections: number;
    removedLegacyDirectory: boolean;
    removedLegacySelectionFile: boolean;
  };
  spaceCache: SpaceCacheAlignmentResult;
  cleanup: StartupCleanupResult;
};

const TEMP_FILE_MARKER = ".tmp-";
type LocalStateAlignmentMode = "check" | "repair";

export async function runLocalStateAlignment(input?: {
  mode?: LocalStateAlignmentMode;
}): Promise<LocalStateAlignmentReport> {
  const mode = input?.mode ?? "check";
  await ensureSystemLayout();
  const previousStorageVersion = await readStorageVersionState();
  const runtimeConfig = await alignRuntimeConfigStorage();
  const selectedOpenMeldProfile = await alignSelectedOpenMeldProfileStorage();
  const spaceCache = await alignLocalSpaceCacheStorage({
    mode,
  });
  const cleanup = await cleanupLocalStateStartupResidue();

  const nextStorageVersion = createNextStorageVersionState();
  const storageVersionUpdated =
    previousStorageVersion?.storageVersion !== CURRENT_STORAGE_VERSION;
  if (storageVersionUpdated || !previousStorageVersion) {
    await writeStorageVersionState(nextStorageVersion);
  }

  return {
    storageVersion: CURRENT_STORAGE_VERSION,
    storageVersionUpdated,
    runtimeConfig,
    selectedOpenMeldProfile,
    spaceCache,
    cleanup,
  };
}

async function alignLocalSpaceCacheStorage(input: {
  mode: LocalStateAlignmentMode;
}): Promise<SpaceCacheAlignmentResult> {
  const accountResult = await alignAccountScopedSpaceCacheDirectories();
  const legacyProfileResult = await alignLegacyProfileDirectories();
  const integrityResult = await inspectLocalSpaceCacheIntegrity({
    mode: input.mode,
  });
  return {
    migratedAccountSpaceFiles: accountResult.migratedFiles,
    removedLegacyAccountSpaceDirs: accountResult.removedLegacyDirs,
    migratedLegacyProfileFiles: legacyProfileResult.migratedFiles,
    removedLegacyProfilesDir: legacyProfileResult.removedLegacyProfilesDir,
    migratedLegacyViews: legacyProfileResult.migratedViews,
    requiresRepair: integrityResult.requiresRepair,
    detectedCorruptFiles: integrityResult.detectedCorruptFiles,
    detectedCorruptSpaceConfigFiles:
      integrityResult.detectedCorruptSpaceConfigFiles,
    detectedCorruptMaintenanceFiles:
      integrityResult.detectedCorruptMaintenanceFiles,
    detectedCorruptDeletionNoticeFiles:
      integrityResult.detectedCorruptDeletionNoticeFiles,
    backedUpCorruptFiles: integrityResult.backedUpCorruptFiles,
    backupRootPath: integrityResult.backupRootPath,
    failedBackupPaths: integrityResult.failedBackupPaths,
  };
}

async function inspectLocalSpaceCacheIntegrity(input: {
  mode: LocalStateAlignmentMode;
}): Promise<{
  requiresRepair: boolean;
  detectedCorruptFiles: number;
  detectedCorruptSpaceConfigFiles: number;
  detectedCorruptMaintenanceFiles: number;
  detectedCorruptDeletionNoticeFiles: number;
  backedUpCorruptFiles: number;
  backupRootPath: string | null;
  failedBackupPaths: string[];
}> {
  const issues = await collectSpaceCacheIntegrityIssues();
  const counts = countSpaceCacheIntegrityIssues(issues);

  if (issues.length === 0) {
    return {
      requiresRepair: false,
      detectedCorruptFiles: 0,
      detectedCorruptSpaceConfigFiles: 0,
      detectedCorruptMaintenanceFiles: 0,
      detectedCorruptDeletionNoticeFiles: 0,
      backedUpCorruptFiles: 0,
      backupRootPath: null,
      failedBackupPaths: [],
    };
  }

  if (input.mode === "repair") {
    const backupResult = await backupCorruptSpaceCacheFiles(issues);
    return {
      requiresRepair: !backupResult.fullyBackedUp,
      detectedCorruptFiles: issues.length,
      detectedCorruptSpaceConfigFiles: counts.spaceConfigFiles,
      detectedCorruptMaintenanceFiles: counts.maintenanceFiles,
      detectedCorruptDeletionNoticeFiles: counts.deletionNoticeFiles,
      backedUpCorruptFiles: backupResult.backedUpPaths.length,
      backupRootPath: backupResult.backupRootPath,
      failedBackupPaths: backupResult.failedPaths,
    };
  }

  return {
    requiresRepair: true,
    detectedCorruptFiles: issues.length,
    detectedCorruptSpaceConfigFiles: counts.spaceConfigFiles,
    detectedCorruptMaintenanceFiles: counts.maintenanceFiles,
    detectedCorruptDeletionNoticeFiles: counts.deletionNoticeFiles,
    backedUpCorruptFiles: 0,
    backupRootPath: null,
    failedBackupPaths: [],
  };
}

async function collectSpaceCacheIntegrityIssues(): Promise<
  SpaceCacheIntegrityIssue[]
> {
  const issues: SpaceCacheIntegrityIssue[] = [];
  const profileDirs = await listAccountProfileDirectories();

  for (const profileDir of profileDirs) {
    for (const cacheDir of [
      join(profileDir, "space-cache"),
      join(profileDir, "spaces"),
    ]) {
      issues.push(...(await inspectSpaceCacheDirectory(cacheDir)));
    }
  }

  return issues;
}

async function listAccountProfileDirectories(): Promise<string[]> {
  const profileDirs: string[] = [];
  const hostEntries = await readDirectoryEntriesIfExists(accountsDir());

  for (const hostEntry of hostEntries) {
    if (!hostEntry.isDirectory()) {
      continue;
    }
    const hostDir = join(accountsDir(), hostEntry.name);
    const userEntries = await readDirectoryEntriesIfExists(hostDir);
    for (const userEntry of userEntries) {
      if (!userEntry.isDirectory()) {
        continue;
      }
      const profilesDir = join(hostDir, userEntry.name, "profiles");
      const entries = await readDirectoryEntriesIfExists(profilesDir);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          profileDirs.push(join(profilesDir, entry.name));
        }
      }
    }
  }

  return profileDirs;
}

async function inspectSpaceCacheDirectory(
  directoryPath: string
): Promise<SpaceCacheIntegrityIssue[]> {
  const entries = await readDirectoryEntriesIfExists(directoryPath);
  const issues: SpaceCacheIntegrityIssue[] = [];

  for (const entry of entries) {
    if (!(entry.isFile() && entry.name.endsWith(".json"))) {
      continue;
    }
    const issue = await inspectSpaceCacheFile(join(directoryPath, entry.name));
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

function countSpaceCacheIntegrityIssues(issues: SpaceCacheIntegrityIssue[]): {
  spaceConfigFiles: number;
  maintenanceFiles: number;
  deletionNoticeFiles: number;
} {
  let spaceConfigFiles = 0;
  let maintenanceFiles = 0;
  let deletionNoticeFiles = 0;

  for (const issue of issues) {
    if (issue.kind === "space_config") {
      spaceConfigFiles += 1;
      continue;
    }
    if (issue.kind === "maintenance_state") {
      maintenanceFiles += 1;
      continue;
    }
    deletionNoticeFiles += 1;
  }

  return {
    spaceConfigFiles,
    maintenanceFiles,
    deletionNoticeFiles,
  };
}

async function backupCorruptSpaceCacheFiles(
  issues: SpaceCacheIntegrityIssue[]
): Promise<{
  backupRootPath: string;
  backedUpPaths: string[];
  failedPaths: string[];
  fullyBackedUp: boolean;
}> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupRootPath = join(
    openMeldBackupsDir(),
    "local-state-corruption",
    `${timestamp}-${process.pid}`
  );
  const openMeldRoot = openMeldRootDir();
  const backedUpPaths: string[] = [];
  const failedPaths: string[] = [];

  for (const issue of issues) {
    const backupPath = join(backupRootPath, relative(openMeldRoot, issue.path));
    try {
      await mkdir(dirname(backupPath), { recursive: true });
      await rename(issue.path, backupPath);
      backedUpPaths.push(issue.path);
      await removeDirectoryIfEmpty(dirname(issue.path)).catch(() => undefined);
    } catch {
      failedPaths.push(issue.path);
    }
  }

  return {
    backupRootPath,
    backedUpPaths,
    failedPaths,
    fullyBackedUp: failedPaths.length === 0,
  };
}

async function alignAccountScopedSpaceCacheDirectories(): Promise<{
  migratedFiles: number;
  removedLegacyDirs: number;
}> {
  const hostEntries = await readDirectoryEntriesIfExists(accountsDir());
  let migratedFiles = 0;
  let removedLegacyDirs = 0;

  for (const hostEntry of hostEntries) {
    if (!hostEntry.isDirectory()) {
      continue;
    }
    const hostDir = join(accountsDir(), hostEntry.name);
    const userEntries = await readDirectoryEntriesIfExists(hostDir);
    for (const userEntry of userEntries) {
      if (!userEntry.isDirectory()) {
        continue;
      }
      const profilesDir = join(hostDir, userEntry.name, "profiles");
      const profileEntries = await readDirectoryEntriesIfExists(profilesDir);
      for (const profileEntry of profileEntries) {
        if (!profileEntry.isDirectory()) {
          continue;
        }
        const accountKey = normalizeAccountKey({
          hostKey: hostEntry.name,
          userKey: userEntry.name,
        });
        const result = await moveDirectoryFilesIfMissing({
          sourceDir: join(profilesDir, profileEntry.name, "spaces"),
          targetDir: accountProfileSpaceCacheDir(accountKey, profileEntry.name),
        });
        migratedFiles += result.migratedFiles;
        removedLegacyDirs += result.removedLegacyDir ? 1 : 0;
      }
    }
  }

  return {
    migratedFiles,
    removedLegacyDirs,
  };
}

async function alignLegacyProfileDirectories(): Promise<{
  migratedFiles: number;
  migratedViews: number;
  removedLegacyProfilesDir: boolean;
}> {
  const fallbackAccount = normalizeAccountKey({});
  const profilesRoot = join(openMeldRootDir(), "profiles");
  const profileEntries = await readDirectoryEntriesIfExists(profilesRoot);
  let migratedFiles = 0;
  let migratedViews = 0;

  for (const profileEntry of profileEntries) {
    if (!profileEntry.isDirectory()) {
      continue;
    }
    const profile = profileEntry.name;
    const legacyViewPath = profileViewPath(profile);
    const targetViewPath = accountProfileViewPath(fallbackAccount, profile);
    const migratedView = await moveFileIfMissing({
      sourcePath: legacyViewPath,
      targetPath: targetViewPath,
    });
    if (migratedView) {
      migratedViews += 1;
    }

    const result = await moveDirectoryFilesIfMissing({
      sourceDir: spacesDir(profile),
      targetDir: accountProfileSpaceCacheDir(fallbackAccount, profile),
    });
    migratedFiles += result.migratedFiles;
    await removeDirectoryIfEmpty(profileDir(profile));
  }

  const removedLegacyProfilesDir = await removeDirectoryIfEmpty(profilesRoot);
  return {
    migratedFiles,
    migratedViews,
    removedLegacyProfilesDir,
  };
}

async function cleanupLocalStateStartupResidue(): Promise<StartupCleanupResult> {
  const removedTemporaryFiles = await removeTemporaryFilesRecursively(
    openMeldRootDir()
  );
  return {
    removedTemporaryFiles,
  };
}

async function moveDirectoryFilesIfMissing(input: {
  sourceDir: string;
  targetDir: string;
}): Promise<{ migratedFiles: number; removedLegacyDir: boolean }> {
  const entries = await readDirectoryEntriesIfExists(input.sourceDir);
  if (entries.length === 0) {
    return {
      migratedFiles: 0,
      removedLegacyDir: await removeDirectoryIfEmpty(input.sourceDir),
    };
  }

  await mkdir(input.targetDir, { recursive: true });
  let migratedFiles = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = join(input.sourceDir, entry.name);
    const targetPath = join(input.targetDir, entry.name);
    if (await moveFileIfMissing({ sourcePath, targetPath })) {
      migratedFiles += 1;
    }
  }

  return {
    migratedFiles,
    removedLegacyDir: await removeDirectoryIfEmpty(input.sourceDir),
  };
}

async function moveFileIfMissing(input: {
  sourcePath: string;
  targetPath: string;
}): Promise<boolean> {
  if (!(await pathExists(input.sourcePath))) {
    return false;
  }
  if (await pathExists(input.targetPath)) {
    return false;
  }
  await mkdir(dirname(input.targetPath), { recursive: true });
  await rename(input.sourcePath, input.targetPath);
  return true;
}

async function removeTemporaryFilesRecursively(dir: string): Promise<number> {
  const entries = await readDirectoryEntriesIfExists(dir);
  let removedTemporaryFiles = 0;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      removedTemporaryFiles += await removeTemporaryFilesRecursively(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.includes(TEMP_FILE_MARKER)) {
      continue;
    }
    await rm(fullPath, { force: true }).catch(() => undefined);
    removedTemporaryFiles += 1;
  }
  return removedTemporaryFiles;
}

async function removeDirectoryIfEmpty(path: string): Promise<boolean> {
  const directoryExists = await stat(path)
    .then((result) => result.isDirectory())
    .catch(() => false);
  if (!directoryExists) {
    return false;
  }
  const entries = await readDirectoryNamesIfExists(path);
  if (entries.length > 0) {
    return false;
  }
  await rm(path, { recursive: true, force: true });
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  return await stat(path)
    .then(() => true)
    .catch(() => false);
}

async function readDirectoryEntriesIfExists(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

async function readDirectoryNamesIfExists(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
