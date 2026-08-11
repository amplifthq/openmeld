import { z } from "zod/v4";
import { localFolderPathSchema } from "./local-folder-path";
import { openMeldRequestContextSchema } from "./profile-identity";
import { daemonServiceLaneSchema } from "./service-contract";

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const LOCAL_FOLDER_PICKER_FRAME_VERSION = 1 as const;

export const OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER =
  "x-openmeld-local-folder-picker-capability" as const;
export const LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY =
  "local-folder-picker-v1" as const;

export const localFolderPickerRuntimeCapabilitySchema = z.strictObject({
  selectFolders: z.literal(true),
});

export const localFolderPickerPurposeSchema = z.enum([
  "computer_file_access",
  "project_connection",
  "agent_profile_working_folder",
]);

export const localFolderPickerRequestSchema = z.strictObject({
  allowMultiple: z.boolean(),
  expectedDeviceId: boundedIdentifierSchema,
  purpose: localFolderPickerPurposeSchema,
});

export const localFolderPickerErrorCodeSchema = z.enum([
  "local.folder_picker.device_mismatch",
  "local.folder_picker.helper_missing",
  "local.folder_picker.internal_error",
  "local.folder_picker.invalid_request",
  "local.folder_picker.invalid_response",
  "local.folder_picker.no_interactive_session",
  "local.folder_picker.picker_busy",
  "local.folder_picker.portal_unavailable",
  "local.folder_picker.service_offline",
  "local.folder_picker.service_update_required",
  "local.folder_picker.timed_out",
  "local.folder_picker.unsupported_platform",
]);

export const localFolderPickerHelperErrorCodeSchema = z.enum([
  "local.folder_picker.internal_error",
  "local.folder_picker.invalid_response",
  "local.folder_picker.no_interactive_session",
  "local.folder_picker.portal_unavailable",
  "local.folder_picker.timed_out",
  "local.folder_picker.unsupported_platform",
]);

const localFolderPickerHelperSelectedResultSchema = z.strictObject({
  paths: z.array(localFolderPathSchema).min(1).max(128),
  status: z.literal("selected"),
});
const localFolderPickerHelperCancelledResultSchema = z.strictObject({
  status: z.literal("cancelled"),
});
const localFolderPickerHelperUnavailableResultSchema = z.strictObject({
  code: localFolderPickerHelperErrorCodeSchema,
  status: z.literal("unavailable"),
});

export const localFolderPickerHelperResultSchema = z.discriminatedUnion(
  "status",
  [
    localFolderPickerHelperSelectedResultSchema,
    localFolderPickerHelperCancelledResultSchema,
    localFolderPickerHelperUnavailableResultSchema,
  ]
);

export const localFolderPickerHelperProtocolResultSchema = z.discriminatedUnion(
  "status",
  [
    localFolderPickerHelperSelectedResultSchema.extend({
      v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
    }),
    localFolderPickerHelperCancelledResultSchema.extend({
      v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
    }),
    localFolderPickerHelperUnavailableResultSchema.extend({
      v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
    }),
  ]
);

export const localFolderPickerSelectedResultSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
  paths: z.array(localFolderPathSchema).min(1).max(128),
  status: z.literal("selected"),
});

export const localFolderPickerCancelledResultSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
  status: z.literal("cancelled"),
});

export const localFolderPickerUnavailableResultSchema = z.strictObject({
  code: localFolderPickerErrorCodeSchema,
  message: z.string().trim().min(1).max(1024),
  status: z.literal("unavailable"),
});

export const localFolderPickerResultSchema = z.discriminatedUnion("status", [
  localFolderPickerSelectedResultSchema,
  localFolderPickerCancelledResultSchema,
  localFolderPickerUnavailableResultSchema,
]);

export const localFolderPickerRpcInputSchema =
  localFolderPickerRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });

export const localFolderPickerRequestFrameSchema = z.strictObject({
  code: z.literal("daemon.local_folder_picker.select_folders"),
  payload: z.strictObject({
    request: localFolderPickerRequestSchema,
    requestId: boundedIdentifierSchema,
  }),
  v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
});

export const localFolderPickerResultFrameSchema = z.strictObject({
  code: z.literal("daemon.local_folder_picker.select_folders_result"),
  payload: z.strictObject({
    requestId: boundedIdentifierSchema,
    result: localFolderPickerResultSchema,
  }),
  v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
});

export const localFolderPickerDaemonFrameSchema = z.discriminatedUnion("code", [
  localFolderPickerRequestFrameSchema,
  localFolderPickerResultFrameSchema,
]);

export const runtimeTransportLocalFolderPickerRequestSchema = z.strictObject({
  deviceId: boundedIdentifierSchema,
  lane: daemonServiceLaneSchema,
  ownerUserId: boundedIdentifierSchema,
  request: localFolderPickerRequestSchema,
  requestId: boundedIdentifierSchema,
  v: z.literal(LOCAL_FOLDER_PICKER_FRAME_VERSION),
});
