import {
  computerFileAccessReadRpcInputSchema,
  computerFileAccessUpdateRpcInputSchema,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessErrorResponse,
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRpcInput,
  ComputerFileAccessUpdateRpcInput,
  DaemonServiceLane,
} from "@openmeld/schemas/types";
import type {
  readRuntimeTransportComputerFileAccessPolicy,
  updateRuntimeTransportComputerFileAccessPolicy,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";

type CurrentComputerFileAccessTarget = {
  deviceId: string;
  runtimeLane: DaemonServiceLane;
};

type ComputerFileAccessRpcDependencies = {
  readPolicy: typeof readRuntimeTransportComputerFileAccessPolicy;
  requireOwnerUserId: (
    context: ComputerFileAccessReadRpcInput["context"]
  ) => string;
  resolveCurrentTarget: (input: {
    env: CoreBindings;
    userId: string;
  }) => Promise<CurrentComputerFileAccessTarget>;
  updatePolicy: typeof updateRuntimeTransportComputerFileAccessPolicy;
};

export function createComputerFileAccessRpc(
  dependencies: ComputerFileAccessRpcDependencies
) {
  return {
    async readPolicy(
      env: CoreBindings,
      input: ComputerFileAccessReadRpcInput
    ): Promise<ComputerFileAccessPolicyResponse> {
      const parsed = computerFileAccessReadRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.issues[0]?.message);
      }
      const userId = dependencies.requireOwnerUserId(parsed.data.context);
      const target = await dependencies.resolveCurrentTarget({ env, userId });
      requireExpectedDevice(parsed.data.expectedDeviceId, target.deviceId);
      return requirePolicyResponse(
        await dependencies.readPolicy({
          deviceId: target.deviceId,
          env,
          ownerUserId: userId,
          request: { expectedDeviceId: target.deviceId },
          runtimeLane: target.runtimeLane,
        })
      );
    },

    async updatePolicy(
      env: CoreBindings,
      input: ComputerFileAccessUpdateRpcInput
    ): Promise<ComputerFileAccessPolicyResponse> {
      const parsed = computerFileAccessUpdateRpcInputSchema.safeParse(input);
      if (!parsed.success) {
        throwInvalidPayload(parsed.error.issues[0]?.message);
      }
      const userId = dependencies.requireOwnerUserId(parsed.data.context);
      const target = await dependencies.resolveCurrentTarget({ env, userId });
      requireExpectedDevice(parsed.data.expectedDeviceId, target.deviceId);
      return requirePolicyResponse(
        await dependencies.updatePolicy({
          deviceId: target.deviceId,
          env,
          ownerUserId: userId,
          request: {
            expectedDeviceId: target.deviceId,
            expectedRevision: parsed.data.expectedRevision,
            idempotencyKey: parsed.data.idempotencyKey,
            policy: parsed.data.policy,
          },
          runtimeLane: target.runtimeLane,
        })
      );
    },
  };
}

function requireExpectedDevice(expectedDeviceId: string, deviceId: string) {
  if (expectedDeviceId === deviceId) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "computer.file_access.device_mismatch",
    reason:
      "This file access request targeted a different Computer. Refresh Computers and try again.",
    status: 409,
  });
}

function requirePolicyResponse(
  result: ComputerFileAccessErrorResponse | ComputerFileAccessPolicyResponse
): ComputerFileAccessPolicyResponse {
  if (!("status" in result)) {
    return result;
  }
  throw createCoreRpcHttpError({
    code: result.code,
    reason: result.message,
    status: resolveErrorStatus(result.code),
  });
}

function resolveErrorStatus(
  code: ComputerFileAccessErrorResponse["code"]
): number {
  if (code === "computer.file_access.service_offline") {
    return 503;
  }
  if (code === "computer.file_access.timeout") {
    return 504;
  }
  if (code === "computer.file_access.invalid_request") {
    return 400;
  }
  if (code === "computer.file_access.revision_mismatch") {
    return 409;
  }
  if (
    code === "computer.file_access.internal_error" ||
    code === "computer.file_access.invalid_response"
  ) {
    return 502;
  }
  return 409;
}

function throwInvalidPayload(reason?: string): never {
  throw createCoreRpcHttpError({
    code: "computer.file_access.invalid_request",
    reason: reason ?? "The Computer file access request is invalid.",
    status: 400,
  });
}
