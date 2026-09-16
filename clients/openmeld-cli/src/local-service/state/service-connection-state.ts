// Local service connection state machine (facts.md fact #4: the service's
// self-description). One source for "is this service actually carrying its
// cloud connection right now, and if not, why" — consumed by the local
// control plane health payload and transition-logged exactly once per change
// so failures are visible without log spam.

export type ServiceConnectionStateName =
  | "starting"
  | "connecting"
  | "authentication_required"
  | "online"
  | "degraded"
  | "stopping";

export type ServiceConnectionAuthState =
  | "missing"
  | "valid"
  | "expired"
  | "invalid"
  | "revoked";

export type ServiceConnectionDegradedReason =
  | "auth_rejected"
  | "auth_unavailable"
  | "network_unreachable"
  | "internal";

export type ServiceConnectionState = {
  state: ServiceConnectionStateName;
  reason: ServiceConnectionDegradedReason | "reconnecting" | null;
  detail: string | null;
  authState: ServiceConnectionAuthState | null;
  updatedAt: string;
};

export type ServiceConnectionStateTracker = {
  get: () => ServiceConnectionState;
  set: (
    state: ServiceConnectionStateName,
    options?: {
      reason?: ServiceConnectionState["reason"];
      detail?: string | null;
      authState?: ServiceConnectionAuthState | null;
    }
  ) => void;
};

const DAEMON_STREAM_UPGRADE_REJECTION_STATUS_PATTERN =
  /daemon stream upgrade rejected \(status=(\d+)/;

export function createServiceConnectionStateTracker(input?: {
  onTransition?: (next: ServiceConnectionState) => void;
}): ServiceConnectionStateTracker {
  let current: ServiceConnectionState = {
    state: "starting",
    reason: null,
    detail: null,
    authState: null,
    updatedAt: new Date().toISOString(),
  };

  return {
    get: () => current,
    set: (state, options) => {
      const reason = options?.reason ?? null;
      const detail = options?.detail ?? null;
      const authState = options?.authState ?? null;
      if (
        current.state === state &&
        current.reason === reason &&
        current.detail === detail &&
        current.authState === authState
      ) {
        return;
      }
      current = {
        state,
        reason,
        detail,
        authState,
        updatedAt: new Date().toISOString(),
      };
      input?.onTransition?.(current);
    },
  };
}

// Map a connect/session failure to a degraded reason. Conservative: only
// claim auth when the evidence says auth; everything network-shaped is
// network_unreachable; the rest is internal (with detail preserved).
export function classifyConnectionFailureReason(
  message: string
): ServiceConnectionDegradedReason {
  const lowered = message.toLowerCase();
  const upgradeRejectionStatus =
    readDaemonStreamUpgradeRejectionStatus(lowered);
  if (upgradeRejectionStatus !== null) {
    return upgradeRejectionStatus === 401 ? "auth_rejected" : "internal";
  }
  if (
    lowered.includes("fetch failed") ||
    lowered.includes("timed out") ||
    lowered.includes("timeout") ||
    lowered.includes("econn") ||
    lowered.includes("enotfound") ||
    lowered.includes("socket") ||
    lowered.includes("network")
  ) {
    return "network_unreachable";
  }
  return "internal";
}

function readDaemonStreamUpgradeRejectionStatus(
  message: string
): number | null {
  const match = DAEMON_STREAM_UPGRADE_REJECTION_STATUS_PATTERN.exec(message);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] ?? "", 10);
}

export function toHealthProjection(state: ServiceConnectionState): {
  state: "ok" | "degraded";
  runtimeState: "healthy" | "suspect" | "idle";
  reasonCode: string;
} {
  if (state.state === "online") {
    return { state: "ok", runtimeState: "healthy", reasonCode: "ok" };
  }
  if (state.state === "stopping") {
    return { state: "degraded", runtimeState: "idle", reasonCode: "stopping" };
  }
  if (state.state === "authentication_required") {
    return {
      state: "degraded",
      runtimeState: "suspect",
      reasonCode: "authentication_required",
    };
  }
  return {
    state: "degraded",
    runtimeState: "suspect",
    reasonCode: state.reason ?? state.state,
  };
}
