import {
  type OpenMeldPathResolutionInput,
  openMeldManagedBinaryPath,
  openMeldVersionsDir,
} from "../../config/paths";

const MANAGED_BINARY_NAMES = ["openmeld.exe", "openmeld"];
const PATH_BOUNDARY_PATTERN = /[\s"'<>]/u;
const TRAILING_SLASHES_PATTERN = /\/+$/u;
const VERSION_SEGMENT_BOUNDARY_PATTERN = /[\s"'<>/]/u;

export function isOpenMeldManagedBinaryPath(
  value: string,
  pathInput: OpenMeldPathResolutionInput = {}
): boolean {
  const normalizedPath = normalizeManagedBinaryPathText(value);
  if (
    normalizedPath ===
    normalizeManagedBinaryPathText(openMeldManagedBinaryPath(pathInput))
  ) {
    return true;
  }
  return isManagedVersionBinaryPath(normalizedPath, pathInput);
}

export function containsOpenMeldManagedBinaryPath(
  value: string,
  pathInput: OpenMeldPathResolutionInput = {}
): boolean {
  const normalizedValue = normalizeManagedBinaryPathText(value);
  return (
    containsExactManagedPath(
      normalizedValue,
      normalizeManagedBinaryPathText(openMeldManagedBinaryPath(pathInput))
    ) || containsManagedVersionBinaryPath(normalizedValue, pathInput)
  );
}

export function resolveOpenMeldManagedVersionBinaryRootPath(
  value: string
): string | null {
  const normalizedPath = normalizeManagedBinaryPathText(value);
  const segments = normalizedPath.split("/");
  const binaryName = segments.pop();
  const versionSegment = segments.pop();
  const versionsDirectory = segments.pop();
  if (
    !MANAGED_BINARY_NAMES.includes(binaryName ?? "") ||
    versionsDirectory !== "versions" ||
    !versionSegment ||
    !isValidManagedVersionSegment(versionSegment)
  ) {
    return null;
  }
  const rootPath = segments.join("/");
  if (rootPath.length > 0) {
    return rootPath;
  }
  return normalizedPath.startsWith("/") ? "/" : null;
}

function isManagedVersionBinaryPath(
  normalizedPath: string,
  pathInput: OpenMeldPathResolutionInput
): boolean {
  const versionsRoot = normalizeVersionsRoot(pathInput);
  if (!normalizedPath.startsWith(versionsRoot)) {
    return false;
  }
  const relative = normalizedPath.slice(versionsRoot.length);
  const segments = relative.split("/");
  const versionSegment = segments[0] ?? "";
  const binaryName = segments[1] ?? "";
  return (
    segments.length === 2 &&
    versionSegment.length > 0 &&
    MANAGED_BINARY_NAMES.includes(binaryName)
  );
}

function containsManagedVersionBinaryPath(
  normalizedValue: string,
  pathInput: OpenMeldPathResolutionInput
): boolean {
  const versionsRoot = normalizeVersionsRoot(pathInput);
  let index = normalizedValue.indexOf(versionsRoot);
  while (index >= 0) {
    const before = index > 0 ? (normalizedValue[index - 1] ?? "") : "";
    const afterRoot = normalizedValue.slice(index + versionsRoot.length);
    const versionSeparatorIndex = afterRoot.indexOf("/");
    if (
      isPathBoundary(before) &&
      versionSeparatorIndex > 0 &&
      isValidManagedVersionSegment(afterRoot.slice(0, versionSeparatorIndex))
    ) {
      const afterVersion = afterRoot.slice(versionSeparatorIndex + 1);
      for (const binaryName of MANAGED_BINARY_NAMES) {
        if (afterVersion.startsWith(binaryName)) {
          const afterBinary = afterVersion[binaryName.length] ?? "";
          if (isPathBoundary(afterBinary)) {
            return true;
          }
        }
      }
    }
    index = normalizedValue.indexOf(versionsRoot, index + 1);
  }
  return false;
}

function containsExactManagedPath(
  normalizedValue: string,
  normalizedPath: string
): boolean {
  let index = normalizedValue.indexOf(normalizedPath);
  while (index >= 0) {
    const before = index > 0 ? (normalizedValue[index - 1] ?? "") : "";
    const after = normalizedValue[index + normalizedPath.length] ?? "";
    if (isPathBoundary(before) && isPathBoundary(after)) {
      return true;
    }
    index = normalizedValue.indexOf(normalizedPath, index + 1);
  }
  return false;
}

function normalizeVersionsRoot(pathInput: OpenMeldPathResolutionInput): string {
  return `${normalizeManagedBinaryPathText(
    openMeldVersionsDir(pathInput)
  ).replace(TRAILING_SLASHES_PATTERN, "")}/`;
}

function normalizeManagedBinaryPathText(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

function isPathBoundary(value: string): boolean {
  return value === "" || PATH_BOUNDARY_PATTERN.test(value);
}

function isValidManagedVersionSegment(value: string): boolean {
  return value.length > 0 && !VERSION_SEGMENT_BOUNDARY_PATTERN.test(value);
}
