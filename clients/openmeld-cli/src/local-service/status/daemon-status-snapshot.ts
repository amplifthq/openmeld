import { resolveOpenMeldEnvPreset } from "../../config/paths";
import { resolveOpenMeldProfileOrNull } from "../../config/resolve-openmeld-profile";
import {
  type RuntimeContext,
  resolveRuntimeContext,
} from "../../runtime/context";
import {
  type CurrentReplyReadinessSnapshot,
  resolveCurrentReplyReadinessSnapshot,
} from "../../system/current-reply-readiness-snapshot";
import { DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS } from "../../system/gateway-chain-readiness";
import {
  type DaemonLifecycleEvent,
  readLatestDaemonLifecycleConnectionStateEvent,
  readLatestDaemonLifecycleOriginEvent,
} from "../lifecycle/daemon-lifecycle-journal";
import {
  buildDaemonServiceDependencyMeaning,
  buildDaemonServiceDependencyNextStep,
  buildDaemonServiceDependencySummary,
  buildDaemonServiceDependencyTitle,
  type DaemonServiceDependencyIssue,
  resolveDaemonServiceDependencyDiagnostics,
} from "../lifecycle/daemon-service-dependency-diagnostics";
import {
  type DaemonStartFailureState,
  readDaemonStartFailureState,
} from "../state/daemon-start-failure-state";
import { readDaemonRuntimeContractRepairReport } from "../state/runtime-contract-guard";
import type { DaemonLocalStatusSnapshot } from "./daemon-local-status-snapshot";
import {
  type DaemonStatusAttention,
  resolveDaemonStatusAttention,
  resolveDaemonStatusAuthenticationAttention,
} from "./daemon-status-attention";

export type DaemonStatusSnapshot = {
  attention: DaemonStatusAttention | null;
  currentReplyReadiness: CurrentReplyReadinessSnapshot;
  latestConnectionStateEvent: DaemonLifecycleEvent | null;
  latestLifecycleEvent: DaemonLifecycleEvent | null;
  runtimeContractRepairReport: Awaited<
    ReturnType<typeof readDaemonRuntimeContractRepairReport>
  > | null;
};

const DAEMON_STATUS_GATEWAY_CHAIN_TIMEOUT_MS = DEFAULT_GATEWAY_CHAIN_TIMEOUT_MS;

export async function resolveDaemonStatusSnapshot(
  input: {
    localSnapshot?: DaemonLocalStatusSnapshot;
    profile?: string;
    runtime?: RuntimeContext;
    view?: string;
  } = {}
): Promise<DaemonStatusSnapshot> {
  const runtime =
    input.runtime ??
    (await resolveRuntimeContext({
      profile: input.profile,
      view: input.view,
    }));
  const activeProfile = await resolveOpenMeldProfileOrNull({
    openMeldProfileId: runtime.openMeldProfileId,
    allowDefaultFallback: runtime.resolvedView === "human",
    allowUnauthenticated: true,
    persistSelection: false,
  }).catch(() => null);
  let gatewayChainProfile: {
    openMeldProfileId: string;
    profileName?: string;
  } | null = null;
  if (activeProfile) {
    gatewayChainProfile = {
      openMeldProfileId: activeProfile.openMeldProfileId,
      profileName: activeProfile.profileName,
    };
  } else if (runtime.openMeldProfileId) {
    gatewayChainProfile = {
      openMeldProfileId: runtime.openMeldProfileId,
    };
  }
  const currentReplyReadiness = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: true,
    gatewayChainProfile,
    gatewayChainTimeoutMs: DAEMON_STATUS_GATEWAY_CHAIN_TIMEOUT_MS,
    includeDaemonRouteObservation: true,
    localServiceObservation: input.localSnapshot,
    ownerUserId: activeProfile?.ownerUserId ?? null,
    preferActiveServiceRouteCatalog: true,
    profile: activeProfile,
  });
  const runtimeContractRepairReport =
    await resolveRuntimeContractRepairReportForStatus({
      daemonInstalled: currentReplyReadiness.daemonStatus.installed,
      localSnapshot: input.localSnapshot,
    });
  const latestLifecycleEvent = input.localSnapshot
    ? input.localSnapshot.latestLifecycleEvent
    : await readLatestDaemonLifecycleOriginEvent().catch(() => null);
  const latestConnectionStateEvent = input.localSnapshot
    ? input.localSnapshot.latestConnectionStateEvent
    : await readLatestDaemonLifecycleConnectionStateEvent().catch(() => null);
  const baseAttention = demoteRepairAttentionForLiveRoute({
    attention: resolveDaemonStatusAttention({
      inventory: currentReplyReadiness.inventory,
      runtimeState:
        currentReplyReadiness.displayRuntimeStatus ??
        currentReplyReadiness.runtimeStatus,
    }),
    daemonRouteObservation: currentReplyReadiness.daemonRouteObservation,
  });
  const liveDependencyDiagnostics =
    shouldCheckDaemonServiceDependenciesForStatus(
      currentReplyReadiness.displayRuntimeStatus ??
        currentReplyReadiness.runtimeStatus
    )
      ? await resolveDaemonServiceDependencyDiagnostics({
          scopePolicy: "loopback_only",
        }).catch(() => null)
      : null;
  const recordedStartFailure = shouldCheckDaemonServiceDependenciesForStatus(
    currentReplyReadiness.displayRuntimeStatus ??
      currentReplyReadiness.runtimeStatus
  )
    ? await readDaemonStartFailureState().catch(() => null)
    : null;
  const attention =
    resolveDaemonStatusAuthenticationAttention({
      latestConnectionStateEvent,
    }) ??
    baseAttention ??
    resolveDaemonStatusServiceDependencyAttention({
      liveDiagnostics: liveDependencyDiagnostics,
      recordedStartFailure,
    });
  return {
    attention,
    currentReplyReadiness,
    latestConnectionStateEvent,
    latestLifecycleEvent,
    runtimeContractRepairReport,
  };
}

