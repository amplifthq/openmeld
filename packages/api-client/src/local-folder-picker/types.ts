import type {
  LocalFolderPickerRequest,
  LocalFolderPickerResult,
  OpenMeldRequestContext,
  PeopleComputerFolderPickerBody,
  PeopleComputerTarget,
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
  selectPeopleComputerFolders: (
    input: LocalFolderPickerRequestInput &
      PeopleComputerTarget &
      PeopleComputerFolderPickerBody
  ) => Promise<LocalFolderPickerResult>;
  selectFolders: (
    input: SelectLocalFoldersInput
  ) => Promise<LocalFolderPickerResult>;
};

export type CreateLocalFolderPickerApi = (
  client: OpenMeldApiClientFoundation
) => LocalFolderPickerApi;
