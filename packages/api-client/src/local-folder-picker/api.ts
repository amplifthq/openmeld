import {
  localFolderPickerRequestSchema,
  localFolderPickerResultSchema,
  peopleComputerFolderPickerBodySchema,
  peopleComputerTargetSchema,
} from "@openmeld/schemas";
import { buildLocalFolderPickerPath } from "./routes";
import type {
  CreateLocalFolderPickerApi,
  LocalFolderPickerRequestInput,
} from "./types";

export const createLocalFolderPickerApi: CreateLocalFolderPickerApi = (
  client
) => ({
  selectPeopleComputerFolders: async (input) => {
    const target = peopleComputerTargetSchema.safeParse({
      deviceId: input.deviceId,
      runtimeLane: input.runtimeLane,
    });
    const body = peopleComputerFolderPickerBodySchema.safeParse({
      allowMultiple: input.allowMultiple,
      purpose: input.purpose,
    });
    if (!(target.success && body.success)) {
      throw new Error("Invalid computer folder picker request.");
    }
    return await client.requestJson({
      ...requestOptions(input),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
      operation: "people-computer.select-folders",
      schema: localFolderPickerResultSchema,
      invalidMessage: "Invalid Local Folder Picker response.",
      url: `/v1/people-computers/${encodeURIComponent(target.data.deviceId)}/lanes/${encodeURIComponent(target.data.runtimeLane)}/folders/select`,
    });
  },
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
