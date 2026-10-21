import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import {
  checkAntigravityAcpAccount,
  isAntigravityAcpLaunchContract,
} from "@openmeld/adapter-antigravity";
import { probeClaudeCodeUsageLimits } from "@openmeld/adapter-claude-code";
import {
  probeCodexAppServerAccount,
  projectCodexUsageObservation,
  readCodexAccountUsageObservation,
} from "@openmeld/adapter-codex";
import {
  buildCliLaunchInvocation,
  createUnavailableProviderUsageLimits,
  createUnsupportedProviderUsageLimits,
  materializeCliLaunchCommand,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  GrokBuildAcpTransportError,
  probeGrokBuildAcpInterface,
} from "@openmeld/adapter-grok-build";
import {
  areAgentControllerInterfaceAccountsSame,
  compareAgentControllerVersions,
  isAgentControllerUsageRefreshUnavailable,
} from "@openmeld/agent-runtime";
import {
  grokBotAccountSchema,
  resolvePublicAgentAvailabilityCopy,
} from "@openmeld/schemas";
import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerInterfaceLaunchSnapshot,
  AgentControllerInterfaceModel,
  AgentControllerInterfaceSkill,
  AgentControllerInterfaceSnapshot,
  AgentControllerInterfaceStatus,
  AgentControllerInterfaceVersionAdvisory,
  AgentControllerUsageLimits,
} from "@openmeld/schemas/types";
import {
  type BuiltinAgentControllerUsageLimitSupport,
  EMPTY_AGENT_CONTROLLER_INTERFACE_CAPABILITIES,
  resolveBuiltinAgentControllerDefinition,
} from "../../agents/builtin-agent-controller-definitions";
import {
  fetchLatestControllerVersion,
  resolveControllerVersionChannel,
} from "../../agents/controller-version-channel";
import type { AgentTargetState } from "../../agents/registry";
import { warnDaemonEvent } from "../core/logger";
import {
  buildAgentControllerInterfaceKeeperKey,
  didAgentControllerCommandFingerprintRemainStable,
  readLastKnownAgentControllerAuthSnapshot,
  readLastKnownAgentControllerUsageLimits,
  readLastSuccessfulAgentControllerInterfaceCheckAt,
  readReusableAgentControllerInterfaceSnapshot,
  recordAgentControllerInterfaceProbeFailure,
  recordAgentControllerInterfaceProbeSuccess,
  resolveAgentControllerCommandFingerprint,
} from "./agent-controller-interface-keeper";
import { probeCursorUsageLimits } from "./cursor-usage-probe";
import { probeOpenCodeReadiness } from "./opencode-readiness-probe";
import { withProbeWorkingDirectory } from "./probe-working-directory";
import { resolveLaunchContractCommandPath } from "./runtime-provider-usage-limits";

const PROBE_TIMEOUT_MS = 8000;
const CODEX_AUX_INVENTORY_GRACE_MS = 2500;
const PROBE_OUTPUT_LIMIT = 32_000;
const CODEX_USER_AGENT_VERSION_RE = /\/([^\s]+)/u;
const CLI_SEMVER_RE = /\bv?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)\b/u;
const CURSOR_BUILD_DATE_RE = /^(\d{4})\.(\d{2})\.(\d{2})-[\da-f]+$/u;
const WHITESPACE_RE = /\s+/u;

// "fresh" always runs the controller probe and reports its real outcome; it is
// the default for user-driven paths (setup, prepare, explicit checks).
// "background" is the periodic report-sync policy on machines we do not want
// to burden: it reuses completed checks, including signed-out results, within
// a TTL. A failed probe invalidates reuse so the next pass probes again.
// Neither policy authorizes interactive authentication.
export type AgentControllerInterfaceProbePolicy = "background" | "fresh";

type AgentControllerInterfaceProbeOutcome = {
  probeCompleted: boolean;
  snapshot: AgentControllerInterfaceSnapshot;
};

type InventoryProbeInput = {
  baseSnapshot: AgentControllerInterfaceSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
  workingDirectory: string;
};

type AgentControllerInterfaceSnapshotResolver = (
  input: InventoryProbeInput
) => Promise<AgentControllerInterfaceProbeOutcome>;

const CONTROLLER_INTERFACE_SNAPSHOT_RESOLVERS: Record<
  string,
  AgentControllerInterfaceSnapshotResolver
