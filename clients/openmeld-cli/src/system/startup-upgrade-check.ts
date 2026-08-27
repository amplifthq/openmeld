import { confirm, isCancel } from "@clack/prompts";
import { shouldSkipStartupUpgradeCheck } from "@openmeld/local-service";
import { runUpgrade } from "../commands/upgrade";
import {
  compareSemver,
  ensureVersionStateReady as ensureVersionStateReadyShared,
  fetchLatestPackageVersion,
  fetchPackageVersionMetadata,
} from "../config/version-state";
import { resolveRuntimeContext } from "../runtime/context";
import { OPENMELD_VERSION } from "../runtime/version";
import {
  isPassiveCliQueryArgv,
  parseFirstCommandTokenFromArgv,
  parseViewFromArgv,
} from "../runtime/view-argv";

const OPENMELD_PACKAGE_NAME = "openmeld";
const STARTUP_INTERNAL_SKIP_ENV = "OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE";
const STARTUP_AUTO_UPGRADE_ENV = "OPENMELD_STARTUP_AUTO_UPGRADE";

export type StartupDeprecatedVersionWarning = {
  currentVersion: string;
  deprecatedMessage: string;
  upgradeCommand: "openmeld upgrade";
};

export type StartupUpgradeTrigger =
  | "interactive_prompt"
  | "non_interactive_auto";

export async function maybeRunStartupUpgradeCheck(input: {
  argv: string[];
  isKnownTopLevelCommand: (token: string) => boolean;
}): Promise<{
  upgraded: boolean;
  resolvedView: "human" | "agent" | null;
  deprecatedWarning: StartupDeprecatedVersionWarning | null;
  trigger: StartupUpgradeTrigger | null;
  latestVersion: string | null;
}> {
  if (shouldSkipStartupUpgradeCheckByEnv()) {
    return {
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    };
  }

  if (isPassiveCliQueryArgv(input.argv)) {
    return {
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    };
  }

  const firstCommand = parseFirstCommandTokenFromArgv(input.argv);
  if (!firstCommand) {
    return {
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    };
  }
  if (!input.isKnownTopLevelCommand(firstCommand)) {
    return {
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    };
  }
  if (shouldSkipStartupUpgradeCheck(firstCommand)) {
    return {
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    };
  }

  const explicitView = parseViewFromArgv(input.argv, {
    allowMissingValue: true,
  });
  const runtime = await resolveRuntimeContext({
    ...(explicitView ? { view: explicitView } : {}),
  });
  const currentVersion = OPENMELD_VERSION;
  const deprecatedWarning = await resolveDeprecatedVersionWarning({
    currentVersion,
  });
  if (
    !(
      (runtime.resolvedView === "human" && runtime.interactive) ||
      isStartupAutoUpgradeEnabled()
    )
  ) {
    return {
      upgraded: false,
      resolvedView: runtime.resolvedView,
      deprecatedWarning,
      trigger: null,
      latestVersion: null,
    };
  }

  const latestVersion = await fetchLatestPackageVersion(
    OPENMELD_PACKAGE_NAME
  ).catch(() => null);
  if (!latestVersion || compareSemver(currentVersion, latestVersion) >= 0) {
    return {
      upgraded: false,
      resolvedView: runtime.resolvedView,
      deprecatedWarning,
      trigger: null,
      ...(latestVersion ? { latestVersion } : { latestVersion: null }),
    };
  }

  if (runtime.resolvedView === "human" && runtime.interactive) {
    const selected = await confirm({
      message: `Upgrade OpenMeld CLI from ${currentVersion} to ${latestVersion}?`,
      initialValue: true,
    });
    if (isCancel(selected) || !selected) {
      return {
        upgraded: false,
        resolvedView: runtime.resolvedView,
        deprecatedWarning,
        trigger: null,
        latestVersion,
      };
    }

    await ensureVersionStateReady(currentVersion);
    await runUpgrade({
      yes: true,
      view: runtime.resolvedView,
    });
    return {
      upgraded: true,
      resolvedView: runtime.resolvedView,
      deprecatedWarning,
      trigger: "interactive_prompt",
      latestVersion,
    };
  }

  await ensureVersionStateReady(currentVersion);
  await runUpgrade({
    yes: true,
    view: runtime.resolvedView,
  });
  return {
    upgraded: true,
    resolvedView: runtime.resolvedView,
    deprecatedWarning,
    trigger: "non_interactive_auto",
    latestVersion,
  };
}

async function resolveDeprecatedVersionWarning(input: {
  currentVersion: string;
}): Promise<StartupDeprecatedVersionWarning | null> {
  try {
    const metadata = await fetchPackageVersionMetadata({
      packageName: OPENMELD_PACKAGE_NAME,
      version: input.currentVersion,
    });
    if (!metadata.deprecated) {
      return null;
    }
    return {
      currentVersion: input.currentVersion,
      deprecatedMessage: metadata.deprecated,
      upgradeCommand: "openmeld upgrade",
    };
  } catch {
    return null;
  }
}

async function ensureVersionStateReady(currentVersion: string): Promise<void> {
  await ensureVersionStateReadyShared({
    currentVersion,
  });
}

function shouldSkipStartupUpgradeCheckByEnv(): boolean {
  return String(process.env[STARTUP_INTERNAL_SKIP_ENV] ?? "").trim() === "1";
}

function isStartupAutoUpgradeEnabled(): boolean {
  const raw = String(process.env[STARTUP_AUTO_UPGRADE_ENV] ?? "").trim();
  if (!raw) {
    return true;
  }
  const normalized = raw.toLowerCase();
  return !(
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "no"
  );
}
