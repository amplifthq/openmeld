import type {
  DaemonServiceLane,
  LocalRuntimeExecutionTarget,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";

export type CurrentLocalRuntimeTarget =
  | {
      availability: "resolved";
      deviceId: string;
      runtimeLane: DaemonServiceLane;
    }
  | { availability: "missing" };

/**
 * Resolves the local runtime that current-computer operations are about.
 * Binding remains the routing preference; ServiceRuntime heartbeat liveness
 * supplies the connected-computer fallback when no Binding exists.
 */
export function resolveCurrentLocalRuntimeTarget(input: {
  bindingTarget: CurrentLocalRuntimeTarget;
  inventory: LocalRuntimesResponse;
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): CurrentLocalRuntimeTarget {
  if (input.bindingTarget.availability === "resolved") {
    return input.bindingTarget;
  }
  if (input.ownerService.online !== true) {
    return { availability: "missing" };
  }

  const knownDeviceIds = new Set(
    input.inventory.localRuntimes.flatMap((computer) => [
      computer.deviceId,
      ...(computer.legacyDeviceIds ?? []),
      ...computer.executionTargets.map((target) => target.deviceId),
    ])
  );
  const liveTargetsByKey = new Map<
    string,
    { deviceId: string; runtimeLane: DaemonServiceLane }
  >();
  for (const session of input.ownerService.sessions) {
    if (!knownDeviceIds.has(session.deviceId)) {
      continue;
    }
    const key = `${session.deviceId}:${session.lane}`;
    if (!liveTargetsByKey.has(key)) {
      liveTargetsByKey.set(key, {
        deviceId: session.deviceId,
        runtimeLane: session.lane,
      });
    }
  }

  if (liveTargetsByKey.size !== 1) {
    return { availability: "missing" };
  }
  const target = liveTargetsByKey.values().next().value;
  return target
    ? { availability: "resolved", ...target }
    : { availability: "missing" };
}

export function resolveCurrentLocalRuntimeExecutionTarget(input: {
  bindingTarget: CurrentLocalRuntimeTarget;
  inventory: LocalRuntimesResponse;
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): LocalRuntimeExecutionTarget | null {
  const target = resolveCurrentLocalRuntimeTarget(input);
  if (target.availability === "missing") {
    return null;
  }
  return (
    input.inventory.localRuntimes
      .flatMap((computer) => computer.executionTargets)
      .find(
        (candidate) =>
          candidate.deviceId === target.deviceId &&
          candidate.runtimeLane === target.runtimeLane
      ) ?? null
  );
}
