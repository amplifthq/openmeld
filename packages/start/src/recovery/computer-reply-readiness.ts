import type {
  CurrentDeviceTargetResponse,
  LocalAgentCatalogEntry,
  LocalRuntimeExecutionTarget,
  PrepareSessionSnapshot,
  StartBackgroundHelperInstallStatus,
  StartBackgroundHelperRuntimeStatus,
} from "@openmeld/schemas/types";

const LEADING_VERSION_PREFIX_RE = /^v/u;
const SEMVER_CORE_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u;

type PrepareBackgroundHelperProjection = NonNullable<
  PrepareSessionSnapshot["localReadinessSnapshot"]
>["service"];

export type ComputerReplyReadinessStatus =
  | "ready"
  | "needs_repair"
  | "needs_setup"
  | "checking"
  | "unknown";

export type ComputerReplyReadinessReasonCode =
  | "current_device.missing"
  | "start_state.checking"
  | "start_state.missing"
  | "session_handoff.failed"
  | "execution_target.partial"
  | "execution_target.not_ready"
  | "execution_target.stale"
  | "execution_target.unknown"
  | "device_projection.missing"
  | "device_projection.unavailable"
  | "device_projection.stale"
  | "device_projection.mismatch"
  | "background_helper.not_installed"
  | "background_helper.installed_outdated"
  | "background_helper.update_required"
  | "background_helper.not_running"
  | "background_helper.stale"
  | "background_helper.unknown"
  | "device_reply_readiness.blocked"
  | "device_reply_readiness.degraded"
  | "device_reply_readiness.unknown"
  | "local_agent_preparation.not_found"
  | "local_agent_preparation.not_enabled"
  | "ready";

export type ComputerReplyReadinessServiceVersion = {
  installStatus: StartBackgroundHelperInstallStatus | null;
  runtimeStatus: StartBackgroundHelperRuntimeStatus | null;
  installedVersion: string | null;
  expectedVersion: string | null;
  executionCompatibility?:
    | PrepareBackgroundHelperProjection["executionCompatibility"]
    | null;
  observedAt: string | null;
};

export type ComputerReplyReadiness = {
  status: ComputerReplyReadinessStatus;
  reasonCode: ComputerReplyReadinessReasonCode;
  detailReasonCode: string | null;
  executionTargetStatus: LocalRuntimeExecutionTarget["status"] | null;
  service: ComputerReplyReadinessServiceVersion | null;
};

export type ResolveComputerReplyReadinessInput = {
  currentExpectedServiceVersion?: string | null;
  currentDeviceTarget: CurrentDeviceTargetResponse | null | undefined;
  completedPrepareSessionSnapshot?: PrepareSessionSnapshot | null;
  selectedExecutionTarget: LocalRuntimeExecutionTarget | null | undefined;
};

export function resolveComputerReplyReadiness(
  input: ResolveComputerReplyReadinessInput
): ComputerReplyReadiness {
  if (input.currentDeviceTarget?.availability !== "resolved") {
    return buildReadiness("needs_setup", "current_device.missing");
  }

  const completedPrepareReadiness = resolveCompletedPrepareSessionReadiness({
    currentDeviceTarget: input.currentDeviceTarget,
    currentExpectedServiceVersion: input.currentExpectedServiceVersion ?? null,
    snapshot: input.completedPrepareSessionSnapshot ?? null,
  });
  if (completedPrepareReadiness !== null) {
    return completedPrepareReadiness;
  }

  if (input.selectedExecutionTarget === undefined) {
    return buildReadiness("checking", "start_state.checking");
  }

  const executionTargetReadiness = resolveExecutionTargetReadiness(
    input.selectedExecutionTarget
  );
  if (executionTargetReadiness !== null) {
    return buildReadiness(
      executionTargetReadiness.status,
      executionTargetReadiness.reasonCode,
      null,
      input.selectedExecutionTarget
    );
  }

  if (input.selectedExecutionTarget === null) {
    return buildReadiness(
      "unknown",
      "execution_target.unknown",
      null,
      input.selectedExecutionTarget
    );
  }

  const localAgentReadiness = resolveLocalAgentReadiness(
    input.selectedExecutionTarget.localAgentCatalog.entries
  );
  if (localAgentReadiness !== null) {
    return buildReadiness(
      localAgentReadiness.status,
      localAgentReadiness.reasonCode,
      null,
      input.selectedExecutionTarget
    );
  }

  return buildReadiness("ready", "ready", null, input.selectedExecutionTarget);
}

