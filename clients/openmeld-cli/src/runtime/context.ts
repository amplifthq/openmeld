import { getProfileDefaultView } from "../config/profile-view";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import {
  getConfiguredViewCustomization,
  type RuntimeViewCustomization,
} from "../config/runtime-config";
import { resolveViewProfileKey } from "../config/view-profile-key";
import type { CliViewMode, RuntimeContext } from "./types";

export type { CliViewMode, RuntimeContext } from "./types";

export async function resolveRuntimeContext(input?: {
  view?: string;
  profile?: string;
  interactive?: boolean;
}): Promise<RuntimeContext> {
  const viewOpenMeldProfileId = await resolveViewProfileKey(input?.profile);
  const configuredViewMode = await readConfiguredDefaultView(
    viewOpenMeldProfileId
  );
  const viewMode = parseCliViewMode(input?.view ?? configuredViewMode);
  const interactive = input?.interactive ?? isInteractiveSession();
  const viewCustomization = await readViewCustomization();

  if (viewMode === "human" || viewMode === "agent") {
    return {
      viewMode,
      resolvedView: viewMode,
      interactive,
      ...(viewOpenMeldProfileId
        ? { openMeldProfileId: viewOpenMeldProfileId }
        : {}),
      ...(viewCustomization ? { viewCustomization } : {}),
    };
  }

  const openMeldProfile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: input?.profile,
    allowUnauthenticated: true,
    persistSelection: false,
    allowDefaultFallback: false,
  }).catch(() => null);
  const resolvedView =
    openMeldProfile?.profileKind === "agent" ? "agent" : "human";
  const resolvedOpenMeldProfileId = openMeldProfile
    ? openMeldProfile.openMeldProfileId
    : viewOpenMeldProfileId;

  return {
    viewMode,
    resolvedView,
    interactive,
    ...(resolvedOpenMeldProfileId
      ? { openMeldProfileId: resolvedOpenMeldProfileId }
      : {}),
    ...(openMeldProfile?.profileKind
      ? { profileKind: openMeldProfile.profileKind }
      : {}),
    ...(viewCustomization ? { viewCustomization } : {}),
  };
}

export function parseCliViewMode(value?: string): CliViewMode {
  const normalized = String(value ?? "auto")
    .trim()
    .toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "human" ||
    normalized === "agent"
  ) {
    return normalized;
  }

  throw new Error(`invalid --view value: ${normalized} (use auto|human|agent)`);
}

function readViewCustomization(): Promise<RuntimeViewCustomization | null> {
  return getConfiguredViewCustomization().catch(() => null);
}

function readConfiguredDefaultView(
  openMeldProfileId?: string | null
): Promise<CliViewMode> {
  if (!openMeldProfileId) {
    return Promise.resolve("auto");
  }
  return getProfileDefaultView(openMeldProfileId).catch(() => "auto");
}

function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
