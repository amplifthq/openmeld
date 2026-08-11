import { computerFileAccessDaemonFrameSchema } from "@openmeld/schemas";
import type {
  ComputerFileAccessDaemonFrame,
  ComputerFileAccessErrorResponse,
  ComputerFileAccessPolicy,
  ComputerFileAccessPolicyResult,
} from "@openmeld/schemas/types";
import {
  ComputerFileAccessStoreError,
  readComputerFileAccessPolicy,
  updateComputerFileAccessPolicy,
} from "./computer-file-access-store";

type RequestFrame = Extract<
  ComputerFileAccessDaemonFrame,
  {
    code:
      | "daemon.computer_file_access.read_policy"
      | "daemon.computer_file_access.update_policy";
  }
>;

type ResultFrame = Extract<
  ComputerFileAccessDaemonFrame,
  {
    code:
      | "daemon.computer_file_access.read_policy_result"
      | "daemon.computer_file_access.update_policy_result";
  }
>;

export async function handleComputerFileAccessFrame(input: {
  deviceId: string;
  frame: RequestFrame;
  nowMs?: number;
  storePath: string;
}): Promise<ResultFrame> {
  const request = input.frame.payload.request;
  if (request.expectedDeviceId !== input.deviceId) {
    return buildResultFrame(
      input.frame,
      rejected(
        "computer.file_access.device_mismatch",
        "This file access request targeted a different Computer. Refresh Computers and try again."
      )
    );
  }
  try {
    const policy = await resolvePolicy(input);
    return buildResultFrame(input.frame, {
      deviceId: input.deviceId,
      policy,
    });
  } catch (error) {
    if (error instanceof ComputerFileAccessStoreError) {
      return buildResultFrame(input.frame, rejected(error.code, error.message));
    }
    return buildResultFrame(
      input.frame,
      rejected(
        "computer.file_access.internal_error",
        "OpenMeld couldn’t update file access on this computer. Try again."
      )
    );
  }
}

function resolvePolicy(input: {
  frame: RequestFrame;
  nowMs?: number;
  storePath: string;
}): Promise<ComputerFileAccessPolicy> {
  if (input.frame.code === "daemon.computer_file_access.read_policy") {
    return readComputerFileAccessPolicy(input.storePath);
  }
  return updateComputerFileAccessPolicy({
    expectedRevision: input.frame.payload.request.expectedRevision,
    idempotencyKey: input.frame.payload.request.idempotencyKey,
    ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
    policy: input.frame.payload.request.policy,
    storePath: input.storePath,
  });
}

function rejected(
  code: ComputerFileAccessErrorResponse["code"],
  message: string
): ComputerFileAccessErrorResponse {
  return { code, message, status: "rejected" };
}

function buildResultFrame(
  frame: RequestFrame,
  result: ComputerFileAccessPolicyResult
): ResultFrame {
  return computerFileAccessDaemonFrameSchema.parse({
    code: `${frame.code}_result`,
    payload: { requestId: frame.payload.requestId, result },
    v: 1,
  }) as ResultFrame;
}
