import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import {
  buildCliLaunchInvocation,
  materializeCliLaunchCommand,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  GrokBuildAcpTransportError,
  probeGrokBuildAcpInterface,
} from "@openmeld/adapter-grok-build";
import { resolvePublicAgentAvailabilityCopy } from "@openmeld/schemas";
import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerInterfaceLaunchSnapshot,
  AgentControllerInterfaceModel,
  AgentControllerInterfaceSkill,
  AgentControllerInterfaceSnapshot,
  AgentControllerInterfaceStatus,
  AgentControllerInterfaceVersionAdvisory,
} from "@openmeld/schemas/types";
import {
  type BuiltinAgentControllerVersionMaintenanceDefinition,
  EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
  resolveBuiltinAgentControllerDefinition,
} from "../../agents/builtin-agent-controller-definitions";
import {
  hasPathSeparator,
  isBunGlobalCommandPath,
  isHomebrewCommandPath,
  isNpmGlobalCommandPath,
  isPnpmGlobalCommandPath,
} from "../../agents/controller-command-paths";
import type { AgentTargetState } from "../../agents/registry";
import { warnDaemonEvent } from "../core/logger";
import {
  buildAgentControllerInterfaceKeeperKey,
  didAgentControllerCommandFingerprintRemainStable,
  readLastSuccessfulAgentControllerInterfaceCheckAt,
  readReusableAgentControllerInterfaceSnapshot,
  recordAgentControllerInterfaceProbeFailure,
  recordAgentControllerInterfaceProbeSuccess,
  resolveAgentControllerCommandFingerprint,
} from "./agent-controller-interface-keeper";
import { probeOpenCodeReadiness } from "./opencode-readiness-probe";

const PROBE_TIMEOUT_MS = 8000;
const CODEX_AUX_INVENTORY_GRACE_MS = 2500;
const LATEST_VERSION_TIMEOUT_MS = 4000;
const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILED_LATEST_VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const PROBE_OUTPUT_LIMIT = 32_000;
const CODEX_USER_AGENT_VERSION_RE = /\/([^\s]+)/u;
const CLI_SEMVER_RE = /\b(\d+\.\d+\.\d+(?:[-+][^\s]+)?)\b/u;
const SEMVER_CORE_RE = /^v?(\d+)\.(\d+)\.(\d+)/u;
const WHITESPACE_RE = /\s+/u;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
// Keep the non-JSON fallback credential-specific. This auth probe must not
// classify unrelated IDs, paths, or hook output as controller auth truth.
const CLAUDE_UNAUTHENTICATED_OUTPUT_PATTERNS = [
  "invalid api key",
  "invalid token",
  "expired token",
  "missing api key",
  "missing credentials",
  "authentication_failed",
  "oauth_org_not_allowed",
  "failed to authenticate",
  "authentication failed",
  "oauth session expired",
  "not logged in",
  "not authenticated",
  "not signed in",
  "login required",
] as const;

type LatestVersionFetchFailureDiagnostic = {
  attempt: 1 | 2;
  errorMessage: string | null;
  errorName: string | null;
  reason: "http_error" | "invalid_response" | "request_error" | "timeout";
  statusCode: number | null;
  url: string;
};

type LatestVersionLookupResult = {
  failureDiagnostics: readonly LatestVersionFetchFailureDiagnostic[];
  version: string | null;
};

const latestControllerVersionCache = new Map<
  string,
  { expiresAtMs: number; version: string | null }
>();

type ControllerVersionBaseline =
  | {
      kind: "homebrew";
      package: NonNullable<
        BuiltinAgentControllerVersionMaintenanceDefinition["homebrewPackage"]
      >;
    }
  | {
      kind: "npm";
      packageName: string;
    };

// "fresh" always runs the controller probe and reports its real outcome; it is
// the default for user-driven paths (setup, prepare, explicit checks).
// "background" is the periodic report-sync policy on machines we do not want
// to burden: it reuses a completed, reusable snapshot within a TTL. A failed
// or unauthenticated probe invalidates that reuse so the next pass probes again.
export type AgentControllerInterfaceProbePolicy = "background" | "fresh";

type AgentControllerInterfaceProbeOutcome = {
  probeCompleted: boolean;
  snapshot: AgentControllerInterfaceSnapshot;
};

type AgentControllerInterfaceSnapshotResolver = (input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}) => Promise<AgentControllerInterfaceProbeOutcome>;

const CONTROLLER_INTERFACE_SNAPSHOT_RESOLVERS: Record<
  string,
  AgentControllerInterfaceSnapshotResolver
> = {
  "claude-code": resolveClaudeCodeInterfaceSnapshot,
  codex: resolveCodexInterfaceSnapshot,
  cursor: resolveCursorInterfaceSnapshot,
  "grok-build": resolveGrokBuildInterfaceSnapshot,
  openclaw: resolveOpenClawInterfaceSnapshot,
  opencode: resolveOpenCodeInterfaceSnapshot,
};