> = {
  antigravity: resolveAntigravityInterfaceSnapshot,
  "claude-code": resolveClaudeCodeInterfaceSnapshot,
  codex: resolveCodexInterfaceSnapshot,
  cursor: resolveCursorInterfaceSnapshot,
  "grok-build": resolveGrokBuildInterfaceSnapshot,
  "grok-bot": resolveGrokBotInterfaceSnapshot,
  openclaw: resolveOpenClawInterfaceSnapshot,
  opencode: resolveOpenCodeInterfaceSnapshot,
};

async function resolveAntigravityInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  if (isAntigravityAcpLaunchContract(input.launchContract)) {
    try {
      const account = await checkAntigravityAcpAccount({
        cwd: input.workingDirectory,
        launchContract: input.launchContract,
        timeoutMs: 15_000,
      });
      return {
        probeCompleted: true,
        snapshot: {
          ...input.baseSnapshot,
          nativeInterface: "acp",
          version: account.initialized.agentInfo?.version ?? null,
          capabilities: {
            ...input.baseSnapshot.capabilities,
            approvals: true,
            structuredUserInput: true,
          },
          auth: { status: account.authStatus },
          status: account.authStatus === "authenticated" ? "ready" : "warning",
          message:
            account.authStatus === "authenticated"
              ? "Antigravity ACP accepted a session. Usage limits are not reported."
              : "Run openmeld agents login antigravity on this computer, then check again.",
          models: account.models,
          usageLimits: createUnsupportedProviderUsageLimits(
            input.baseSnapshot.checkedAt
          ),
        },
      };
    } catch (error) {
      return {
        probeCompleted: false,
        snapshot: {
          ...input.baseSnapshot,
          nativeInterface: "acp",
          status: "unknown",
          message: `OpenMeld could not start Antigravity ACP: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }
  // /usage may enter interactive authentication even in print mode. A status
  // read (including an explicit refresh) must never initiate browser login or
  // Keychain authorization. Keep only the credential-free version probe until
  // the provider offers a verified no-interaction account/usage contract.
  const versionProbe = await runLaunchContractCommand({
    workingDirectory: input.workingDirectory,
    args: ["--version"],
    launchContract: input.launchContract,
  });
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  return {
    probeCompleted: versionProbe.ok,
    snapshot: {
      ...input.baseSnapshot,
      auth: { status: "unknown" },
      message: versionProbe.ok
        ? "Antigravity CLI is installed. Select the official ACP installation to verify sign-in in OpenMeld."
        : "OpenMeld could not read the Antigravity CLI version.",
      status: versionProbe.ok ? "unknown" : "warning",
      usageLimits: createUnsupportedProviderUsageLimits(
        input.baseSnapshot.checkedAt
      ),
      version,
    },
  };
}

export async function probeAgentControllerUsageObservationAuth(input: {
  agentId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
}): Promise<AgentControllerInterfaceAuthSnapshot> {
  if (input.agentId === "codex") {
    try {
      const account = await probeCodexAppServerAccount({
        launchContract: input.launchContract,
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      return {
        status: account.authStatus,
        ...(account.accountKey ? { accountKey: account.accountKey } : {}),
        ...(account.email ? { email: account.email } : {}),
      };
    } catch {
      return { status: "unknown" };
    }
  }
  if (input.agentId !== "claude-code") {
    return { status: "unknown" };
  }
  // Claude's passive SDK rate-limit event carries no stable account identity.
  // Reuse its native, non-task ACI auth command solely to bind the observation;
  // the auth snapshot never becomes part of a Usage Limit item.
  const authProbe = await withProbeWorkingDirectory((workingDirectory) =>
    runLaunchContractCommand({
      workingDirectory,
      allowNonZeroExit: true,
      args: ["auth", "status", "--json"],
      launchContract: input.launchContract,
    })
  );
  return resolveClaudeAuthSnapshot(authProbe);
}

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
  const initialUsageLimits = resolveInitialProviderUsageLimits({
    checkedAt,
    support: controllerDefinition?.usageLimitSupport ?? "not_evaluated",
  });
  const baseSnapshot = withUsageLimits(
    {
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
    },
    initialUsageLimits
  );

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
  const lastKnownUsageLimits = readLastKnownAgentControllerUsageLimits({
    commandFingerprint: commandFingerprintBeforeProbe,
    keeperKey,
  });
  const lastKnownAuth = readLastKnownAgentControllerAuthSnapshot({
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

  const launchContract = input.state.launchContract;
  const outcome = await withProbeWorkingDirectory((workingDirectory) =>
    snapshotResolver({
      baseSnapshot,
      launchContract,
      workingDirectory,
    })
  );
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
    const usageLimits = resolveUsageLimitsAfterCompletedProbe({
      currentAuth: outcome.snapshot.auth,
      current: outcome.snapshot.usageLimits,
      previous: lastKnownUsageLimits,
      previousAuth: lastKnownAuth,
    });
    const completedSnapshot = withUsageLimits(
      {
        ...outcome.snapshot,
        check: {
          lastSucceededAt: outcome.snapshot.checkedAt,
          status: "succeeded",
        },
      },
      usageLimits
    );
    if (commandFingerprintRemainedStable && commandFingerprintAfterProbe) {
      return recordAgentControllerInterfaceProbeSuccess({
        commandFingerprint: commandFingerprintAfterProbe,
        keeperKey,
        // Reuse age counts from the native check time Core measures, not
        // from when a slow probe happened to finish.
        nowMs: Date.parse(completedSnapshot.checkedAt),
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
  const usageLimits = resolveUsageLimitsAfterFailedProbe({
    currentAuth: outcome.snapshot.auth,
    current: outcome.snapshot.usageLimits,
    previous: lastKnownUsageLimits,
    previousAuth: lastKnownAuth,
    preserveHistoricalEvidence: commandFingerprintRemainedStable,
  });
  warnDaemonEvent("[openmeld.agent_controller_interface.check_failed]", {
    agentControllerRef: input.agentControllerRef,
    commandFingerprintRemainedStable,
    controllerId: input.state.agentId,
    errorMessage: outcome.snapshot.message,
    lastSucceededAt: preservedLastSuccessfulCheckAt,
    probePolicy,
    reasonCode: isControllerInterfaceProbeTimeout(outcome.snapshot.message)
      ? "controller_check_timeout"
      : "controller_check_failed",
  });
  return withUsageLimits(
    {
      ...outcome.snapshot,
      check: {
        lastSucceededAt: preservedLastSuccessfulCheckAt,
        status: "failed",
      },
      // A failed check is not proof that the controller itself is broken.
      status: "unknown",
    },
    usageLimits
  );
}

function isControllerInterfaceProbeTimeout(message: string | null): boolean {
  const normalized = message?.toLowerCase() ?? "";
  return normalized.includes("timed out") || normalized.includes("timeout");
}

function withUsageLimits(
  snapshot: AgentControllerInterfaceSnapshot,
  usageLimits: AgentControllerUsageLimits | undefined
): AgentControllerInterfaceSnapshot {
  return usageLimits ? { ...snapshot, usageLimits } : snapshot;
}

export function resolveUsageLimitsAfterCompletedProbe(input: {
  currentAuth: AgentControllerInterfaceAuthSnapshot;
  current: AgentControllerUsageLimits | undefined;
  previous: AgentControllerUsageLimits | null;
  previousAuth: AgentControllerInterfaceAuthSnapshot | null;
}): AgentControllerUsageLimits | undefined {
  if (
    !areAgentControllerInterfaceAccountsSame(
      input.previousAuth,
      input.currentAuth
    )
  ) {
    return input.current;
  }
  if (!input.current) {
    return input.previous ?? undefined;
  }
  return preserveLastKnownUsageLimitsAfterFailure(input);
}

function preserveLastKnownUsageLimitsAfterFailure(input: {
  current: AgentControllerUsageLimits | undefined;
  previous: AgentControllerUsageLimits | null;
}): AgentControllerUsageLimits | undefined {
  const currentIsUnavailable = isAgentControllerUsageRefreshUnavailable(
    input.current
  );
  const previousHasKnownCapacity = input.previous?.some(
    (limit) =>
      limit.status === "available" ||
      limit.status === "exhausted" ||
      limit.status === "stale"
  );
  if (!(currentIsUnavailable && previousHasKnownCapacity && input.previous)) {
    return input.current;
  }
  return input.previous.map((limit) =>
    limit.usedPercent === null ? limit : { ...limit, status: "stale" }
  );
}

function resolveUsageLimitsAfterFailedProbe(input: {
  currentAuth: AgentControllerInterfaceAuthSnapshot;
  current: AgentControllerUsageLimits | undefined;
  preserveHistoricalEvidence: boolean;
  previous: AgentControllerUsageLimits | null;
  previousAuth: AgentControllerInterfaceAuthSnapshot | null;
}): AgentControllerUsageLimits | undefined {
  if (
    !(
      input.preserveHistoricalEvidence &&
      areAgentControllerInterfaceAccountsSame(
        input.previousAuth,
        input.currentAuth
      )
    )
  ) {
    return input.current;
  }
  return preserveLastKnownUsageLimitsAfterFailure(input);
}

function resolveInitialProviderUsageLimits(input: {
  checkedAt: string;
  support: BuiltinAgentControllerUsageLimitSupport;
}): AgentControllerInterfaceSnapshot["usageLimits"] {
  if (input.support === "native" || input.support === "observational") {
    return createUnavailableProviderUsageLimits(input.checkedAt);
  }
  if (input.support === "unsupported") {
    return createUnsupportedProviderUsageLimits(input.checkedAt);
  }
  return undefined;
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
    ...(state.launchFailureReason
      ? { failureReason: state.launchFailureReason }
      : {}),
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
  // Native Claude owns stable/latest and managed version policy. npm's latest
  // tag cannot prove that this installation is behind its configured channel.
  if (
    input.controllerId === "claude-code" &&
    (await resolveClaudeNativeUpdateCommand(input.launchContract))
  ) {
    return undefined;
  }
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
  if (
    definition.hostApplicationPath &&
    commandPaths.some(definition.hostApplicationPath)
  ) {
    return undefined;
  }
  const channel = await resolveControllerVersionChannel({
    commandPath,
    commandPaths,
    definition,
  });
  const updateCommand = channel?.updateCommand ?? null;
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
  if (!channel) {
    return {
      checkedAt: input.checkedAt,
      currentVersion: input.currentVersion,
      latestVersion: null,
      message: "OpenMeld could not check the latest controller version.",
      status: "unknown",
      updateCommand,
    };
  }

  const lookupResult = await fetchLatestControllerVersion(channel);
  recordLatestVersionFailureDiagnostics(lookupResult);
  const latestVersion = lookupResult.version;
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

  const compareVersions =
    input.controllerId === "cursor"
      ? compareCursorBuildDates
      : compareAgentControllerVersions;
  const versionComparison = compareVersions(
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

function recordLatestVersionFailureDiagnostics(
  lookupResult: Awaited<ReturnType<typeof fetchLatestControllerVersion>>
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

// Cursor's YYYY.MM.DD-commit builds are not SemVer; compare their release dates.
function compareCursorBuildDates(left: string, right: string): number | null {
  const leftParts = left
    .trim()
    .match(CURSOR_BUILD_DATE_RE)
    ?.slice(1)
    .map(Number);
  const rightParts = right
    .trim()
    .match(CURSOR_BUILD_DATE_RE)
    ?.slice(1)
    .map(Number);
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

async function resolveCodexInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const appServerProbe = await probeCodexAppServer(
    input.launchContract,
    input.workingDirectory
  );
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
        usageAdmission: appServerProbe.usageAdmission,
        usageLimits: appServerProbe.usageLimits,
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
    workingDirectory: input.workingDirectory,
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

async function resolveClaudeCodeInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      allowNonZeroExit: true,
      args: ["auth", "status", "--json"],
      launchContract: input.launchContract,
    }),
  ]);

  const auth = resolveClaudeAuthSnapshot(authProbe);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  let usageLimits = createUnavailableProviderUsageLimits(
    input.baseSnapshot.checkedAt,
    undefined,
    { reason: "not_reported" }
  );
  if (auth.status !== "authenticated") {
    usageLimits = createUnavailableProviderUsageLimits(
      input.baseSnapshot.checkedAt,
      undefined,
      {
        reason:
          auth.status === "unauthenticated"
            ? "not_authenticated"
            : "refresh_failed",
      }
    );
  } else if (
    auth.email &&
    version &&
    (compareAgentControllerVersions(version, "2.1.285") ?? -1) >= 0
  ) {
    usageLimits = await probeClaudeCodeUsageLimits({
      expectedEmail: auth.email,
      launchContract: input.launchContract,
      workingDirectory: input.workingDirectory,
      observedAt: input.baseSnapshot.checkedAt,
    });
  }
  let message = input.baseSnapshot.message;
  let status = input.baseSnapshot.status;
  if (auth.status === "unauthenticated") {
    message =
      "Claude Code is installed, but this computer is not signed in to Claude Code.";
    status = "unavailable";
  } else if (auth.status === "unknown") {
    message = "OpenMeld could not read Claude Code authentication status.";
    status = "warning";
  }
  return {
    probeCompleted: authProbe.ok && auth.status !== "unknown",
    snapshot: {
      ...input.baseSnapshot,
      auth,
      usageLimits,
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

async function resolveCursorInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      allowNonZeroExit: true,
      args: ["status", "--format", "json"],
      launchContract: input.launchContract,
    }),
  ]);
  const auth = resolveCursorAuthSnapshot(authProbe);
  const version = versionProbe.ok ? parseCliVersion(versionProbe.stdout) : null;
  const usageLimits =
    auth.status === "authenticated"
      ? await probeCursorUsageLimits({
          observedAt: input.baseSnapshot.checkedAt,
        })
      : createUnavailableProviderUsageLimits(
          input.baseSnapshot.checkedAt,
          undefined,
          {
            reason:
              auth.status === "unauthenticated"
                ? "not_authenticated"
                : "refresh_failed",
          }
        );
  let message = input.baseSnapshot.message;
  let status = input.baseSnapshot.status;
  if (auth.status === "unauthenticated") {
    message = requireControllerSignInInterfaceDescription("cursor");
    status = "unavailable";
  } else if (auth.status === "unknown") {
    message = "OpenMeld could not read Cursor CLI authentication status.";
    status = "warning";
  }
  return {
    probeCompleted: authProbe.ok && auth.status !== "unknown",
    snapshot: {
      ...input.baseSnapshot,
      auth,
      usageLimits,
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

async function resolveGrokBuildInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, interfaceProbe] = await Promise.all([
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      args: ["--no-auto-update", "version"],
      launchContract: input.launchContract,
    }),
    probeGrokBuildAcpInterface({
      grokBuildTimeoutMs: PROBE_TIMEOUT_MS,
      grokBuildWorkdir: input.workingDirectory,
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
        usageLimits: interfaceProbe.result.usageLimits,
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
      status: unauthenticated ? "unavailable" : "warning",
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

async function resolveGrokBotInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const result = await runLaunchContractCommand({
    workingDirectory: input.workingDirectory,
    args: ["whoami", "--json"],
    launchContract: input.launchContract,
  });
  const account = grokBotAccountSchema.safeParse(
    parseJsonRecord(result.stdout)
  );
  const authenticated = result.ok && account.success;
  return {
    probeCompleted: authenticated,
    snapshot: {
      ...input.baseSnapshot,
      auth: authenticated
        ? {
            status: "authenticated",
            ...(account.data.email ? { email: account.data.email } : {}),
            accountKey: account.data.authId,
          }
        : { status: "unknown" },
      models: [],
      skills: [],
      status: authenticated ? "ready" : "warning",
      message: authenticated
        ? "Shared conversation. Bot settings and tools are managed in Grok Bot."
        : "Sign in from Grok Bot connection setup, or run bdk login for a manual installation.",
      usageLimits: createUnsupportedProviderUsageLimits(
        input.baseSnapshot.checkedAt
      ),
    },
  };
}

async function resolveOpenClawInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, authProbe] = await Promise.all([
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
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
  let status = input.baseSnapshot.status;
  if (!authResult.probeCompleted) {
    status = "unknown";
  }
  if (authResult.auth.status === "unauthenticated") {
    status = "unavailable";
  }
  return {
    probeCompleted: authResult.probeCompleted,
    snapshot: {
      ...input.baseSnapshot,
      auth: authResult.auth,
      message,
      status,
      version,
    },
  };
}

async function resolveOpenCodeInterfaceSnapshot(
  input: InventoryProbeInput
): Promise<AgentControllerInterfaceProbeOutcome> {
  const [versionProbe, readinessProbe] = await Promise.all([
    runLaunchContractCommand({
      workingDirectory: input.workingDirectory,
      args: ["--version"],
      launchContract: input.launchContract,
    }),
    probeOpenCodeReadiness({
      workingDirectory: input.workingDirectory,
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
      ...(readinessProbe.usageLimits
        ? { usageLimits: readinessProbe.usageLimits }
        : {}),
      version,
      // The v1 maintenance channel installs opencode-ai. It must not replace
      // an explicitly selected v2 installation with the older major.
      versionAdvisory: version?.startsWith("2.")
        ? undefined
        : await resolveControllerVersionAdvisory({
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
  workingDirectory: string;
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
    workingDirectory: input.workingDirectory,
    allowNonZeroExit: input.allowNonZeroExit,
    args: invocation.args,
    bin: invocation.bin,
    shell: invocation.shell,
    timeoutMs: input.timeoutMs,
  });
}

function runCommand(input: {
  workingDirectory: string;
  allowNonZeroExit?: boolean;
  args: string[];
  bin: string;
  shell?: boolean;
  timeoutMs?: number;
}): Promise<CommandProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(input.bin, input.args, {
      cwd: input.workingDirectory,
      env: process.env,
      shell: input.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
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
      usageAdmission?: AgentControllerInterfaceSnapshot["usageAdmission"];
      usageLimits: NonNullable<AgentControllerInterfaceSnapshot["usageLimits"]>;
      version: string | null;
    }
  | {
      auth: AgentControllerInterfaceAuthSnapshot;
      message: string;
      ok: false;
    };

function probeCodexAppServer(
  launchContract: RuntimeAgentControllerLaunchContract,
  workingDirectory: string
): Promise<CodexAppServerProbeResult> {
  const invocation = buildCliLaunchInvocation({
    args: ["app-server", "--listen", "stdio://"],
    launchContract,
  });

  return new Promise((resolve) => {
    const child = spawn(invocation.bin, invocation.args, {
      cwd: workingDirectory,
      env: process.env,
      shell: invocation.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
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
    let accountEpoch = 0;
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
        onMessage: (message) => {
          if (
            message.method === "account/updated" ||
            message.method === "account/login/completed"
          ) {
            accountEpoch += 1;
          }
          handleCodexProbeMessage({
            message,
            pending,
            stdin: child.stdin,
          });
        },
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
      readAccountEpoch: () => accountEpoch,
      workingDirectory,
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
  readAccountEpoch: () => number;
  workingDirectory: string;
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
    .request("skills/list", { cwds: [input.workingDirectory] })
    .catch(() => null);
  const modelsPromise = requestAllCodexModels(input.request).catch(() => []);
  const account = await input.request("account/read", {});
  // The account verdict is the core probe fact. Once it arrives the probe can
  // no longer time out; auxiliary model/skill inventory only gets a bounded
  // grace so a slow listing cannot turn a healthy controller into a timeout.
  input.clearProbeTimeout();
  const usageObservationPromise = readCodexAccountUsageObservation(input).catch(
    () => null
  );
  const [skills, models, accountUsage] = await Promise.all([
    resolveWithinGrace(skillsPromise, CODEX_AUX_INVENTORY_GRACE_MS, null),
    resolveWithinGrace(modelsPromise, CODEX_AUX_INVENTORY_GRACE_MS, []),
    resolveWithinGrace(
      usageObservationPromise,
      CODEX_AUX_INVENTORY_GRACE_MS,
      null
    ),
  ]);
  const accountKey =
    accountUsage?.accountEpoch === input.readAccountEpoch()
      ? accountUsage.accountKey
      : null;
  const auth =
    accountKey && accountUsage
      ? {
          ...resolveCodexAuthSnapshot(accountUsage.accountResponse),
          accountKey,
        }
      : resolveCodexAuthSnapshot(account);
  input.finish({
    auth,
    message:
      auth.status === "unauthenticated"
        ? requireControllerSignInInterfaceDescription("codex")
        : null,
    models: parseCodexModels(models),
    ok: true,
    skills: parseCodexSkills(skills),
    status: auth.status === "unauthenticated" ? "unavailable" : "ready",
    ...(accountKey && accountUsage
      ? accountUsage.usageObservation
      : projectCodexUsageObservation({
          observedAt: new Date().toISOString(),
          response: null,
          source: "account_read",
        })),
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
  if (typeof payload?.loggedIn !== "boolean") {
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

function resolveCursorAuthSnapshot(
  probe: CommandProbeResult
): AgentControllerInterfaceAuthSnapshot {
  if (!probe.ok) {
    return { status: "unknown" };
  }
  const payload = parseJsonRecord(probe.stdout);
  if (payload?.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }
  if (payload?.status === "authenticated") {
    const email = normalizeOptionalText(payload.email);
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}

import { resolveClaudeNativeUpdateCommand } from "@openmeld/adapter-claude-code";
