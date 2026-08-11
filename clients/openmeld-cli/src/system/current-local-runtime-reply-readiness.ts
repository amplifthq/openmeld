import { createCurrentDeviceApi } from "@openmeld/api-client";
import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

export type CurrentLocalRuntimeIdentity = {
  deviceId: string;
  runtimeLane: string;
};

export async function readCurrentLocalRuntimeReplyReadiness(input: {
  gatewayUrl: string;
}): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  return await createCurrentDeviceApi(
    createCliApiClientFoundation(input.gatewayUrl)
  ).getCurrentLocalRuntimeReplyReadiness();
}

export async function assertCurrentLocalRuntimeCanReceiveWake(input: {
  commandLabel?: string;
  gatewayUrl: string;
  openMeldServiceRuntimeIdentity: CurrentLocalRuntimeIdentity;
}): Promise<CurrentLocalRuntimeReplyReadinessResponse> {
  let response: CurrentLocalRuntimeReplyReadinessResponse;
  try {
    response = await readCurrentLocalRuntimeReplyReadiness({
      gatewayUrl: input.gatewayUrl,
    });
  } catch (error) {
    throw new Error(
      formatCurrentLocalRuntimeReplyReadinessFailure({
        commandLabel: input.commandLabel,
        detail: toErrorMessage(error),
        supportCode: "current_reply_readiness.read_failed",
      })
    );
  }

  const mismatchSupportCode = resolveCurrentTargetMismatchSupportCode({
    response,
    openMeldServiceRuntimeIdentity: input.openMeldServiceRuntimeIdentity,
  });
  if (mismatchSupportCode) {
    throw new Error(
      formatCurrentLocalRuntimeReplyReadinessFailure({
        commandLabel: input.commandLabel,
        supportCode: mismatchSupportCode,
      })
    );
  }

  if (
    response.canReplyFromThisComputer &&
    response.service.connected &&
    response.service.matchingCurrentRuntime
  ) {
    return response;
  }

  throw new Error(
    formatCurrentLocalRuntimeReplyReadinessFailure({
      commandLabel: input.commandLabel,
      detail: response.message,
      supportCode: resolveCurrentReplyReadinessSupportCode(response),
    })
  );
}

function resolveCurrentTargetMismatchSupportCode(input: {
  response: CurrentLocalRuntimeReplyReadinessResponse;
  openMeldServiceRuntimeIdentity: CurrentLocalRuntimeIdentity;
}): string | null {
  if (input.response.currentTarget.availability !== "resolved") {
    return "current_reply_readiness.current_target_missing";
  }
  if (
    input.response.currentTarget.deviceId !==
    input.openMeldServiceRuntimeIdentity.deviceId
  ) {
    return "current_reply_readiness.device_mismatch";
  }
  if (
    input.response.currentTarget.runtimeLane !==
    input.openMeldServiceRuntimeIdentity.runtimeLane
  ) {
    return "current_reply_readiness.lane_mismatch";
  }
  return null;
}

function resolveCurrentReplyReadinessSupportCode(
  response: CurrentLocalRuntimeReplyReadinessResponse
): string {
  return (
    response.service.reasonCodes[0] ??
    response.runtime.reasonCodes[0] ??
    `current_reply_readiness.${response.primaryBlocker}`
  );
}

function formatCurrentLocalRuntimeReplyReadinessFailure(input: {
  commandLabel?: string;
  detail?: string;
  supportCode: string;
}): string {
  const commandLabel = input.commandLabel ?? "setup";
  return `OpenMeld Service started, but OpenMeld could not confirm this computer can receive local Wake work yet. Keep OpenMeld Service running, then run ${commandLabel} again from this terminal. Support code: ${input.supportCode}.${input.detail ? ` Detail: ${input.detail}` : ""}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}