export async function resolveAgentControllerInterfaceSnapshot(input: {
  agentControllerRef: string;
  probePolicy?: AgentControllerInterfaceProbePolicy;
  state: AgentTargetState & { targetKind: "builtin" };
}): Promise<AgentControllerInterfaceSnapshot> {
  const checkedAt = new Date().toISOString();
  const controllerDefinition = resolveBuiltinAgentControllerDefinition(
    input.state.agentId
  );
  const launch = resolveLaunchSnapshot(input.state);
  const baseSnapshot: AgentControllerInterfaceSnapshot = {
    agentControllerRef: input.agentControllerRef,
    auth: { status: "unknown" },
    capabilities:
      controllerDefinition?.capabilities ??
      EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
    check: {
      lastSucceededAt: null,
      status: "not_run",
    },
    checkedAt,
    controllerId: input.state.agentId,
    displayName: input.state.displayName,
    launch,
    message: input.state.launchStatusDetail ?? null,
    models: [],
    nativeInterface: controllerDefinition?.nativeInterface ?? "local-cli",
    schemaVersion: 1,
    skills: [],
    status: resolveBaseStatus(input.state),
    version: null,
  };

  if (input.state.launchStatus !== "ready" || !input.state.launchContract) {
    return baseSnapshot;
  }

  const snapshotResolver =
    CONTROLLER_INTERFACE_SNAPSHOT_RESOLVERS[input.state.agentId];
  if (!snapshotResolver) {
    return baseSnapshot;
  }

  const probePolicy = input.probePolicy ?? "fresh";
  const commandPath = resolveLaunchContractCommandPath(
    input.state.launchContract
  );
  const launchContractKind = input.state.launchContract.kind;
  const keeperKey = buildAgentControllerInterfaceKeeperKey({
    agentId: input.state.agentId,
    commandPath,
  });
  const commandFingerprintBeforeProbe =
    await resolveAgentControllerCommandFingerprint({
      commandPath,
      launchContractKind,
    });
  const lastSuccessfulCheckAt =
    readLastSuccessfulAgentControllerInterfaceCheckAt({
      commandFingerprint: commandFingerprintBeforeProbe,
      keeperKey,
    });
  if (probePolicy === "background") {
    const reusableSnapshot = readReusableAgentControllerInterfaceSnapshot({
      commandFingerprint: commandFingerprintBeforeProbe,
      keeperKey,
      nowMs: Date.now(),
    });
    if (reusableSnapshot) {
      return reusableSnapshot;
    }
  }

  const outcome = await snapshotResolver({
    baseSnapshot,
    launchContract: input.state.launchContract,
  });
  const commandFingerprintAfterProbe =
    await resolveAgentControllerCommandFingerprint({
      commandPath,
      launchContractKind,
    });
  const commandFingerprintRemainedStable =
    didAgentControllerCommandFingerprintRemainStable({
      afterProbe: commandFingerprintAfterProbe,
      beforeProbe: commandFingerprintBeforeProbe,
    });
  if (outcome.probeCompleted) {
    const completedSnapshot: AgentControllerInterfaceSnapshot = {
      ...outcome.snapshot,
      check: {
        lastSucceededAt: outcome.snapshot.checkedAt,
        status: "succeeded",
      },
    };
    if (commandFingerprintRemainedStable && commandFingerprintAfterProbe) {
      recordAgentControllerInterfaceProbeSuccess({
        commandFingerprint: commandFingerprintAfterProbe,
        keeperKey,
        nowMs: Date.now(),
        snapshot: completedSnapshot,
      });
    }
    return completedSnapshot;
  }

  recordAgentControllerInterfaceProbeFailure({
    keeperKey,
    preserveHistoricalEvidence: commandFingerprintRemainedStable,
  });
  const preservedLastSuccessfulCheckAt = commandFingerprintRemainedStable
    ? lastSuccessfulCheckAt
    : null;
  warnDaemonEvent("[openmeld.agent_controller_interface.check_failed]", {
    agentControllerRef: input.agentControllerRef,
    commandFingerprintRemainedStable,
    controllerId: input.state.agentId,
    errorMessage: outcome.snapshot.message,
    lastSucceededAt: preservedLastSuccessfulCheckAt,
    probePolicy,
  });
  return {
    ...outcome.snapshot,
    check: {
      lastSucceededAt: preservedLastSuccessfulCheckAt,
      status: "failed",
    },
    // A failed check is not proof that the controller itself is broken.
    status: "unknown",
  };
}

function resolveLaunchSnapshot(
  state: AgentTargetState & { targetKind: "builtin" }
): AgentControllerInterfaceLaunchSnapshot {
  const launchCommand = state.launchContract
    ? materializeCliLaunchCommand({ launchContract: state.launchContract })
    : null;
  return {
    argsPrefix: launchCommand?.argsPrefix ?? [],
    commandPath: state.launchContract
      ? resolveLaunchContractCommandPath(state.launchContract)
      : null,
    installChoiceCount: state.installChoices.length,
    status: state.launchStatus,
  };
}

function resolveBaseStatus(
  state: AgentTargetState & { targetKind: "builtin" }
): AgentControllerInterfaceStatus {
  if (!state.enabled) {
    return "disabled";
  }
  if (!state.detected) {
    return "unavailable";
  }
  if (state.launchStatus === "ready") {
    return "ready";
  }
  if (
    state.launchStatus === "needs_choice" ||
    state.launchStatus === "needs_repair"
  ) {
    return "warning";
  }
  return "unknown";
}

