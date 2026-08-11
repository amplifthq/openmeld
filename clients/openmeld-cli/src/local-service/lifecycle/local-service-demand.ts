import {
  createLocalAdapterContainer,
  createLocalAdapterEntries,
} from "@openmeld/local-service";
import type { DaemonProfileSkipReason } from "@openmeld/schemas/types";
import {
  clearDaemonServiceRuntimeState,
  type DaemonServiceRuntimeStatus,
  type DaemonStatus,
  getDaemonStatus,
  withDaemonServiceRegistrationMutationLock,
} from "../../config/daemon-state";
import type { Presenter } from "../../runtime/presenter/types";
import type { ExpectedRoutesReadSession } from "../../system/expected-routes-read-session";
import type { PrimaryBindingReadSession } from "../../system/primary-binding-read-session";
import { toErrorMessage } from "../core/logger";
import type { RouteCatalog } from "../core/types";
import {
  type DeviceRuntimeStateSyncResult,
  NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON,
  syncDeviceRuntimeStateProjection,
} from "../reporting/device-runtime-state-sync";
import { loadDaemonRouteCatalog } from "../routing/route-catalog";
import {
  emitDaemonLifecycleEvent,
  runDaemonServiceManagerAction,
} from "./daemon-lifecycle-journal";
import {
  hasActiveDaemonOwners,
  readCurrentDaemonOwnerSnapshot,
  summarizeDaemonOwnerSnapshot,
} from "./daemon-service-owner-snapshot";
import {
  getEffectiveDaemonRuntimeStatus,
  resolveDaemonRuntimeState,
  resolveDaemonServiceManagerForRuntimeState,
  waitForDaemonSystemServiceToStop,
} from "./daemon-service-runtime";

type LocalServiceDemandDecision =
  | "keep_running"
  | "allow_auto_stop"
  | "indeterminate";

export type LocalServiceDemand = {
  decision: LocalServiceDemandDecision;
  hasLocalExecutionRoute: boolean;
  repairableReplyCandidateCount: number;
  reason: string;
  localExecutionRouteCount: number;
  projection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null;
};

export type LocalServiceAutoStopIdleResult = {
  autoStopped: boolean;
  effectiveRuntimeStatus: DaemonServiceRuntimeStatus["status"] | null;
  localDemand: LocalServiceDemand;
};

const QUIET_PRESENTER: Presenter = {
  view: "agent",
  event: () => undefined,
  line: () => undefined,
  data: () => undefined,
};

const AUTO_STOP_WAIT_MS = 3000;
const AUTO_STOP_POLL_MS = 200;
const NOT_INSTALLED_DAEMON_STATUS: DaemonStatus = {
  installed: false,
  state: null,
};

export async function resolveLocalServiceDemand(input: {
  bindingReads?: PrimaryBindingReadSession;
  expectedRoutesRead?: ExpectedRoutesReadSession;
  ownerUserId?: string | null;
  projection?: DeviceRuntimeStateSyncResult | null;
  routeCatalog?: RouteCatalog;
  runtimeWorkdir?: string;
}): Promise<LocalServiceDemand> {
  const projection =
    input.projection === undefined
      ? await syncDeviceRuntimeStateProjection({
          bindingReads: input.bindingReads,
          expectedRoutesRead: input.expectedRoutesRead,
          mode: "check",
        }).catch(() => null)
      : input.projection;
  const ownerUserId = normalizeOptionalString(input.ownerUserId);

  if (!ownerUserId) {
    return {
      decision: "indeterminate",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "owner user is unavailable",
      localExecutionRouteCount: 0,
      projection,
    };
  }

  const localAdapterContainer = createLocalAdapterContainer(
    createLocalAdapterEntries({
      runtimeWorkdir: input.runtimeWorkdir ?? process.cwd(),
    })
  );
  if (localAdapterContainer.listAdapters().length === 0) {
    return {
      decision: "indeterminate",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local adapters are configured on this device",
      localExecutionRouteCount: 0,
      projection,
    };
  }

  let localExecutionRouteCount = 0;
  let repairableReplyCandidateCount = 0;
  try {
    const routeCatalog =
      input.routeCatalog ??
      (await loadDaemonRouteCatalog({
        allowEmpty: true,
        bindingReads: input.bindingReads,
        expectedRoutesRead: input.expectedRoutesRead,
        localAdapterContainer,
        localReplyStateMode: "check",
        ownerUserId,
        presenter: QUIET_PRESENTER,
        quiet: true,
      }));
    localExecutionRouteCount = routeCatalog.profileIds.length;
    repairableReplyCandidateCount = routeCatalog.skippedProfiles.filter(
      (profile) => isRepairableSkippedDaemonProfile(profile.skipReason)
    ).length;
  } catch (error) {
    return {
      decision: "indeterminate",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: `failed to load local daemon routes: ${toErrorMessage(error)}`,
      localExecutionRouteCount: 0,
      projection,
    };
  }

  if (localExecutionRouteCount > 0) {
    return {
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount,
      reason: "local execution routes are available",
      localExecutionRouteCount,
      projection,
    };
  }

  if (repairableReplyCandidateCount > 0) {
    return {
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount,
      reason:
        "reply-capable local agent profiles are still reconciling on this device",
      localExecutionRouteCount,
      projection,
    };
  }

  return {
    decision: "allow_auto_stop",
    hasLocalExecutionRoute: false,
    repairableReplyCandidateCount,
    reason: resolveZeroLocalValueReason(projection),
    localExecutionRouteCount,
    projection,
  };
}

function isRepairableSkippedDaemonProfile(
  skipReason: DaemonProfileSkipReason
): boolean {
  return (
    skipReason === "projection.missing" || skipReason === "workspace.missing"
  );
}