async function resolveRuntimeContractRepairReportForStatus(input: {
  daemonInstalled: boolean;
  localSnapshot?: DaemonLocalStatusSnapshot;
}) {
  if (input.localSnapshot) {
    return input.localSnapshot.runtimeContractRepairReport;
  }
  if (!input.daemonInstalled) {
    return null;
  }
  return await readDaemonRuntimeContractRepairReport().catch(() => null);
}

// facts.md read rule: a live Core Wake route is the authoritative liveness
// fact for this device. Stale local anomalies stay visible as inventory
// diagnostics, but they must not headline "needs repair" while the cloud
// confirms this device is carrying Wake traffic right now.
function demoteRepairAttentionForLiveRoute(input: {
  attention: DaemonStatusAttention | null;
  daemonRouteObservation: CurrentReplyReadinessSnapshot["daemonRouteObservation"];
}): DaemonStatusAttention | null {
  if (!input.attention) {
    return null;
  }
  if (input.attention.code !== "service_repair_recommended") {
    return input.attention;
  }
  if (input.daemonRouteObservation.status !== "online") {
    return input.attention;
  }
  return null;
}

function shouldCheckDaemonServiceDependenciesForStatus(
  runtimeState: CurrentReplyReadinessSnapshot["runtimeStatus"]
): boolean {
  return runtimeState?.status !== "running";
}

function resolveDaemonStatusServiceDependencyAttention(input: {
  liveDiagnostics: Awaited<
    ReturnType<typeof resolveDaemonServiceDependencyDiagnostics>
  > | null;
  recordedStartFailure: DaemonStartFailureState | null;
}): DaemonStatusAttention | null {
  if (input.liveDiagnostics?.applicable && !input.liveDiagnostics.ready) {
    return buildDaemonStatusServiceDependencyAttention({
      issues: input.liveDiagnostics.issues,
      lane: input.liveDiagnostics.lane,
    });
  }

  if (
    input.recordedStartFailure?.reason === "service_dependencies_unavailable" &&
    input.recordedStartFailure.dependencyIssues.length > 0 &&
    input.recordedStartFailure.lane === resolveOpenMeldEnvPreset()
  ) {
    return buildDaemonStatusServiceDependencyAttention({
      issues: input.recordedStartFailure.dependencyIssues,
      lane: input.recordedStartFailure.lane,
    });
  }

  return null;
}

function buildDaemonStatusServiceDependencyAttention(input: {
  issues: DaemonServiceDependencyIssue[];
  lane: DaemonStartFailureState["lane"];
}): DaemonStatusAttention {
  return {
    level: "warning",
    code: "service_dependencies_unavailable",
    title: buildDaemonServiceDependencyTitle({
      issues: input.issues,
      lane: input.lane,
    }),
    message: `${buildDaemonServiceDependencySummary({
      issues: input.issues,
      lane: input.lane,
    })} ${buildDaemonServiceDependencyMeaning({
      issues: input.issues,
      lane: input.lane,
    })}`,
    nextStep: buildDaemonServiceDependencyNextStep({
      command: "status",
      issues: input.issues,
      lane: input.lane,
    }),
    anomalyCodes: [],
  };
}