async function resolveControllerVersionAdvisory(input: {
  checkedAt: string;
  controllerId: string;
  currentVersion: string | null;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceVersionAdvisory | undefined> {
  const definition = resolveBuiltinAgentControllerDefinition(
    input.controllerId
  )?.versionMaintenance;
  if (!definition) {
    return undefined;
  }
  const commandPath = resolveLaunchContractCommandPath(input.launchContract);
  const realCommandPath = await realpath(commandPath).catch(() => null);
  const commandPaths = [commandPath, realCommandPath].filter(
    (value): value is string => Boolean(value)
  );
  const updateCommand = resolveControllerUpdateCommand({
    commandPath,
    commandPaths,
    definition,
  });
  if (!input.currentVersion) {
    return {
      checkedAt: input.checkedAt,
      currentVersion: null,
      latestVersion: null,
      message: "OpenMeld could not read this controller version.",
      status: "unknown",
      updateCommand,
    };
  }

  const latestVersion = await resolveLatestControllerVersion(
    resolveControllerVersionBaseline({ commandPaths, definition })
  );
  if (!latestVersion) {
    return {
      checkedAt: input.checkedAt,
      currentVersion: input.currentVersion,
      latestVersion: null,
      message: "OpenMeld could not check the latest controller version.",
      status: "unknown",
      updateCommand,
    };
  }

  const versionComparison = compareSemverCore(
    input.currentVersion,
    latestVersion
  );
  if (versionComparison === null) {
    return {
      checkedAt: input.checkedAt,
      currentVersion: input.currentVersion,
      latestVersion,
      message: "OpenMeld could not compare the installed controller version.",
      status: "unknown",
      updateCommand,
    };
  }

  if (versionComparison < 0) {
    return {
      checkedAt: input.checkedAt,
      currentVersion: input.currentVersion,
      latestVersion,
      message: "Update available.",
      status: "behind_latest",
      updateCommand,
    };
  }

  return {
    checkedAt: input.checkedAt,
    currentVersion: input.currentVersion,
    latestVersion,
    message: null,
    status: "current",
    updateCommand,
  };
}

function resolveControllerUpdateCommand(input: {
  commandPath: string;
  commandPaths: readonly string[];
  definition: BuiltinAgentControllerVersionMaintenanceDefinition;
}): string | null {
  if (
    input.definition.officialUpdateCommand &&
    input.commandPaths.some(input.definition.officialUpdatePath)
  ) {
    return input.definition.officialUpdateCommand;
  }
  if (input.commandPaths.some(isBunGlobalCommandPath)) {
    return input.definition.npmPackageName
      ? `bun i -g ${input.definition.npmPackageName}@latest`
      : null;
  }
  if (input.commandPaths.some(isPnpmGlobalCommandPath)) {
    return input.definition.npmPackageName
      ? `pnpm add -g ${input.definition.npmPackageName}@latest`
      : null;
  }
  if (input.commandPaths.some(isNpmGlobalCommandPath)) {
    return input.definition.npmPackageName
      ? `npm install -g ${input.definition.npmPackageName}@latest`
      : null;
  }
  if (
    input.definition.homebrewPackage &&
    input.commandPaths.some(isHomebrewCommandPath)
  ) {
    const caskFlag =
      input.definition.homebrewPackage.kind === "cask" ? " --cask" : "";
    return `brew upgrade${caskFlag} ${input.definition.homebrewPackage.name}`;
  }
  if (!hasPathSeparator(input.commandPath)) {
    return input.definition.npmPackageName
      ? `npm install -g ${input.definition.npmPackageName}@latest`
      : null;
  }
  return null;
}

function resolveControllerVersionBaseline(input: {
  commandPaths: readonly string[];
  definition: BuiltinAgentControllerVersionMaintenanceDefinition;
}): ControllerVersionBaseline | null {
  if (
    input.commandPaths.some(isBunGlobalCommandPath) ||
    input.commandPaths.some(isPnpmGlobalCommandPath) ||
    input.commandPaths.some(isNpmGlobalCommandPath)
  ) {
    if (input.definition.npmPackageName) {
      return {
        kind: "npm",
        packageName: input.definition.npmPackageName,
      };
    }
    if (input.definition.homebrewPackage) {
      return {
        kind: "homebrew",
        package: input.definition.homebrewPackage,
      };
    }
    return null;
  }
  if (input.commandPaths.some(isHomebrewCommandPath)) {
    return input.definition.homebrewPackage
      ? { kind: "homebrew", package: input.definition.homebrewPackage }
      : null;
  }
  if (input.definition.npmPackageName) {
    return { kind: "npm", packageName: input.definition.npmPackageName };
  }
  return input.definition.homebrewPackage
    ? { kind: "homebrew", package: input.definition.homebrewPackage }
    : null;
}

async function resolveLatestControllerVersion(
  baseline: ControllerVersionBaseline | null
): Promise<string | null> {
  if (!baseline) {
    return null;
  }
  const cacheKey =
    baseline.kind === "npm"
      ? `npm:${baseline.packageName}`
      : `brew-${baseline.package.kind}:${baseline.package.name}`;
  const nowMs = Date.now();
  const cached = latestControllerVersionCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.version;
  }

  const lookupResult =
    baseline.kind === "npm"
      ? await fetchLatestNpmVersion(baseline.packageName)
      : await fetchLatestHomebrewVersion(baseline.package);
  recordLatestVersionFailureDiagnostics(lookupResult);
  latestControllerVersionCache.set(cacheKey, {
    expiresAtMs:
      nowMs +
      (lookupResult.version
        ? LATEST_VERSION_CACHE_TTL_MS
        : FAILED_LATEST_VERSION_CACHE_TTL_MS),
    version: lookupResult.version,
  });
  return lookupResult.version;
}

function recordLatestVersionFailureDiagnostics(
  lookupResult: LatestVersionLookupResult
): void {
  for (const diagnostic of lookupResult.failureDiagnostics) {
    warnDaemonEvent(
      "[openmeld.agent_controller.latest_version_lookup_attempt_failed]",
      {
        attempt: diagnostic.attempt,
        errorMessage: diagnostic.errorMessage,
        errorName: diagnostic.errorName,
        reason: diagnostic.reason,
        recovered: lookupResult.version !== null,
        statusCode: diagnostic.statusCode,
        url: diagnostic.url,
      }
    );
  }
}

function fetchLatestHomebrewVersion(
  homebrewPackage: NonNullable<
    BuiltinAgentControllerVersionMaintenanceDefinition["homebrewPackage"]
  >
): Promise<LatestVersionLookupResult> {
  return fetchLatestVersion({
    resolveVersion: (payload) =>
      homebrewPackage.kind === "cask"
        ? normalizeOptionalText(payload?.version)
        : normalizeOptionalText(toRecord(payload?.versions)?.stable),
    url: `https://formulae.brew.sh/api/${homebrewPackage.kind}/${encodeURIComponent(homebrewPackage.name)}.json`,
  });
}

function fetchLatestNpmVersion(
  npmPackageName: string
): Promise<LatestVersionLookupResult> {
  return fetchLatestVersion({
    resolveVersion: (payload) => normalizeOptionalText(payload?.version),
    url: `https://registry.npmjs.org/${encodeURIComponent(npmPackageName)}/latest`,
  });
}

async function fetchLatestVersion(input: {
  resolveVersion: (payload: Record<string, unknown> | null) => string | null;
  url: string;
}): Promise<LatestVersionLookupResult> {
  const failureDiagnostics: LatestVersionFetchFailureDiagnostic[] = [];
  for (const attempt of [1, 2] as const) {
    const attemptResult = await fetchLatestVersionAttempt({
      ...input,
      attempt,
    });
    if (attemptResult.ok) {
      return {
        failureDiagnostics,
        version: attemptResult.version,
      };
    }
    failureDiagnostics.push(attemptResult.failureDiagnostic);
  }
  return { failureDiagnostics, version: null };
}

async function fetchLatestVersionAttempt(input: {
  attempt: 1 | 2;
  resolveVersion: (payload: Record<string, unknown> | null) => string | null;
  url: string;
}): Promise<
  | { failureDiagnostic: LatestVersionFetchFailureDiagnostic; ok: false }
  | { ok: true; version: string }
> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, LATEST_VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      headers: { accept: "application/json" },
      signal: abortController.signal,
    });
    if (!response.ok) {
      return {
        failureDiagnostic: {
          attempt: input.attempt,
          errorMessage: null,
          errorName: null,
          reason: "http_error",
          statusCode: response.status,
          url: input.url,
        },
        ok: false,
      };
    }
    const payload = toRecord(await response.json());
    const version = input.resolveVersion(payload);
    if (!version) {
      return {
        failureDiagnostic: {
          attempt: input.attempt,
          errorMessage: null,
          errorName: null,
          reason: "invalid_response",
          statusCode: response.status,
          url: input.url,
        },
        ok: false,
      };
    }
    return { ok: true, version };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : null;
    return {
      failureDiagnostic: {
        attempt: input.attempt,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName,
        reason: errorName === "AbortError" ? "timeout" : "request_error",
        statusCode: null,
        url: input.url,
      },
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function compareSemverCore(left: string, right: string): number | null {
  const leftParts = parseSemverCore(left);
  const rightParts = parseSemverCore(right);
  if (!(leftParts && rightParts)) {
    return null;
  }
  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

function parseSemverCore(value: string): [number, number, number] | null {
  const match = value.trim().match(SEMVER_CORE_RE);
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  if (!(major && minor && patch)) {
    return null;
  }
  return [Number(major), Number(minor), Number(patch)];
}

async function resolveCodexInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const appServerProbe = await probeCodexAppServer(input.launchContract);
  if (appServerProbe.ok) {
    const version = appServerProbe.version ?? input.baseSnapshot.version;
    return {
      probeCompleted: true,
      snapshot: {
        ...input.baseSnapshot,
        auth: appServerProbe.auth,
        message: appServerProbe.message,
        models: appServerProbe.models,
        skills: appServerProbe.skills,
        status: appServerProbe.status,
        version,
        versionAdvisory: await resolveControllerVersionAdvisory({
          checkedAt: input.baseSnapshot.checkedAt,
          controllerId: input.baseSnapshot.controllerId,
          currentVersion: version,
          launchContract: input.launchContract,
        }),
      },
    };
  }

  const versionProbe = await runLaunchContractCommand({
    args: ["--version"],
    launchContract: input.launchContract,
  });

  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  return {
    probeCompleted: false,
    snapshot: {
      ...input.baseSnapshot,
      message: appServerProbe.message,
      status:
        input.baseSnapshot.status === "ready" &&
        appServerProbe.auth.status === "unknown"
          ? "warning"
          : input.baseSnapshot.status,
      version,
      versionAdvisory: await resolveControllerVersionAdvisory({
        checkedAt: input.baseSnapshot.checkedAt,
        controllerId: input.baseSnapshot.controllerId,
        currentVersion: version,
        launchContract: input.launchContract,
      }),
    },
  };
}

async function resolveClaudeCodeInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      allowNonZeroExit: true,
      args: ["auth", "status"],
      launchContract: input.launchContract,
    }),
  ]);

  const auth = resolveClaudeAuthSnapshot(authProbe);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  return {
    probeCompleted: authProbe.ok,
    snapshot: {
      ...input.baseSnapshot,
      auth,
      message:
        auth.status === "unauthenticated"
          ? "Claude Code is installed, but this computer is not signed in to Claude Code."
          : input.baseSnapshot.message,
      status:
        auth.status === "unauthenticated" ? "error" : input.baseSnapshot.status,
      version,
      versionAdvisory: await resolveControllerVersionAdvisory({
        checkedAt: input.baseSnapshot.checkedAt,
        controllerId: input.baseSnapshot.controllerId,
        currentVersion: version,
        launchContract: input.launchContract,
      }),
    },
  };
}

