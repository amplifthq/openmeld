import { stat } from "node:fs/promises";
import { localFolderPickerHelperResultSchema } from "@openmeld/schemas";
import type {
  LocalFolderPickerHelperErrorCode,
  LocalFolderPickerHelperResult,
  LocalFolderPickerPurpose,
  LocalFolderPickerRequest,
  LocalFolderPickerResult,
} from "@openmeld/schemas/types";
export type RunLocalFolderPickerHelper = (input: {
  allowMultiple: boolean;
  purpose: LocalFolderPickerPurpose;
  signal: AbortSignal;
}) => Promise<LocalFolderPickerHelperResult>;

export type LocalFolderPickerService = {
  available: boolean;
  close: () => Promise<void>;
  selectFolders: (
    request: LocalFolderPickerRequest
  ) => Promise<LocalFolderPickerResult>;
};

export function createLocalFolderPickerService(input: {
  deviceId: string;
  runHelper: RunLocalFolderPickerHelper | null;
}): LocalFolderPickerService {
  let pickerOpen = false;
  let activeAbortController: AbortController | null = null;
  let activePickerClosed: PromiseWithResolvers<void> | null = null;

  return {
    available: input.runHelper !== null,
    close: async () => {
      const pickerClosed = activePickerClosed;
      activeAbortController?.abort();
      await pickerClosed?.promise;
    },
    selectFolders: async (request) => {
      if (!input.runHelper) {
        return {
          code: "local.folder_picker.helper_missing",
          message:
            "Update or repair OpenMeld Service to choose folders on this computer.",
          status: "unavailable",
        };
      }
      if (pickerOpen) {
        return {
          code: "local.folder_picker.picker_busy",
          message:
            "A folder picker is already open on this computer. Finish or close it, then try again.",
          status: "unavailable",
        };
      }

      pickerOpen = true;
      const abortController = new AbortController();
      const pickerClosed = Promise.withResolvers<void>();
      activeAbortController = abortController;
      activePickerClosed = pickerClosed;
      try {
        const helperResult = localFolderPickerHelperResultSchema.safeParse(
          await input.runHelper({
            allowMultiple: request.allowMultiple,
            purpose: request.purpose,
            signal: abortController.signal,
          })
        );
        if (!helperResult.success) {
          return invalidResponse();
        }
        if (helperResult.data.status === "selected") {
          if (!(await areExistingDirectories(helperResult.data.paths))) {
            return invalidResponse();
          }
          return {
            deviceId: input.deviceId,
            paths: helperResult.data.paths,
            status: "selected",
          };
        }
        if (helperResult.data.status === "cancelled") {
          return { deviceId: input.deviceId, status: "cancelled" };
        }
        return unavailableResult(helperResult.data.code);
      } catch {
        return {
          code: "local.folder_picker.internal_error",
          message: "OpenMeld couldn’t open the folder picker. Try again.",
          status: "unavailable",
        };
      } finally {
        pickerOpen = false;
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        if (activePickerClosed === pickerClosed) {
          activePickerClosed = null;
        }
        pickerClosed.resolve();
      }
    },
  };
}

async function areExistingDirectories(
  paths: readonly string[]
): Promise<boolean> {
  try {
    const stats = await Promise.all(
      paths.map(async (path) => await stat(path))
    );
    return stats.every((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function unavailableResult(
  code: LocalFolderPickerHelperErrorCode
): LocalFolderPickerResult {
  const messages: Record<LocalFolderPickerHelperErrorCode, string> = {
    "local.folder_picker.internal_error":
      "OpenMeld couldn’t open the folder picker. Try again.",
    "local.folder_picker.invalid_response":
      "OpenMeld received an invalid response from the folder picker.",
    "local.folder_picker.no_interactive_session":
      "Sign in to this computer to choose a folder.",
    "local.folder_picker.portal_unavailable":
      "A desktop folder picker isn’t available in this Linux session.",
    "local.folder_picker.timed_out":
      "The folder picker closed because it was open too long.",
    "local.folder_picker.unsupported_platform":
      "OpenMeld can’t open a folder picker on this computer.",
  };
  return { code, message: messages[code], status: "unavailable" };
}

function invalidResponse(): LocalFolderPickerResult {
  return {
    code: "local.folder_picker.invalid_response",
    message: "OpenMeld received an invalid response from the folder picker.",
    status: "unavailable",
  };
}
