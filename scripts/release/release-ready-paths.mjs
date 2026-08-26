const LOCAL_COMPONENTS_MANIFEST_PATH = "release/local-components.json";
const PRE_PUSH_RELEASE_GATE_CONTROL_PATHS = new Set([
  ".husky/pre-push",
  "package.json",
]);
const PRE_PUSH_RELEASE_GATE_CONTROL_PATH_PREFIXES = ["scripts/release/"];
const CLI_AND_SERVICE_RELEASE_PATH_PREFIXES = ["packages/agent-runtime/src/"];
const CLI_RELEASE_PATH_PREFIXES = [
  "clients/openmeld-cli/native/",
  "clients/openmeld-cli/src/",
];
const CLI_RELEASE_PATHS = new Set([
  "clients/openmeld-cli/package.json",
  "clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs",
]);
// Repo-authored data files that the build embeds into both the packaged CLI
// and the OpenMeld Service bundle. Editing them moves the Service bundle hash,
// so they release like local-component changes even with no source edit.
const EMBEDDED_RELEASE_DATA_PATHS = new Set(["release/vendor-models.json"]);
const RUNTIME_ADAPTER_RELEASE_PATH_RE =
  /^runtime\/adapters\/[^/]+\/(?:src\/|package\.json$)/u;
const SERVICE_RELEASE_PATH_PREFIXES = [
  "clients/openmeld-cli/src/config/daemon",
  "clients/openmeld-cli/src/local-service/",
  "clients/openmeld-cli/src/system/daemon",
  "packages/schemas/src/",
  "packages/schemas/tests/daemon/",
  "runtime/local-service/src/",
];
const ENGINEERING_ONLY_SCHEMA_PATH_PREFIXES = [
  "packages/schemas/src/schemas/ci/",
  "packages/schemas/src/schemas/release/",
];
const SERVICE_RELEASE_PATHS = new Set([
  "clients/openmeld-cli/src/commands/service.ts",
  "clients/openmeld-cli/src/system/current-daemon-version.ts",
  "runtime/local-service/package.json",
  "runtime/local-service/tsconfig.build.json",
  "runtime/local-service/tsconfig.json",
]);

export function isCliReleasePath(path) {
  const normalized = normalizeRepoPath(path);
  return (
    CLI_RELEASE_PATHS.has(normalized) ||
    EMBEDDED_RELEASE_DATA_PATHS.has(normalized) ||
    RUNTIME_ADAPTER_RELEASE_PATH_RE.test(normalized) ||
    isCliAndServiceReleasePath(normalized) ||
    CLI_RELEASE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function isSkillsReleasePath(path) {
  return normalizeRepoPath(path).startsWith("clients/openmeld-cli/skills/");
}

export function isServiceReleasePath(path) {
  const normalized = normalizeRepoPath(path);
  if (isEngineeringOnlySchemaPath(normalized)) {
    return false;
  }
  return (
    SERVICE_RELEASE_PATHS.has(normalized) ||
    EMBEDDED_RELEASE_DATA_PATHS.has(normalized) ||
    RUNTIME_ADAPTER_RELEASE_PATH_RE.test(normalized) ||
    isCliAndServiceReleasePath(normalized) ||
    SERVICE_RELEASE_PATH_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  );
}

export function isEngineeringOnlySchemaPath(path) {
  const normalized = normalizeRepoPath(path);
  return ENGINEERING_ONLY_SCHEMA_PATH_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function isReleaseReadyPath(path) {
  const normalized = normalizeRepoPath(path);
  return (
    normalized === LOCAL_COMPONENTS_MANIFEST_PATH ||
    isCliReleasePath(normalized) ||
    isServiceReleasePath(normalized) ||
    isSkillsReleasePath(normalized)
  );
}

export function selectReleaseReadyPaths(paths) {
  return paths.map(normalizeRepoPath).filter(isReleaseReadyPath).toSorted();
}

export function selectPrePushReleaseVerificationPaths(paths) {
  return paths
    .map(normalizeRepoPath)
    .filter(
      (path) =>
        isReleaseReadyPath(path) || isPrePushReleaseGateControlPath(path)
    )
    .toSorted();
}

function isPrePushReleaseGateControlPath(path) {
  return (
    PRE_PUSH_RELEASE_GATE_CONTROL_PATHS.has(path) ||
    PRE_PUSH_RELEASE_GATE_CONTROL_PATH_PREFIXES.some((prefix) =>
      path.startsWith(prefix)
    )
  );
}

function isCliAndServiceReleasePath(path) {
  return CLI_AND_SERVICE_RELEASE_PATH_PREFIXES.some((prefix) =>
    path.startsWith(prefix)
  );
}

function normalizeRepoPath(path) {
  return String(path).split("\\").join("/");
}