async function resolveCursorInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      allowNonZeroExit: true,
      args: ["status"],
      launchContract: input.launchContract,
    }),
  ]);
  const auth = resolveCursorAuthSnapshot(authProbe);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  let message = input.baseSnapshot.message;
  let status = input.baseSnapshot.status;
  if (auth.status === "unauthenticated") {
    message = requireControllerSignInInterfaceDescription("cursor");
    status = "error";
  } else if (auth.status === "unknown") {
    message = "OpenMeld could not read Cursor CLI authentication status.";
    status = "warning";
  }
  return {
    probeCompleted: authProbe.ok && auth.status !== "unknown",
    snapshot: {
      ...input.baseSnapshot,
      auth,
      message,
      status,
      version,
      versionAdvisory: await resolveControllerVersionAdvisory({
        checkedAt: input.baseSnapshot.checkedAt,
        controllerId: input.baseSnapshot.controllerId,
        currentVersion: version,
        launchContract: input.launchContract,
      }),
    },
  };
}

async function resolveGrokBuildInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, interfaceProbe] = await Promise.all([
    runLaunchContractCommand({
      args: ["--no-auto-update", "version"],
      launchContract: input.launchContract,
    }),
    probeGrokBuildAcpInterface({
      grokBuildTimeoutMs: PROBE_TIMEOUT_MS,
      grokBuildWorkdir: process.cwd(),
      launchContract: input.launchContract,
    }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ error, ok: false as const })
    ),
  ]);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  if (interfaceProbe.ok) {
    return {
      probeCompleted: true,
      snapshot: {
        ...input.baseSnapshot,
        auth: {
          label: "Grok account connected",
          status: "authenticated",
          type: interfaceProbe.result.authMethodId,
        },
        message: null,
        models: interfaceProbe.result.models,
        status: "ready",
        version,
        versionAdvisory: await resolveControllerVersionAdvisory({
          checkedAt: input.baseSnapshot.checkedAt,
          controllerId: input.baseSnapshot.controllerId,
          currentVersion: version,
          launchContract: input.launchContract,
        }),
      },
    };
  }

  const unauthenticated =
    interfaceProbe.error instanceof GrokBuildAcpTransportError &&
    (interfaceProbe.error.code === "auth.required" ||
      interfaceProbe.error.code === "auth.failed");
  return {
    probeCompleted: unauthenticated,
    snapshot: {
      ...input.baseSnapshot,
      auth: { status: unauthenticated ? "unauthenticated" : "unknown" },
      message: unauthenticated
        ? requireControllerSignInInterfaceDescription("grok-build")
        : `OpenMeld could not read Grok Build's ACP status: ${toErrorMessage(
            interfaceProbe.error
          )}`,
      status: unauthenticated ? "error" : "warning",
      version,
      versionAdvisory: await resolveControllerVersionAdvisory({
        checkedAt: input.baseSnapshot.checkedAt,
        controllerId: input.baseSnapshot.controllerId,
        currentVersion: version,
        launchContract: input.launchContract,
      }),
    },
  };
}

