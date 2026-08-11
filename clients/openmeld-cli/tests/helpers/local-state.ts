import type {
  SpaceCacheDeletionNoticeState,
  SpaceCacheDeletionNoticeStateReadResult,
  SpaceCacheMaintenanceState,
  SpaceCacheMaintenanceStateReadResult,
  SpaceConfig,
  SpaceConfigListResult,
  SpaceConfigReadResult,
  SpaceConfigReadSource,
} from "../../src/space/local-state";

export function expectSpaceConfigListItems(
  result: SpaceConfigListResult
): SpaceConfig[] {
  if (result.kind !== "ok") {
    throw new Error(formatListCorruption(result));
  }
  return result.items;
}

export function expectSpaceConfigReadValue(
  result: SpaceConfigReadResult
): SpaceConfig {
  if (result.kind !== "ok") {
    throw new Error(
      `expected a readable space config, received ${result.kind}`
    );
  }
  return result.value;
}

export function expectSpaceCacheMaintenanceStateValue(
  result: SpaceCacheMaintenanceStateReadResult
): SpaceCacheMaintenanceState {
  if (result.kind !== "ok") {
    throw new Error(
      `expected a readable maintenance state, received ${result.kind}`
    );
  }
  return result.value;
}

export function expectSpaceCacheDeletionNoticeStateValue(
  result: SpaceCacheDeletionNoticeStateReadResult
): SpaceCacheDeletionNoticeState {
  if (result.kind !== "ok") {
    throw new Error(
      `expected a readable deletion notice state, received ${result.kind}`
    );
  }
  return result.value;
}

export function createSpaceConfigReadOk(
  value: SpaceConfig,
  source: SpaceConfigReadSource = "current"
): SpaceConfigReadResult {
  return {
    kind: "ok",
    fileKind: "space_config",
    path: `/tmp/${value.space}.json`,
    source,
    value,
  };
}

export function createSpaceConfigReadMissing(): SpaceConfigReadResult {
  return {
    kind: "missing",
    fileKind: "space_config",
    currentPath: "/tmp/current-space-config.json",
    legacyPath: "/tmp/legacy-space-config.json",
  };
}

export function createSpaceConfigReadCorrupt(input?: {
  kind?: "invalid_json" | "invalid_shape" | "read_error";
  source?: SpaceConfigReadSource;
}): SpaceConfigReadResult {
  return {
    kind: input?.kind ?? "invalid_json",
    fileKind: "space_config",
    path: `/tmp/${input?.source ?? "current"}-space-config.json`,
    detail: null,
    source: input?.source ?? "current",
  };
}

function formatListCorruption(
  result: Extract<SpaceConfigListResult, { kind: "corrupt" }>
): string {
  const firstIssue = result.issues[0];
  if (!firstIssue) {
    return "expected a readable space config list";
  }
  return `expected a readable space config list, received ${firstIssue.reason} at ${firstIssue.path}`;
}