export function shouldUseCompletedPrepareSessionForComputerReadiness(input: {
  currentDeviceTarget: CurrentDeviceTargetResponse | null | undefined;
  snapshot: PrepareSessionSnapshot | null | undefined;
}): boolean {
  const { snapshot } = input;
  if (
    input.currentDeviceTarget?.availability !== "resolved" ||
    snapshot === null ||
    snapshot === undefined ||
    snapshot.lifecycleStatus !== "completed" ||
    snapshot.deviceId !== input.currentDeviceTarget.deviceId ||
    snapshot.runtimeLane !== input.currentDeviceTarget.runtimeLane ||
    snapshot.localAgentCatalog === null ||
    !isPrepareStepComplete(snapshot, "refresh_service")
  ) {
    return false;
  }

  return true;
}

function resolveCompletedPrepareSessionReadiness(input: {
  currentDeviceTarget: Extract<
    CurrentDeviceTargetResponse,
    { availability: "resolved" }
  >;
  currentExpectedServiceVersion: string | null;
  snapshot: PrepareSessionSnapshot | null;
}): ComputerReplyReadiness | null {
  const snapshot = input.snapshot;
  if (
    snapshot === null ||
    !shouldUseCompletedPrepareSessionForComputerReadiness({
      currentDeviceTarget: input.currentDeviceTarget,
      snapshot,
    }) ||
    snapshot.localAgentCatalog === null
  ) {
    return null;
  }

  const service =
    snapshot.localReadinessSnapshot === null
      ? null
      : resolveCompletedPrepareSessionServiceVersion({
          currentExpectedServiceVersion: input.currentExpectedServiceVersion,
          snapshot,
        });

  if (snapshot.localReadinessSnapshot !== null) {
    const backgroundHelperReadiness = resolveBackgroundHelperReadiness(
      snapshot.localReadinessSnapshot.service
    );
    if (backgroundHelperReadiness !== null) {
      return buildReadiness(
        backgroundHelperReadiness.status,
        backgroundHelperReadiness.reasonCode,
        service
      );
    }
  }

  const localAgentReadiness = resolveLocalAgentReadiness(
    snapshot.localAgentCatalog.entries
  );
  if (localAgentReadiness !== null) {
    return buildReadiness(
      localAgentReadiness.status,
      localAgentReadiness.reasonCode,
      service
    );
  }

  return buildReadiness("ready", "ready", service);
}

function resolveExecutionTargetReadiness(
  executionTarget: LocalRuntimeExecutionTarget | null | undefined
): {
  status: ComputerReplyReadinessStatus;
  reasonCode: ComputerReplyReadinessReasonCode;
} | null {
  if (executionTarget === null || executionTarget === undefined) {
    return null;
  }

  if (executionTarget.status === "ready") {
    return null;
  }

  if (executionTarget.status === "partial") {
    return {
      status: "needs_repair",
      reasonCode: "execution_target.partial",
    };
  }

  if (executionTarget.status === "not_ready") {
    return {
      status: "needs_repair",
      reasonCode: "execution_target.not_ready",
    };
  }

  if (executionTarget.status === "stale") {
    return {
      status: "needs_repair",
      reasonCode: "execution_target.stale",
    };
  }

  return {
    status: "unknown",
    reasonCode: "execution_target.unknown",
  };
}

