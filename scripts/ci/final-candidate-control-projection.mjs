import { parseControlYamlMapping } from "./final-candidate-control-yaml.mjs";

const DEPENDENCY_LOCKFILE_PATH = "pnpm-lock.yaml";
const WORKSPACE_MANIFEST_PATH = "pnpm-workspace.yaml";
const UNSAFE_RELATED_PATH_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;

export function projectFinalCandidateControl(
  relativePath,
  contents,
  readRelated = () => null
) {
  if (relativePath === DEPENDENCY_LOCKFILE_PATH) {
    return "dependency-lockfile";
  }
  if (contents === null) {
    return "missing";
  }
  if (relativePath.endsWith("package.json")) {
    const manifest = JSON.parse(contents);
    return JSON.stringify({
      packageManager: manifest.packageManager ?? null,
      scripts: manifest.scripts ?? {},
    });
  }
  if (relativePath === WORKSPACE_MANIFEST_PATH) {
    return projectPnpmWorkspace(contents, readRelated);
  }
  return contents;
}

function projectPnpmWorkspace(contents, readRelated) {
  const document = parseControlYamlMapping(contents);
  const patchedDependencies = asStringMap(
    document.patchedDependencies,
    "patchedDependencies"
  );
  const patchContents = {};
  for (const [packageName, patchPath] of Object.entries(
    patchedDependencies
  ).toSorted(([left], [right]) => left.localeCompare(right))) {
    patchContents[packageName] = isSafeRelatedPath(patchPath)
      ? (readRelated(patchPath) ?? "missing")
      : "unsafe-path";
  }
  return JSON.stringify({
    allowBuilds: asSortedMap(document.allowBuilds, "allowBuilds"),
    configDependencies: asSortedMap(
      document.configDependencies,
      "configDependencies"
    ),
    ignoredBuiltDependencies: asSortedList(
      document.ignoredBuiltDependencies,
      "ignoredBuiltDependencies"
    ),
    neverBuiltDependencies: asSortedList(
      document.neverBuiltDependencies,
      "neverBuiltDependencies"
    ),
    onlyBuiltDependencies: asSortedList(
      document.onlyBuiltDependencies,
      "onlyBuiltDependencies"
    ),
    patchContents,
    patchedDependencies: asSortedMap(
      patchedDependencies,
      "patchedDependencies"
    ),
  });
}

function asSortedMap(value, fieldName) {
  if (value === undefined || value === null) {
    return {};
  }
  if (Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be a YAML mapping.`);
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, normalizeYamlScalar(entry)])
      .toSorted(([left], [right]) => left.localeCompare(right))
  );
}

function asStringMap(value, fieldName) {
  if (value === undefined || value === null) {
    return {};
  }
  if (Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${fieldName} must be a YAML mapping.`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (typeof entry !== "string") {
        throw new Error(`${fieldName} path for ${key} must be a string.`);
      }
      return [key, entry];
    })
  );
}

function asSortedList(value, fieldName) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a YAML sequence.`);
  }
  return value.map((item) => normalizeYamlScalar(item)).toSorted();
}

function normalizeYamlScalar(value) {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function isSafeRelatedPath(relativePath) {
  return (
    typeof relativePath === "string" &&
    relativePath.length > 0 &&
    !pathIsAbsolute(relativePath) &&
    !UNSAFE_RELATED_PATH_PATTERN.test(relativePath)
  );
}

function pathIsAbsolute(relativePath) {
  return (
    relativePath.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(relativePath)
  );
}
