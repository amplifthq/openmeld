export type ProjectionSyncResultForReconcile = {
  disabledControllerIds: readonly string[];
  missingControllerIds: readonly string[];
  mode: "check" | "repair";
  projectedControllerIds?: readonly string[];
  reason: string;
  repairedControllerIds?: readonly string[];
  repairRequiredControllerIds?: readonly string[];
  status?: string;
};

export type ReconcileDriftClass = "projection" | "route_registration";

export type ReconcileOwner = "device-runtime-state-sync" | "service-runner";

export type ReconcileAction =
  | "repair_projection"
  | "reconnect_route_registration";

export type ReconcileSkipReason =
  | "auto_install_disabled"
  | "downgrade_blocked"
  | "auth_unavailable"
  | "foreground_ownership_active"
  | "lifecycle_change_in_progress"
  | "local_projection_exists"
  | "not_drifted"
  | "not_installed"
  | "prompt_unavailable"
  | "read_only_surface"
  | "user_declined";

export type ReconcileDecision = {
  action: ReconcileAction;
  driftClass: ReconcileDriftClass;
  driftDetected: boolean;
  foregroundActive: boolean;
  lifecycleLocked: boolean;
  owner: ReconcileOwner;
  skipReason: ReconcileSkipReason | null;
};

export function resolveProjectionReconcileDecision(input: {
  result: ProjectionSyncResultForReconcile;
}): ReconcileDecision {
  const driftDetected =
    input.result.missingControllerIds.length > 0 ||
    input.result.disabledControllerIds.length > 0 ||
    (input.result.repairRequiredControllerIds?.length ?? 0) > 0;

  return createDecision({
    action: "repair_projection",
    driftClass: "projection",
    driftDetected,
    foregroundActive: false,
    lifecycleLocked: false,
    owner: "device-runtime-state-sync",
    skipReason: resolveProjectionSkipReason({
      driftDetected,
      mode: input.result.mode,
      reason: input.result.reason,
    }),
  });
}

export function resolveRouteRegistrationReconcileDecision(input: {
  driftDetected: boolean;
  foregroundActive: boolean;
}): ReconcileDecision {
  return createDecision({
    action: "reconnect_route_registration",
    driftClass: "route_registration",
    driftDetected: input.driftDetected,
    foregroundActive: input.foregroundActive,
    lifecycleLocked: false,
    owner: "service-runner",
    skipReason: input.driftDetected ? null : "not_drifted",
  });
}

function createDecision(input: ReconcileDecision): ReconcileDecision {
  return input;
}

function resolveProjectionSkipReason(input: {
  driftDetected: boolean;
  mode: ProjectionSyncResultForReconcile["mode"];
  reason: string;
}): ReconcileSkipReason | null {
  if (input.reason === "authentication is not valid") {
    return "auth_unavailable";
  }
  if (input.reason === "local projection already exists") {
    return "local_projection_exists";
  }
  if (input.mode === "check") {
    if (!input.driftDetected) {
      return "not_drifted";
    }
    return "read_only_surface";
  }
  if (!input.driftDetected) {
    return null;
  }
  return null;
}
