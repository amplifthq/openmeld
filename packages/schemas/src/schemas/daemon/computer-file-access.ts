import * as z from "zod/v4";
import { localFolderPathSchema } from "./local-folder-path";
import { openMeldRequestContextSchema } from "./profile-identity";
import { daemonServiceLaneSchema } from "./service-contract";

const boundedIdentifierSchema = z.string().trim().min(1).max(512);

export const OPENMELD_RUNTIME_CAPABILITIES_HEADER =
  "x-openmeld-runtime-capabilities" as const;
export const COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY =
  "computer-file-access-v1" as const;

export const computerFileAccessAbsolutePathSchema = localFolderPathSchema;

export const computerFileAccessModeSchema = z.enum([
  "local_agent_settings",
  "only_selected_folders",
  "block_selected_folders",
]);

const computerFileAccessDefaultPolicyInputSchema = z.strictObject({
  mode: z.literal("local_agent_settings"),
});

const computerFileAccessFolderPolicyInputSchema = z.strictObject({
  folders: z.array(computerFileAccessAbsolutePathSchema).min(1).max(128),
  mode: z.enum(["only_selected_folders", "block_selected_folders"]),
});

export const computerFileAccessPolicyInputSchema = z.discriminatedUnion(
  "mode",
  [
    computerFileAccessDefaultPolicyInputSchema,
    computerFileAccessFolderPolicyInputSchema,
  ]
);

const computerFileAccessPolicyMetadataShape = {
  revision: z.number().int().positive(),
  updatedAtMs: z.number().int().nonnegative(),
} as const;

export const computerFileAccessPolicySchema = z.discriminatedUnion("mode", [
  computerFileAccessDefaultPolicyInputSchema.extend(
    computerFileAccessPolicyMetadataShape
  ),
  computerFileAccessFolderPolicyInputSchema.extend(
    computerFileAccessPolicyMetadataShape
  ),
]);

export const computerFileAccessReadRequestSchema = z.strictObject({
  expectedDeviceId: boundedIdentifierSchema,
});

export const computerFileAccessUpdateRequestSchema = z.strictObject({
  expectedDeviceId: boundedIdentifierSchema,
  expectedRevision: z.number().int().positive(),
  idempotencyKey: boundedIdentifierSchema,
  policy: computerFileAccessPolicyInputSchema,
});

export const computerFileAccessPolicyResponseSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
  policy: computerFileAccessPolicySchema,
});

export const computerFileAccessErrorCodeSchema = z.enum([
  "computer.file_access.device_mismatch",
  "computer.file_access.internal_error",
  "computer.file_access.invalid_request",
  "computer.file_access.invalid_response",
  "computer.file_access.path_not_directory",
  "computer.file_access.path_not_found",
  "computer.file_access.path_unreadable",
  "computer.file_access.revision_mismatch",
  "computer.file_access.service_offline",
  "computer.file_access.service_update_required",
  "computer.file_access.timeout",
  "computer.file_access.unsupported",
]);

export const computerFileAccessErrorResponseSchema = z.strictObject({
  status: z.literal("rejected"),
  code: computerFileAccessErrorCodeSchema,
  message: z.string().trim().min(1).max(1024),
});

export const computerFileAccessPolicyResultSchema = z.union([
  computerFileAccessPolicyResponseSchema,
  computerFileAccessErrorResponseSchema,
]);

export const computerFileAccessReadRpcInputSchema =
  computerFileAccessReadRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });

export const computerFileAccessUpdateRpcInputSchema =
  computerFileAccessUpdateRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });

const COMPUTER_FILE_ACCESS_FRAME_VERSION = 1 as const;

function defineRequestFrame<TCode extends string, TRequest extends z.ZodType>(
  code: TCode,
  request: TRequest
) {
  return z.strictObject({
    v: z.literal(COMPUTER_FILE_ACCESS_FRAME_VERSION),
    code: z.literal(code),
    payload: z.strictObject({
      requestId: boundedIdentifierSchema,
      request,
    }),
  });
}

function defineResultFrame<TCode extends string>(code: TCode) {
  return z.strictObject({
    v: z.literal(COMPUTER_FILE_ACCESS_FRAME_VERSION),
    code: z.literal(code),
    payload: z.strictObject({
      requestId: boundedIdentifierSchema,
      result: computerFileAccessPolicyResultSchema,
    }),
  });
}

export const computerFileAccessReadRequestFrameSchema = defineRequestFrame(
  "daemon.computer_file_access.read_policy",
  computerFileAccessReadRequestSchema
);
export const computerFileAccessReadResultFrameSchema = defineResultFrame(
  "daemon.computer_file_access.read_policy_result"
);
export const computerFileAccessUpdateRequestFrameSchema = defineRequestFrame(
  "daemon.computer_file_access.update_policy",
  computerFileAccessUpdateRequestSchema
);
export const computerFileAccessUpdateResultFrameSchema = defineResultFrame(
  "daemon.computer_file_access.update_policy_result"
);

export const computerFileAccessDaemonFrameSchema = z.discriminatedUnion(
  "code",
  [
    computerFileAccessReadRequestFrameSchema,
    computerFileAccessReadResultFrameSchema,
    computerFileAccessUpdateRequestFrameSchema,
    computerFileAccessUpdateResultFrameSchema,
  ]
);

const runtimeTransportComputerFileAccessTargetShape = {
  v: z.literal(COMPUTER_FILE_ACCESS_FRAME_VERSION),
  ownerUserId: boundedIdentifierSchema,
  deviceId: boundedIdentifierSchema,
  lane: daemonServiceLaneSchema,
  requestId: boundedIdentifierSchema,
} as const;

export const runtimeTransportComputerFileAccessReadRequestSchema =
  z.strictObject({
    ...runtimeTransportComputerFileAccessTargetShape,
    request: computerFileAccessReadRequestSchema,
  });

export const runtimeTransportComputerFileAccessUpdateRequestSchema =
  z.strictObject({
    ...runtimeTransportComputerFileAccessTargetShape,
    request: computerFileAccessUpdateRequestSchema,
  });