async function resolveOpenClawInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      allowNonZeroExit: true,
      args: ["models", "status", "--check", "--json"],
      launchContract: input.launchContract,
    }),
  ]);

  const authResult = resolveOpenClawAuthProbe(authProbe);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  let message = input.baseSnapshot.message;
  if (!authResult.probeCompleted) {
    message =
      "OpenMeld could not read OpenClaw model provider authentication status. Check OpenClaw configuration and update OpenClaw if this command is unavailable.";
  }
  if (authResult.auth.status === "unauthenticated") {
    message =
      "OpenClaw is installed, but its model provider credentials are missing or expired. Re-authenticate the model provider in OpenClaw before OpenMeld can launch it.";
  }
  return {
    probeCompleted: authResult.probeCompleted,
    snapshot: {
      ...input.baseSnapshot,
      auth: authResult.auth,
      message,
      status:
        authResult.auth.status === "unauthenticated" ||
        !authResult.probeCompleted
          ? "error"
          : input.baseSnapshot.status,
      version,
    },
  };
}

async function resolveOpenCodeInterfaceSnapshot(input: {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, readinessProbe] = await Promise.all([
    runLaunchContractCommand({
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    probeOpenCodeReadiness({
      launchContract: input.launchContract,
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
  ]);

  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  return {
    probeCompleted: readinessProbe.probeCompleted,
    snapshot: {
      ...input.baseSnapshot,
      auth: readinessProbe.auth,
      message: readinessProbe.message ?? input.baseSnapshot.message,
      models: readinessProbe.models,
      status: readinessProbe.status,
      version,
      versionAdvisory: await resolveControllerVersionAdvisory({
        checkedAt: input.baseSnapshot.checkedAt,
        controllerId: input.baseSnapshot.controllerId,
        currentVersion: version,
        launchContract: input.launchContract,
      }),
    },
  };
}

type CommandProbeResult =
  | {
      code: number;
      ok: true;
      stderr: string;
      stdout: string;
    }
  | {
      code: number | null;
      errorMessage: string;
      ok: false;
      stderr: string;
      stdout: string;
    };

function runLaunchContractCommand(input: {
  allowNonZeroExit?: boolean;
  args: string[];
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs?: number;
}): Promise<CommandProbeResult> {
  const invocation = buildCliLaunchInvocation({
    args: input.args,
    launchContract: input.launchContract,
  });
  return runCommand({
    allowNonZeroExit: input.allowNonZeroExit,
    args: invocation.args,
    bin: invocation.bin,
    shell: invocation.shell,
    timeoutMs: input.timeoutMs,
  });
}

function runCommand(input: {
  allowNonZeroExit?: boolean;
  args: string[];
  bin: string;
  shell?: boolean;
  timeoutMs?: number;
}): Promise<CommandProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(input.bin, input.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: input.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        code: null,
        errorMessage: `Timed out after ${input.timeoutMs ?? PROBE_TIMEOUT_MS}ms.`,
        ok: false,
        stderr,
        stdout,
      });
    }, input.timeoutMs ?? PROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = appendProbeOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendProbeOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        code: null,
        errorMessage: error.message,
        ok: false,
        stderr,
        stdout,
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const exitCode = typeof code === "number" ? code : null;
      if (exitCode === 0 || input.allowNonZeroExit === true) {
        resolve({
          code: exitCode ?? 0,
          ok: true,
          stderr,
          stdout,
        });
        return;
      }
      resolve({
        code: exitCode,
        errorMessage: `Command exited with code ${exitCode ?? "unknown"}.`,
        ok: false,
        stderr,
        stdout,
      });
    });
  });
}

