import {
  localFolderPickerRequestSchema,
  localFolderPickerResultSchema,
} from "@openmeld/schemas";
import { buildLocalFolderPickerPath } from "./routes";
import type {
  CreateLocalFolderPickerApi,
  LocalFolderPickerRequestInput,
} from "./types";

export const createLocalFolderPickerApi: CreateLocalFolderPickerApi = (
  client
) => ({
  selectFolders: async (input) => {
    const parsed = localFolderPickerRequestSchema.safeParse({
      allowMultiple: input.allowMultiple,
      expectedDeviceId: input.expectedDeviceId,
      purpose: input.purpose,
    });
    if (!parsed.success) {
      throw new Error(
        `Local Folder Picker request is invalid. ${parsed.error.issues[0]?.message ?? "Invalid input."}`
      );
    }
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(parsed.data),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Local Folder Picker response.",
      method: "POST",
      operation: "local-folder-picker.select-folders",
      schema: localFolderPickerResultSchema,
      url: buildLocalFolderPickerPath(),
    });
  },
});

function requestOptions(input: LocalFolderPickerRequestInput): {
  requestContext?: LocalFolderPickerRequestInput["requestContext"];
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
