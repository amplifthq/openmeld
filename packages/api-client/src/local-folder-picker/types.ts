import type {
  LocalFolderPickerRequest,
  LocalFolderPickerResult,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type LocalFolderPickerRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SelectLocalFoldersInput = LocalFolderPickerRequestInput &
  LocalFolderPickerRequest;

export type LocalFolderPickerApi = {
  selectFolders: (
    input: SelectLocalFoldersInput
  ) => Promise<LocalFolderPickerResult>;
};

export type CreateLocalFolderPickerApi = (
  client: OpenMeldApiClientFoundation
) => LocalFolderPickerApi;