type JsonRpcMessage = {
  error?: { message?: string };
  id?: number | string | null;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
};

type CodexAppServerProbeResult =
  | {
      auth: AgentControllerInterfaceAuthSnapshot;
      message: string | null;
      models: AgentControllerInterfaceModel[];
      ok: true;
      skills: AgentControllerInterfaceSkill[];
      status: AgentControllerInterfaceStatus;
      version: string | null;
    }
  | {
      auth: AgentControllerInterfaceAuthSnapshot;
      message: string;
      ok: false;
    };

function probeCodexAppServer(
  launchContract: RuntimeAgentControllerLaunchContract
): Promise<CodexAppServerProbeResult> {
  const invocation = buildCliLaunchInvocation({
    args: ["app-server", "--listen", "stdio://"],
    launchContract,
  });

  return new Promise((resolve) => {
    const child = spawn(invocation.bin, invocation.args, {
      cwd: process.cwd(),
      env: process.env,
      shell: invocation.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pending = new Map<
      number,
      {
        reject: (error: unknown) => void;
        resolve: (value: unknown) => void;
      }
    >();
    let nextId = 1;
    let lineBuffer = "";
    let stderr = "";
    let settled = false;
    const finish = (result: CodexAppServerProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      for (const entry of pending.values()) {
        entry.reject(new Error("Codex app-server probe closed."));
      }
      pending.clear();
      child.kill("SIGTERM");
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({
        auth: { status: "unknown" },
        message: "Timed out while checking Codex app-server status.",
        ok: false,
      });
    }, PROBE_TIMEOUT_MS);

    const request = (method: string, params: unknown): Promise<unknown> => {
      const id = nextId;
      nextId += 1;
      const promise = new Promise<unknown>((requestResolve, requestReject) => {
        pending.set(id, {
          reject: requestReject,
          resolve: requestResolve,
        });
      });
      child.stdin.write(
        `${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`
      );
      return promise;
    };
    const notify = (method: string, params: unknown): void => {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`
      );
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      lineBuffer = consumeJsonRpcMessagesFromChunk({
        chunk,
        lineBuffer,
        onMessage: (message) =>
          handleCodexProbeMessage({
            message,
            pending,
            stdin: child.stdin,
          }),
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendProbeOutput(stderr, chunk);
    });
    child.stdin.on("error", (error) => {
      finish({
        auth: { status: "unknown" },
        message: `Codex app-server input closed before status could be read: ${toErrorMessage(error)}`,
        ok: false,
      });
    });
    child.on("error", (error) => {
      finish({
        auth: { status: "unknown" },
        message: `Codex app-server could not start: ${error.message}`,
        ok: false,
      });
    });
    child.on("close", () => {
      if (!settled) {
        finish({
          auth: { status: "unknown" },
          message: `Codex app-server exited before status could be read${
            stderr ? `: ${stderr.trim()}` : "."
          }`,
          ok: false,
        });
      }
    });

    runCodexAppServerProbeRequests({
      clearProbeTimeout: () => {
        clearTimeout(timeout);
      },
      finish,
      notify,
      request,
    }).catch((error: unknown) => {
      finish({
        auth: { status: "unknown" },
        message: `Codex app-server status check failed: ${toErrorMessage(error)}`,
        ok: false,
      });
    });
  });
}

async function runCodexAppServerProbeRequests(input: {
  clearProbeTimeout: () => void;
  finish: (result: CodexAppServerProbeResult) => void;
  notify: (method: string, params: unknown) => void;
  request: (method: string, params: unknown) => Promise<unknown>;
}): Promise<void> {
  const initialized = await input.request("initialize", {
    capabilities: { experimentalApi: true },
    clientInfo: {
      name: "openmeld",
      version: "0.0.0",
    },
  });
  input.notify("initialized", {});
  // Fire auxiliary inventory first so it overlaps the account read.
  const skillsPromise = input
    .request("skills/list", { cwds: [process.cwd()] })
    .catch(() => null);
  const modelsPromise = requestAllCodexModels(input.request).catch(() => []);
  const account = await input.request("account/read", {});
  // The account verdict is the core probe fact. Once it arrives the probe can
  // no longer time out; auxiliary model/skill inventory only gets a bounded
  // grace so a slow listing cannot turn a healthy controller into a timeout.
  input.clearProbeTimeout();
  const [skills, models] = await resolveWithinGrace(
    Promise.all([skillsPromise, modelsPromise]),
    CODEX_AUX_INVENTORY_GRACE_MS,
    [null, []]
  );
  const auth = resolveCodexAuthSnapshot(account);
  input.finish({
    auth,
    message:
      auth.status === "unauthenticated"
        ? requireControllerSignInInterfaceDescription("codex")
        : null,
    models: parseCodexModels(models),
    ok: true,
    skills: parseCodexSkills(skills),
    status: auth.status === "unauthenticated" ? "error" : "ready",
    version: parseCodexUserAgentVersion(initialized),
  });
}

function requireControllerSignInInterfaceDescription(
  agentControllerId: string
): string {
  const description = resolvePublicAgentAvailabilityCopy(
    "controller.auth.unauthenticated",
    { agentControllerId }
  )?.controllerInterfaceDescription;
  if (!description) {
    throw new Error(
      `Shared ${agentControllerId} controller sign-in description is missing`
    );
  }
  return description;
}

function resolveWithinGrace<T>(
  promise: Promise<T>,
  graceMs: number,
  fallback: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, graceMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function consumeJsonRpcMessagesFromChunk(input: {
  chunk: unknown;
  lineBuffer: string;
  onMessage: (message: JsonRpcMessage) => void;
}): string {
  let lineBuffer = `${input.lineBuffer}${String(input.chunk)}`;
  while (true) {
    const nextLineIndex = lineBuffer.indexOf("\n");
    if (nextLineIndex < 0) {
      return lineBuffer;
    }
    const line = lineBuffer.slice(0, nextLineIndex).trim();
    lineBuffer = lineBuffer.slice(nextLineIndex + 1);
    if (!line) {
      continue;
    }
    const parsed = parseJsonRpcMessage(line);
    if (parsed) {
      input.onMessage(parsed);
    }
  }
}

function handleCodexProbeMessage(input: {
  message: JsonRpcMessage;
  pending: Map<
    number,
    {
      reject: (error: unknown) => void;
      resolve: (value: unknown) => void;
    }
  >;
  stdin: NodeJS.WritableStream;
}): void {
  const id = input.message.id;
  if (typeof id === "number") {
    const entry = input.pending.get(id);
    if (!entry) {
      return;
    }
    input.pending.delete(id);
    if (input.message.error) {
      entry.reject(new Error(input.message.error.message ?? "JSON-RPC error"));
      return;
    }
    entry.resolve(input.message.result);
    return;
  }
  respondToCodexServerRequest(input.message, input.stdin);
}

async function requestAllCodexModels(
  request: (method: string, params: unknown) => Promise<unknown>
): Promise<unknown[]> {
  const models: unknown[] = [];
  let cursor: string | null = null;
  do {
    const response = await request("model/list", cursor ? { cursor } : {});
    const record = toRecord(response);
    const data = Array.isArray(record?.data) ? record.data : [];
    models.push(...data);
    cursor = normalizeOptionalText(record?.nextCursor);
  } while (cursor);
  return models;
}

function respondToCodexServerRequest(
  message: JsonRpcMessage,
  stdin: NodeJS.WritableStream
): void {
  if (
    message.id === undefined ||
    message.id === null ||
    !(typeof message.id === "number" || typeof message.id === "string")
  ) {
    return;
  }
  const result = buildCodexServerRequestProbeResponse(message.method);
  if (result === null) {
    stdin.write(
      `${JSON.stringify({
        error: {
          code: -32_601,
          message: `OpenMeld Codex App Server probe does not handle server request '${message.method}'.`,
        },
        id: message.id,
        jsonrpc: "2.0",
      })}\n`
    );
    return;
  }
  stdin.write(
    `${JSON.stringify({
      id: message.id,
      jsonrpc: "2.0",
      result,
    })}\n`
  );
}

function buildCodexServerRequestProbeResponse(method: string | undefined):
  | {
      [key: string]: unknown;
    }
  | string
  | null {
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { decision: "decline" };
    case "item/fileChange/requestApproval":
      return { decision: "decline" };
    case "execCommandApproval":
      return { decision: "denied" };
    case "applyPatchApproval":
      return { decision: "denied" };
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "mcpServer/elicitation/request":
      return { _meta: null, action: "decline", content: null };
    case "item/tool/call":
      return { contentItems: [], success: false };
    case "item/permissions/requestApproval":
      return {
        permissions: {},
        scope: "turn",
        strictAutoReview: true,
      };
    default:
      return null;
  }
}

function resolveCodexAuthSnapshot(
  response: unknown
): AgentControllerInterfaceAuthSnapshot {
  const record = toRecord(response);
  const account = toRecord(record?.account);
  if (!account) {
    return record?.requiresOpenaiAuth === true
      ? { status: "unauthenticated" }
      : { status: "unknown" };
  }
  const email = normalizeOptionalText(account.email);
  const type = normalizeOptionalText(account.type);
  const planType = normalizeOptionalText(account.planType);
  return {
    ...(email ? { email } : {}),
    label: email ?? planType ?? type ?? "Signed in",
    status: "authenticated",
    ...(type ? { type } : {}),
  };
}

function resolveClaudeAuthSnapshot(
  probe: CommandProbeResult
): AgentControllerInterfaceAuthSnapshot {
  if (!probe.ok) {
    return { status: "unknown" };
  }
  const payload = parseJsonRecord(probe.stdout);
  if (payload) {
    if (typeof payload.loggedIn !== "boolean") {
      return { status: "unknown" };
    }
    if (!payload.loggedIn) {
      return { status: "unauthenticated" };
    }
    const email = normalizeOptionalText(payload.email);
    return {
      ...(email ? { email } : {}),
      label: email ?? "Signed in",
      status: "authenticated",
      type: "claude",
    };
  }
  const output = `${probe.stdout}\n${probe.stderr}`.trim();
  const lower = output.toLowerCase();
  if (
    CLAUDE_UNAUTHENTICATED_OUTPUT_PATTERNS.some((pattern) =>
      lower.includes(pattern)
    )
  ) {
    return { status: "unauthenticated" };
  }
  if (probe.code === 0 && output.length > 0) {
    return {
      label: resolveLikelyEmail(output) ?? "Signed in",
      status: "authenticated",
      type: "claude",
    };
  }
  return { status: "unknown" };
}

function resolveCursorAuthSnapshot(
  probe: CommandProbeResult
): AgentControllerInterfaceAuthSnapshot {
  if (!probe.ok) {
    return { status: "unknown" };
  }
  const output = `${probe.stdout}\n${probe.stderr}`.trim();
  const lowered = output.toLowerCase();
  if (
    lowered.includes("not logged in") ||
    lowered.includes("not authenticated") ||
    lowered.includes("login required")
  ) {
    return { status: "unauthenticated" };
  }
  if (lowered.includes("logged in") || lowered.includes("authenticated")) {
    const email = resolveLikelyEmail(output);
    return {
      ...(email ? { email } : {}),
      label: email ?? "Signed in",
      status: "authenticated",
      type: "cursor_login",
    };
  }
  return { status: "unknown" };
}

function resolveOpenClawAuthProbe(probe: CommandProbeResult): {
  auth: AgentControllerInterfaceAuthSnapshot;
  probeCompleted: boolean;
} {
  if (!(probe.ok && [0, 1, 2].includes(probe.code))) {
    return { auth: { status: "unknown" }, probeCompleted: false };
  }
  const payload = parseJsonRecord(probe.stdout);
  if (!toRecord(payload?.auth)) {
    return { auth: { status: "unknown" }, probeCompleted: false };
  }
  if (probe.code === 1) {
    return { auth: { status: "unauthenticated" }, probeCompleted: true };
  }
  return {
    auth: {
      label:
        probe.code === 2
          ? "Provider credentials expire soon"
          : "Provider credentials ready",
      status: "authenticated",
      type: "openclaw",
    },
    probeCompleted: true,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return toRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseCodexUserAgentVersion(response: unknown): string | null {
  const userAgent = normalizeOptionalText(toRecord(response)?.userAgent);
  const match = userAgent?.match(CODEX_USER_AGENT_VERSION_RE);
  return match?.[1] ?? null;
}

function parseCodexModels(models: unknown): AgentControllerInterfaceModel[] {
  if (!Array.isArray(models)) {
    return [];
  }
  return models.flatMap((model) => {
    const record = toRecord(model);
    const id = normalizeOptionalText(record?.model);
    if (!id) {
      return [];
    }
    return [
      {
        displayName: normalizeOptionalText(record?.displayName) ?? id,
        id,
      },
    ];
  });
}

function parseCodexSkills(skills: unknown): AgentControllerInterfaceSkill[] {
  const record = toRecord(skills);
  const rawSkills = Array.isArray(record?.skills) ? record.skills : [];
  return rawSkills.flatMap((skill) => {
    const skillRecord = toRecord(skill);
    const id =
      normalizeOptionalText(skillRecord?.name) ??
      normalizeOptionalText(skillRecord?.id);
    if (!id) {
      return [];
    }
    return [
      {
        description:
          normalizeOptionalText(skillRecord?.description) ?? undefined,
        displayName:
          normalizeOptionalText(
            toRecord(skillRecord?.interface)?.displayName
          ) ?? undefined,
        id,
      },
    ];
  });
}

function parseCliVersion(output: string): string | null {
  const normalized = normalizeOptionalText(output);
  if (!normalized) {
    return null;
  }
  const semver = normalized.match(CLI_SEMVER_RE);
  return semver?.[1] ?? normalized.split(WHITESPACE_RE).at(-1) ?? normalized;
}

function resolveLaunchContractCommandPath(
  launchContract: RuntimeAgentControllerLaunchContract
): string {
  return launchContract.kind === "executable"
    ? launchContract.commandPath
    : launchContract.scriptPath;
}

function parseJsonRpcMessage(line: string): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return toRecord(parsed) as JsonRpcMessage | null;
  } catch {
    return null;
  }
}

function appendProbeOutput(existing: string, chunk: unknown): string {
  return `${existing}${String(chunk)}`.slice(0, PROBE_OUTPUT_LIMIT);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveLikelyEmail(value: string): string | null {
  const match = value.match(EMAIL_RE);
  return match?.[0] ?? null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}
