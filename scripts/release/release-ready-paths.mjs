const LOCAL_COMPONENTS_POLICY_PATH = "release/local-components-policy.json";
const PRE_PUSH_RELEASE_GATE_CONTROL_PATHS = new Set([
  ".husky/pre-push",
  "package.json",
  "services/core/src/local-components/update-projection.ts",
]);
const PRE_PUSH_RELEASE_GATE_CONTROL_PATH_PREFIXES = ["scripts/release/"];
const CLI_AND_SERVICE_RELEASE_PATH_PREFIXES = [
  "packages/agent-runtime/src/",
  "packages/start/src/",
];
const CLI_RELEASE_PATH_PREFIXES = [
  "clients/openmeld-cli/native/",
  "clients/openmeld-cli/src/",
];
const CLI_RELEASE_PATHS = new Set([
  "packages/start/package.json",
  "packages/start/tsdown.config.ts",
  "clients/openmeld-cli/package.json",
  "clients/openmeld-cli/tsdown.config.ts",
  "scripts/release/build-cli-binary.mjs",
  "scripts/release/build-windows-process-helper.mjs",
  "scripts/release/windows-process-artifact.mjs",
  "clients/openmeld-cli/scripts/copy-windows-process-helper.mjs",
  "clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs",
]);
// CLI source is part of the shared executable and is therefore a Service input
// unless the path is an explicitly reviewed, presentation-only module that the
// Service does not import. Keep this allowlist narrow and concrete.
const CLI_ONLY_SERVICE_RELEASE_PATHS = new Set([
  "clients/openmeld-cli/src/commands/agents-cards.ts",
]);
const RUNTIME_ADAPTER_RELEASE_PATH_RE =
  /^runtime\/adapters\/[^/]+\/(?:src\/|native\/|package\.json$)/u;
const SERVICE_RELEASE_PATH_PREFIXES = [
  "clients/openmeld-cli/native/",
  "clients/openmeld-cli/src/",
  "packages/schemas/src/",
  "packages/schemas/tests/daemon/",
  "runtime/local-service/src/",
];
const ENGINEERING_ONLY_SCHEMA_PATH_PREFIXES = [
  "packages/schemas/src/schemas/ci/",
  "packages/schemas/src/schemas/release/",
];
const SERVICE_RELEASE_PATHS = new Set([
  "packages/start/package.json",
  "packages/start/tsdown.config.ts",
  "clients/openmeld-cli/tsdown.config.ts",
  "clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs",
  "pnpm-lock.yaml",
  "scripts/release/build-cli-binary.mjs",
  "scripts/release/build-packaged-openmeld-cli.mjs",
  "scripts/release/windows-process-artifact.mjs",
  "scripts/release/build-windows-process-helper.mjs",
  "clients/openmeld-cli/scripts/copy-windows-process-helper.mjs",
  "runtime/local-service/package.json",
  "runtime/local-service/tsconfig.build.json",
  "runtime/local-service/tsconfig.json",
]);
const SERVICE_WORKSPACE_DEPENDENCY_PATH_RE =
  /^(?:packages\/(?:api-client|gateway-contract|projects|protocol|space|space-mesh|utils)|runtime\/local-execution)\/(?:src\/|package\.json$)/u;

export function isCliReleasePath(path) {
  const normalized = normalizeRepoPath(path);
  return (
    CLI_RELEASE_PATHS.has(normalized) ||
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
  if (
    isEngineeringOnlySchemaPath(normalized) ||
    CLI_ONLY_SERVICE_RELEASE_PATHS.has(normalized)
  ) {
    return false;
  }
  return (
    SERVICE_RELEASE_PATHS.has(normalized) ||
    SERVICE_WORKSPACE_DEPENDENCY_PATH_RE.test(normalized) ||
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
    normalized === LOCAL_COMPONENTS_POLICY_PATH ||
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
