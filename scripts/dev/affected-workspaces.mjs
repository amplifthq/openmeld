import path from "node:path";

const LOCKFILE_PATH = "pnpm-lock.yaml";
const PATCH_PATH_PREFIX = "patches/";
const PATCH_FILE_SUFFIX = ".patch";
const CHANGED_ONLY_FLAG = "--changed-only";
const EXCLUDE_PACKAGE_PREFIX = "--exclude-package=";
const PATCH_HASH_LINE_REGEX = /^hash: [0-9a-f]{64}$/u;
const PATCH_REFERENCE_HASH_REGEX = /patch_hash=[0-9a-f]{64}/gu;
const EXACT_TURBO_PACKAGE_REGEX = /^turbo@\d+\.\d+\.\d+$/u;

export function resolveExplicitAffectedPackages(input) {
  if (!input.changedPaths.includes(LOCKFILE_PATH)) {
    return null;
  }

  const changedPackageNames = collectChangedPackageNames(input);
  if (!changedPackageNames || changedPackageNames.size === 0) {
    return null;
  }

  expandWorkspaceDependents(changedPackageNames, input.workspacePackages);
  return [...changedPackageNames].toSorted();
}

export function parseTurboAffectedTaskArgs(args) {
  const excludedPackages = args
    .filter((arg) => arg.startsWith(EXCLUDE_PACKAGE_PREFIX))
    .map((arg) => arg.slice(EXCLUDE_PACKAGE_PREFIX.length))
    .filter(Boolean);
  return {
    changedOnly: args.includes(CHANGED_ONLY_FLAG),
    excludedPackages: [...new Set(excludedPackages)].toSorted(),
    taskNames: args.filter(
      (arg) =>
        arg !== CHANGED_ONLY_FLAG && !arg.startsWith(EXCLUDE_PACKAGE_PREFIX)
    ),
  };
}

export function resolveTurboAffectedFilters(input) {
  const excludedFilters = (input.excludedPackages ?? []).map(
    (packageName) => `--filter=!${packageName}`
  );
  if (input.explicitAffectedPackages) {
    return [
      ...input.explicitAffectedPackages.map(
        (packageName) => `--filter=${packageName}`
      ),
      ...excludedFilters,
    ];
  }

  const includeDependents = !input.changedOnly || input.lockfileChanged;
  const gitSelector = includeDependents
    ? `...[${input.baseRef}]`
    : `[${input.baseRef}]`;
  return [`--filter=${gitSelector}`, ...excludedFilters];
}

export function resolveTurboCommandArgs({ dlxPackage, turboRunArgs }) {
  if (!dlxPackage) {
    return ["turbo", ...turboRunArgs];
  }
  if (!EXACT_TURBO_PACKAGE_REGEX.test(dlxPackage)) {
    throw new Error(
      `Affected validation requires an exact Turbo version, received "${dlxPackage}".`
    );
  }
  return ["dlx", dlxPackage, ...turboRunArgs];
}

function collectChangedPackageNames(input) {
  const changedPackageNames = new Set();
  const nonLockfilePaths = input.changedPaths.filter(
    (changedPath) => changedPath !== LOCKFILE_PATH
  );
  const patchPaths = nonLockfilePaths.filter(readPatchedPackageName);
  if (patchPaths.length === 0) {
    return null;
  }
  const patchedPackageNames = [
    ...new Set(patchPaths.map(readPatchedPackageName)),
  ];
  if (
    !lockfileDiffOnlyChangesPatchHashes(input.lockfileDiff, patchedPackageNames)
  ) {
    return null;
  }

  for (const patchedPackageName of patchedPackageNames) {
    const consumers = input.workspacePackages.filter((candidate) =>
      candidate.dependencies.includes(patchedPackageName)
    );
    if (consumers.length === 0) {
      return null;
    }
    for (const consumer of consumers) {
      changedPackageNames.add(consumer.name);
    }
  }

  for (const changedPath of nonLockfilePaths) {
    if (readPatchedPackageName(changedPath)) {
      continue;
    }
    const workspacePackage = input.workspacePackages.find(
      (candidate) =>
        changedPath === candidate.relativePath ||
        changedPath.startsWith(`${candidate.relativePath}/`)
    );
    if (!(workspacePackage && changedPackageNames.has(workspacePackage.name))) {
      return null;
    }
  }
  return changedPackageNames;
}

