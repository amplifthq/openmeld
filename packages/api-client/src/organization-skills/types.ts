import type {
  BeginOrganizationSkillImportBatchBody,
  BeginOrganizationSkillImportBatchResponse,
  CreateOrganizationSkillBody,
  CreateOrganizationSkillResponse,
  DeleteOrganizationSkillBody,
  DeleteOrganizationSkillResponse,
  GetOrganizationSkillImportBatchResponse,
  GetOrganizationSkillResponse,
  ImportOrganizationSkillFromFilesBody,
  ImportOrganizationSkillFromFilesResponse,
  ImportOrganizationSkillFromGitHubBody,
  ImportOrganizationSkillFromGitHubResponse,
  ListOrganizationSkillImportBatchesResponse,
  ListOrganizationSkillsResponse,
  OpenMeldRequestContext,
  PreviewOrganizationSkillFromFilesBody,
  PreviewOrganizationSkillFromFilesResponse,
  PreviewOrganizationSkillFromGitHubBody,
  PreviewOrganizationSkillFromGitHubResponse,
  PreviewOrganizationSkillRepositoryBody,
  PreviewOrganizationSkillRepositoryResponse,
  SetOrganizationSkillEnabledBody,
  SetOrganizationSkillEnabledResponse,
  SetOrganizationSkillMaintainersBody,
  SetOrganizationSkillMaintainersResponse,
  UpdateOrganizationSkillBody,
  UpdateOrganizationSkillResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationSkillRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type OrganizationSkillMutationTarget = {
  skillId: string;
};

export type OrganizationSkillsApi = {
  beginImportBatch: (
    input: OrganizationSkillRequestInput & BeginOrganizationSkillImportBatchBody
  ) => Promise<BeginOrganizationSkillImportBatchResponse>;
  getImportBatch: (
    input: OrganizationSkillRequestInput & { batchId: string }
  ) => Promise<GetOrganizationSkillImportBatchResponse>;
  listImportBatches: (
    input?: OrganizationSkillRequestInput
  ) => Promise<ListOrganizationSkillImportBatchesResponse>;
  list: (
    input?: OrganizationSkillRequestInput
  ) => Promise<ListOrganizationSkillsResponse>;
  get: (
    input: OrganizationSkillRequestInput &
      OrganizationSkillMutationTarget & { releaseId?: string }
  ) => Promise<GetOrganizationSkillResponse>;
  create: (
    input: OrganizationSkillRequestInput & CreateOrganizationSkillBody
  ) => Promise<CreateOrganizationSkillResponse>;
  importFromGitHub: (
    input: OrganizationSkillRequestInput & ImportOrganizationSkillFromGitHubBody
  ) => Promise<ImportOrganizationSkillFromGitHubResponse>;
  importFromFiles: (
    input: OrganizationSkillRequestInput & ImportOrganizationSkillFromFilesBody
  ) => Promise<ImportOrganizationSkillFromFilesResponse>;
  previewFromFiles: (
    input: OrganizationSkillRequestInput & PreviewOrganizationSkillFromFilesBody
  ) => Promise<PreviewOrganizationSkillFromFilesResponse>;
  previewFromGitHub: (
    input: OrganizationSkillRequestInput &
      PreviewOrganizationSkillFromGitHubBody
  ) => Promise<PreviewOrganizationSkillFromGitHubResponse>;
  previewRepositoryFromGitHub: (
    input: OrganizationSkillRequestInput &
      PreviewOrganizationSkillRepositoryBody
  ) => Promise<PreviewOrganizationSkillRepositoryResponse>;
  update: (
    input: OrganizationSkillRequestInput &
      OrganizationSkillMutationTarget &
      UpdateOrganizationSkillBody
  ) => Promise<UpdateOrganizationSkillResponse>;
  setEnabled: (
    input: OrganizationSkillRequestInput &
      OrganizationSkillMutationTarget &
      SetOrganizationSkillEnabledBody
  ) => Promise<SetOrganizationSkillEnabledResponse>;
  setMaintainers: (
    input: OrganizationSkillRequestInput &
      OrganizationSkillMutationTarget &
      SetOrganizationSkillMaintainersBody
  ) => Promise<SetOrganizationSkillMaintainersResponse>;
  delete: (
    input: OrganizationSkillRequestInput &
      OrganizationSkillMutationTarget &
      DeleteOrganizationSkillBody
  ) => Promise<DeleteOrganizationSkillResponse>;
};

export type CreateOrganizationSkillsApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationSkillsApi;
