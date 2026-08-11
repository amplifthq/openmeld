import { localFolderPickerDaemonFrameSchema } from "@openmeld/schemas";
import type {
  LocalFolderPickerDaemonFrame,
  LocalFolderPickerRequest,
  LocalFolderPickerResult,
} from "@openmeld/schemas/types";

type RequestFrame = Extract<
  LocalFolderPickerDaemonFrame,
  { code: "daemon.local_folder_picker.select_folders" }
>;

type ResultFrame = Extract<
  LocalFolderPickerDaemonFrame,
  { code: "daemon.local_folder_picker.select_folders_result" }
>;

export type SelectLocalFolders = (
  request: LocalFolderPickerRequest
) => Promise<LocalFolderPickerResult>;

export async function handleLocalFolderPickerFrame(input: {
  deviceId: string;
  frame: RequestFrame;
  selectFolders: SelectLocalFolders;
}): Promise<ResultFrame> {
  const request = input.frame.payload.request;
  if (request.expectedDeviceId !== input.deviceId) {
    return buildResultFrame(input.frame, {
      code: "local.folder_picker.device_mismatch",
      message:
        "This folder request targeted a different Computer. Refresh Computers and try again.",
      status: "unavailable",
    });
  }

  try {
    return buildResultFrame(input.frame, await input.selectFolders(request));
  } catch {
    return buildResultFrame(input.frame, {
      code: "local.folder_picker.internal_error",
      message: "OpenMeld couldn’t open the folder picker. Try again.",
      status: "unavailable",
    });
  }
}

function buildResultFrame(
  frame: RequestFrame,
  result: LocalFolderPickerResult
): ResultFrame {
  return localFolderPickerDaemonFrameSchema.parse({
    code: "daemon.local_folder_picker.select_folders_result",
    payload: { requestId: frame.payload.requestId, result },
    v: 1,
  }) as ResultFrame;
}