function lockfileDiffOnlyChangesPatchHashes(lockfileDiff, packageNames) {
  if (typeof lockfileDiff !== "string" || lockfileDiff.length === 0) {
    return false;
  }
  const changedLines = lockfileDiff
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---"))
    );
  const changedContents = changedLines.map((line) => line.slice(1).trim());
  const hashLineCount = changedContents.filter((line) =>
    PATCH_HASH_LINE_REGEX.test(line)
  ).length;
  if (hashLineCount !== packageNames.length * 2) {
    return false;
  }
  const changedPatchPackageNames =
    collectChangedPatchPackageNames(lockfileDiff);
  if (
    !changedPatchPackageNames ||
    changedPatchPackageNames.size !== packageNames.length ||
    !packageNames.every((packageName) =>
      changedPatchPackageNames.has(packageName)
    )
  ) {
    return false;
  }
  if (
    !changedContents.every(
      (line) => PATCH_HASH_LINE_REGEX.test(line) || line.includes("patch_hash=")
    )
  ) {
    return false;
  }
  const removed = changedLines
    .filter((line) => line.startsWith("-"))
    .map(normalizePatchHashLine)
    .toSorted();
  const added = changedLines
    .filter((line) => line.startsWith("+"))
    .map(normalizePatchHashLine)
    .toSorted();
  return (
    removed.length === added.length &&
    removed.every((line, index) => line === added[index])
  );
}

function collectChangedPatchPackageNames(lockfileDiff) {
  const packageNames = new Set();
  let currentPackageName = null;
  for (const line of lockfileDiff.split("\n")) {
    if (line.startsWith("@@")) {
      currentPackageName = null;
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    const content = line.slice(1).trim();
    const packageName = readLockfilePackageKey(content);
    if (packageName) {
      currentPackageName = packageName;
    }
    if (
      (line.startsWith("+") || line.startsWith("-")) &&
      (PATCH_HASH_LINE_REGEX.test(content) || content.includes("patch_hash="))
    ) {
      if (!currentPackageName) {
        return null;
      }
      packageNames.add(currentPackageName);
    }
  }
  return packageNames;
}

function readLockfilePackageKey(content) {
  if (!content.endsWith(":")) {
    return null;
  }
  const unquotedKey = content.slice(0, -1).replace(/^['"]|['"]$/gu, "");
  const versionSeparatorIndex = unquotedKey.lastIndexOf("@");
  if (versionSeparatorIndex > 0) {
    return unquotedKey.slice(0, versionSeparatorIndex);
  }
  return unquotedKey;
}

function normalizePatchHashLine(line) {
  const content = line.slice(1).trim();
  if (PATCH_HASH_LINE_REGEX.test(content)) {
    return "hash: <patch>";
  }
  return content.replace(PATCH_REFERENCE_HASH_REGEX, "patch_hash=<patch>");
}

function expandWorkspaceDependents(changedPackageNames, workspacePackages) {
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const workspacePackage of workspacePackages) {
      if (changedPackageNames.has(workspacePackage.name)) {
        continue;
      }
      if (
        workspacePackage.dependencies.some((dependencyName) =>
          changedPackageNames.has(dependencyName)
        )
      ) {
        changedPackageNames.add(workspacePackage.name);
        expanded = true;
      }
    }
  }
}

function readPatchedPackageName(changedPath) {
  if (
    !(
      changedPath.startsWith(PATCH_PATH_PREFIX) &&
      changedPath.endsWith(PATCH_FILE_SUFFIX)
    )
  ) {
    return null;
  }
  const filename = path.posix.basename(changedPath, PATCH_FILE_SUFFIX);
  const versionSeparatorIndex = filename.lastIndexOf("@");
  if (versionSeparatorIndex <= 0) {
    return null;
  }
  return filename.slice(0, versionSeparatorIndex).replace("__", "/");
}
