import {
  createLocalAdapterContainer,
  createLocalAdapterEntries,
} from "@openmeld/local-service";
import type { DaemonProfileSkipReason } from "@openmeld/schemas/types";
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

type LocalServiceDemandDecision = "keep_running" | "indeterminate";

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

const QUIET_PRESENTER: Presenter = {
  view: "agent",
  event: () => undefined,
  line: () => undefined,
  data: () => undefined,
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
    decision: "keep_running",
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
