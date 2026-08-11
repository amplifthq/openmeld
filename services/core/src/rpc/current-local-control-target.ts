import type {
  DaemonServiceLane,
  LocalRuntimeExecutionTarget,
  LocalRuntimesResponse,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import {
  type CurrentLocalRuntimeTarget,
  resolveCurrentLocalRuntimeExecutionTarget,
} from "../start/application/current-local-runtime-target";
import { createCoreRpcHttpError } from "./errors";

export function requireCurrentLocalRuntimeExecutionTarget(input: {
  bindingTarget: CurrentLocalRuntimeTarget;
  inventory: LocalRuntimesResponse;
  offlineError: {
    code: string;
    reason: string;
    status: number;
  };
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): LocalRuntimeExecutionTarget {
  const target = resolveCurrentLocalRuntimeExecutionTarget(input);
  const hasMatchingLiveSession =
    target !== null &&
    input.ownerService.online === true &&
    input.ownerService.sessions.some(
      (session) =>
        session.deviceId === target.deviceId &&
        session.lane === target.runtimeLane
    );
  if (target && hasMatchingLiveSession) {
    return target;
  }
  throw createCoreRpcHttpError(input.offlineError);
}

export function requireCurrentLocalRuntimeServiceTarget(input: {
  bindingTarget: CurrentLocalRuntimeTarget;
  offlineError: {
    code: string;
    reason: string;
    status: number;
  };
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}): { deviceId: string; runtimeLane: DaemonServiceLane } {
  if (input.bindingTarget.availability !== "resolved") {
    throw createCoreRpcHttpError(input.offlineError);
  }
  const target = {
    deviceId: input.bindingTarget.deviceId,
    runtimeLane: input.bindingTarget.runtimeLane,
  };
  const hasMatchingLiveSession =
    input.ownerService.online === true &&
    input.ownerService.sessions.some(
      (session) =>
        session.deviceId === target.deviceId &&
        session.lane === target.runtimeLane
    );
  if (!hasMatchingLiveSession) {
    throw createCoreRpcHttpError(input.offlineError);
  }
  return target;
}
