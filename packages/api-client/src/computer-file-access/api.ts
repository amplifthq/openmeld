import {
  computerFileAccessPolicyResponseSchema,
  computerFileAccessReadRequestSchema,
  computerFileAccessUpdateRequestSchema,
} from "@openmeld/schemas";
import {
  buildComputerFileAccessReadPath,
  buildComputerFileAccessUpdatePath,
} from "./routes";
import type {
  ComputerFileAccessRequestInput,
  CreateComputerFileAccessApi,
} from "./types";

export const createComputerFileAccessApi: CreateComputerFileAccessApi = (
  client
) => ({
  readPolicy: async (input) => {
    const parsed = requireValidInput(computerFileAccessReadRequestSchema, {
      expectedDeviceId: input.expectedDeviceId,
    });
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "Invalid Computer file access response.",
      method: "GET",
      operation: "computer-file-access.read",
      schema: computerFileAccessPolicyResponseSchema,
      url: buildComputerFileAccessReadPath(parsed.expectedDeviceId),
    });
  },
  updatePolicy: async (input) => {
    const parsed = requireValidInput(computerFileAccessUpdateRequestSchema, {
      expectedDeviceId: input.expectedDeviceId,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      policy: input.policy,
    });
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(parsed),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Computer file access response.",
      method: "PUT",
      operation: "computer-file-access.update",
      schema: computerFileAccessPolicyResponseSchema,
      url: buildComputerFileAccessUpdatePath(),
    });
  },
});

function requestOptions(input: ComputerFileAccessRequestInput): {
  requestContext?: ComputerFileAccessRequestInput["requestContext"];
  signal?: AbortSignal;
  timeoutMs?: number;
} {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Computer file access request is invalid. ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
