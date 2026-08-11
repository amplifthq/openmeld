import type { z } from "zod/v4";

type LocalFolderPickerSchemas =
  typeof import("../../schemas/daemon/local-folder-picker");

export type LocalFolderPickerPurpose = z.infer<
  LocalFolderPickerSchemas["localFolderPickerPurposeSchema"]
>;
export type LocalFolderPickerRequest = z.infer<
  LocalFolderPickerSchemas["localFolderPickerRequestSchema"]
>;
export type LocalFolderPickerErrorCode = z.infer<
  LocalFolderPickerSchemas["localFolderPickerErrorCodeSchema"]
>;
export type LocalFolderPickerHelperErrorCode = z.infer<
  LocalFolderPickerSchemas["localFolderPickerHelperErrorCodeSchema"]
>;
export type LocalFolderPickerHelperResult = z.infer<
  LocalFolderPickerSchemas["localFolderPickerHelperResultSchema"]
>;
export type LocalFolderPickerHelperProtocolResult = z.infer<
  LocalFolderPickerSchemas["localFolderPickerHelperProtocolResultSchema"]
>;
export type LocalFolderPickerResult = z.infer<
  LocalFolderPickerSchemas["localFolderPickerResultSchema"]
>;
export type LocalFolderPickerRpcInput = z.infer<
  LocalFolderPickerSchemas["localFolderPickerRpcInputSchema"]
>;
export type LocalFolderPickerDaemonFrame = z.infer<
  LocalFolderPickerSchemas["localFolderPickerDaemonFrameSchema"]
>;
export type RuntimeTransportLocalFolderPickerRequest = z.infer<
  LocalFolderPickerSchemas["runtimeTransportLocalFolderPickerRequestSchema"]
>;
