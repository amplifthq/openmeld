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
    return (
      resolveBindingComputerLiveTarget({
        bindingTarget: input.bindingTarget,
        inventory: input.inventory,
        ownerService: input.ownerService,
      }) ?? input.bindingTarget
    );
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

function resolveBindingComputerLiveTarget(input: {
  bindingTarget: Extract<
    CurrentLocalRuntimeTarget,
    { availability: "resolved" }
  >;
  inventory: LocalRuntimesResponse;
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): CurrentLocalRuntimeTarget | null {
  if (input.ownerService.online !== true) {
    return null;
  }
  if (
    input.ownerService.sessions.some(
      (session) =>
        session.deviceId === input.bindingTarget.deviceId &&
        session.lane === input.bindingTarget.runtimeLane
    )
  ) {
    return input.bindingTarget;
  }

  const connectedComputer = input.inventory.localRuntimes.find((computer) =>
    localRuntimeComputerContainsDevice(computer, input.bindingTarget.deviceId)
  );
  if (!connectedComputer?.connectedComputerId) {
    return null;
  }

  const connectedDeviceIds = new Set([
    connectedComputer.deviceId,
    ...(connectedComputer.legacyDeviceIds ?? []),
    ...connectedComputer.executionTargets.map((target) => target.deviceId),
  ]);
  const liveTargetsByKey = new Map<
    string,
    { deviceId: string; runtimeLane: DaemonServiceLane }
  >();
  for (const session of input.ownerService.sessions) {
    if (
      session.lane !== input.bindingTarget.runtimeLane ||
      !connectedDeviceIds.has(session.deviceId)
    ) {
      continue;
    }
    const key = `${session.deviceId}:${session.lane}`;
    liveTargetsByKey.set(key, {
      deviceId: session.deviceId,
      runtimeLane: session.lane,
    });
  }

  if (liveTargetsByKey.size !== 1) {
    return null;
  }
  const target = liveTargetsByKey.values().next().value;
  return target ? { availability: "resolved", ...target } : null;
}

export function localRuntimeComputerContainsDevice(
  computer: LocalRuntimesResponse["localRuntimes"][number],
  deviceId: string
): boolean {
  return (
    computer.deviceId === deviceId ||
    computer.legacyDeviceIds?.includes(deviceId) === true ||
    computer.executionTargets.some((target) => target.deviceId === deviceId)
  );
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