export async function maybeAutoStopIdleLocalService(input: {
  codePrefix: string;
  ownerUserId?: string | null;
  presenter: Presenter;
  runtimeWorkdir?: string;
}): Promise<LocalServiceAutoStopIdleResult> {
  const localDemand = await resolveLocalServiceDemand({
    ownerUserId: input.ownerUserId,
    runtimeWorkdir: input.runtimeWorkdir,
  });
  if (localDemand.decision !== "allow_auto_stop") {
    return {
      autoStopped: false,
      effectiveRuntimeStatus: null,
      localDemand,
    };
  }

  return await withDaemonServiceRegistrationMutationLock(
    async () => await stopIdleLocalServiceWithLock(input, localDemand),
    {
      intent: "status_cleanup",
      command: "openmeld service auto-stop",
    }
  );
}

async function stopIdleLocalServiceWithLock(
  input: {
    codePrefix: string;
    ownerUserId?: string | null;
    presenter: Presenter;
    runtimeWorkdir?: string;
  },
  localDemand: LocalServiceDemand
): Promise<LocalServiceAutoStopIdleResult> {
  const status = await getDaemonStatus().catch(
    () => NOT_INSTALLED_DAEMON_STATUS
  );
  if (!status.installed) {
    return {
      autoStopped: false,
      effectiveRuntimeStatus: null,
      localDemand,
    };
  }

  const ownerSnapshot = await readCurrentDaemonOwnerSnapshot().catch(
    () => null
  );
  await emitDaemonLifecycleEvent({
    type: "owner.snapshot",
    result: "observed",
    metadata: ownerSnapshot
      ? summarizeDaemonOwnerSnapshot(ownerSnapshot)
      : {
          reason: "owner_snapshot_unavailable",
        },
    command: "openmeld service auto-stop",
    intent: "status_cleanup",
  });
  const runtimeState = await resolveDaemonRuntimeState(status);
  if (
    !(ownerSnapshot && runtimeState) ||
    runtimeState.status !== "running" ||
    runtimeState.mode !== "background" ||
    !ownerSnapshot.mustStopManagerFirst ||
    !ownerSnapshot.serviceManager
  ) {
    return {
      autoStopped: false,
      effectiveRuntimeStatus: runtimeState?.status ?? null,
      localDemand,
    };
  }

  const { serviceManager, serviceManagerStatus } =
    await resolveDaemonServiceManagerForRuntimeState({
      runtimeState,
      status,
    });
  const effectiveRuntimeStatus = getEffectiveDaemonRuntimeStatus({
    runtimeState,
    serviceManagerStatus,
  });
  if (!serviceManager || effectiveRuntimeStatus !== "running") {
    return {
      autoStopped: false,
      effectiveRuntimeStatus,
      localDemand,
    };
  }

  try {
    await runDaemonServiceManagerAction({
      action: "stop",
      command: "openmeld service auto-stop",
      controller: serviceManager.controller,
      intent: "status_cleanup",
      metadata: {
        localDemandReason: localDemand.reason,
      },
      run: async () => await serviceManager.stop(),
    });
    const stopped = await waitForDaemonSystemServiceToStop({
      manager: serviceManager,
      waitMs: AUTO_STOP_WAIT_MS,
      pollMs: AUTO_STOP_POLL_MS,
    });
    if (!stopped) {
      input.presenter.line({
        code: `${input.codePrefix}.auto_stop_failed`,
        text: "OpenMeld could not auto-stop the background service. Run `openmeld service stop` if you want it off right now.",
      });
      return {
        autoStopped: false,
        effectiveRuntimeStatus,
        localDemand,
      };
    }

    const finalOwnerSnapshot = await readCurrentDaemonOwnerSnapshot().catch(
      () => null
    );
    if (finalOwnerSnapshot && hasActiveDaemonOwners(finalOwnerSnapshot)) {
      input.presenter.line({
        code: `${input.codePrefix}.auto_stop_failed`,
        text: "OpenMeld stopped the system service manager, but local service owners are still active on this device.",
      });
      return {
        autoStopped: false,
        effectiveRuntimeStatus,
        localDemand,
      };
    }

    await clearDaemonServiceRuntimeState();
    input.presenter.line({
      code: `${input.codePrefix}.auto_stopped`,
      text: formatLocalServiceAutoStoppedMessage(localDemand),
    });
    return {
      autoStopped: true,
      effectiveRuntimeStatus: "not_running",
      localDemand,
    };
  } catch (error) {
    input.presenter.line({
      code: `${input.codePrefix}.auto_stop_failed`,
      text: `OpenMeld could not auto-stop the background service. ${toErrorMessage(
        error
      )}`,
    });
    return {
      autoStopped: false,
      effectiveRuntimeStatus,
      localDemand,
    };
  }
}

export function formatLocalServiceAutoStoppedMessage(
  localDemand: LocalServiceDemand
): string {
  if (
    localDemand.projection?.status === "ok" &&
    localDemand.projection.projectedControllerIds.length === 0
  ) {
    return "OpenMeld stopped the background service because this device currently has no projected local agent controllers.";
  }

  return "OpenMeld stopped the background service because this device currently has no local execution routes.";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveZeroLocalValueReason(
  projection: Awaited<
    ReturnType<typeof syncDeviceRuntimeStateProjection>
  > | null
): string {
  if (!projection) {
    return "no local execution routes are available";
  }
  if (
    projection.status === "ok" &&
    projection.projectedControllerIds.length === 0
  ) {
    return NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON;
  }
  if (projection.status === "degraded") {
    return "projected local controllers are not currently available for local execution";
  }
  return "no local execution routes are available";
}