function resolveBackgroundHelperReadiness(
  backgroundHelper: PrepareBackgroundHelperProjection
): {
  status: ComputerReplyReadinessStatus;
  reasonCode: ComputerReplyReadinessReasonCode;
} | null {
  if (backgroundHelper.installStatus === "not_installed") {
    return {
      status: "needs_setup",
      reasonCode: "background_helper.not_installed",
    };
  }

  if (backgroundHelper.installStatus === "unknown") {
    return {
      status: "unknown",
      reasonCode: "background_helper.unknown",
    };
  }

  if (backgroundHelper.executionCompatibility?.status === "update_required") {
    return {
      status: "needs_repair",
      reasonCode: "background_helper.update_required",
    };
  }

  if (backgroundHelper.runtimeStatus === "not_running") {
    return {
      status: "needs_repair",
      reasonCode: "background_helper.not_running",
    };
  }

  if (backgroundHelper.runtimeStatus === "stale") {
    return {
      status: "needs_repair",
      reasonCode: "background_helper.stale",
    };
  }

  if (backgroundHelper.runtimeStatus === "unknown") {
    return {
      status: "unknown",
      reasonCode: "background_helper.unknown",
    };
  }

  return null;
}

function resolveLocalAgentReadiness(
  entries: readonly LocalAgentCatalogEntry[]
): {
  status: ComputerReplyReadinessStatus;
  reasonCode: ComputerReplyReadinessReasonCode;
} | null {
  if (entries.length === 0) {
    return {
      status: "needs_setup",
      reasonCode: "local_agent_preparation.not_found",
    };
  }

  const enabledRunnableEntries = entries.filter(
    (entry) => entry.enabled && entry.launchStatus === "ready"
  );
  if (enabledRunnableEntries.length === 0) {
    return {
      status: "needs_setup",
      reasonCode: "local_agent_preparation.not_enabled",
    };
  }

  return null;
}

function resolveCompletedPrepareSessionServiceVersion(input: {
  currentExpectedServiceVersion: string | null;
  snapshot: PrepareSessionSnapshot;
}): ComputerReplyReadinessServiceVersion {
  const service = input.snapshot.localReadinessSnapshot?.service ?? null;
  const expectedVersion =
    input.currentExpectedServiceVersion ?? service?.expectedVersion ?? null;
  const installStatus =
    service?.installStatus === "installed_current" &&
    isOlderVersion(service.installedVersion, expectedVersion)
      ? "installed_outdated"
      : (service?.installStatus ?? null);
  return {
    installStatus,
    runtimeStatus: service?.runtimeStatus ?? null,
    installedVersion: service?.installedVersion ?? null,
    expectedVersion,
    executionCompatibility: service?.executionCompatibility ?? null,
    observedAt: input.snapshot.localReadinessSnapshot?.observedAt ?? null,
  };
}

function isOlderVersion(
  installedVersion: string | null,
  expectedVersion: string | null
): boolean {
  if (!(installedVersion && expectedVersion)) {
    return false;
  }
  return compareSemver(installedVersion, expectedVersion) < 0;
}

function compareSemver(left: string, right: string): number {
  const leftParts = parseSemverCore(left);
  const rightParts = parseSemverCore(right);
  if (!(leftParts && rightParts)) {
    return left.localeCompare(right);
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
  const normalized = value.trim().replace(LEADING_VERSION_PREFIX_RE, "");
  const match = normalized.match(SEMVER_CORE_RE);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isPrepareStepComplete(
  snapshot: PrepareSessionSnapshot,
  stepId: string
): boolean {
  return snapshot.steps.some(
    (step) => step.id === stepId && step.state === "complete"
  );
}

function buildReadiness(
  status: ComputerReplyReadinessStatus,
  reasonCode: ComputerReplyReadinessReasonCode,
  service: ComputerReplyReadinessServiceVersion | null = null,
  executionTarget: LocalRuntimeExecutionTarget | null | undefined = null,
  detailReasonCode: string | null = null
): ComputerReplyReadiness {
  return {
    status,
    reasonCode,
    detailReasonCode,
    executionTargetStatus: executionTarget?.status ?? null,
    service,
  };
}
