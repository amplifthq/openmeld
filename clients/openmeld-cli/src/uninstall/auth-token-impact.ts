import type { OpenMeldEnvPreset } from "../config/paths";
import { normalizeBaseUrl } from "../protocol/urls";
import { UNINSTALL_SHARED_AUTH_WARNING } from "./copy";
import { listScopeLanes } from "./lane-scope";
import type {
  ResolvedUninstallRequest,
  UninstallAction,
  UninstallScope,
  UninstallWarning,
} from "./types";

export type LaneAuthTokenIdentity = {
  lane: OpenMeldEnvPreset;
  authBaseUrl: string;
  clientId: string;
};

export function resolveAuthTokenCleanupWarnings(input: {
  scope: UninstallScope;
  currentLane: OpenMeldEnvPreset;
  authTokenAction: UninstallAction;
  laneIdentities: readonly LaneAuthTokenIdentity[];
}): UninstallWarning[] {
  if (input.authTokenAction !== "remove") {
    return [];
  }

  if (input.scope.kind === "all-lanes") {
    return [];
  }

  const currentIdentity = input.laneIdentities.find(
    (identity) => identity.lane === input.currentLane
  );
  if (!currentIdentity) {
    return [];
  }

  const scopedLanes = new Set(listScopeLanes(input.scope));
  const currentKey = toComparableTokenKey(currentIdentity);
  const affectedLanes = input.laneIdentities
    .filter((identity) => identity.lane !== input.currentLane)
    .filter((identity) => !scopedLanes.has(identity.lane))
    .filter((identity) => toComparableTokenKey(identity) === currentKey)
    .map((identity) => identity.lane)
    .sort((left, right) => left.localeCompare(right));

  if (affectedLanes.length === 0) {
    return [];
  }

  return [
    {
      code: "shared_auth_tokens",
      message: UNINSTALL_SHARED_AUTH_WARNING,
      affectedLanes,
    },
  ];
}

export function attachAuthTokenCleanupWarnings(input: {
  request: Omit<ResolvedUninstallRequest, "warnings">;
  warnings: readonly UninstallWarning[];
}): ResolvedUninstallRequest {
  return {
    ...input.request,
    warnings: [...input.warnings],
  };
}

function toComparableTokenKey(identity: LaneAuthTokenIdentity): string {
  return JSON.stringify({
    authBaseUrl: normalizeBaseUrl(identity.authBaseUrl),
    clientId: identity.clientId.trim(),
  });
}
