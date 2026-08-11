import type {
  CreateOrganizationSkillBody,
  CreateOrganizationSkillResponse,
  DeleteOrganizationSkillBody,
  DeleteOrganizationSkillResponse,
  GetOrganizationSkillResponse,
  ImportOrganizationSkillFromGitHubBody,
  ImportOrganizationSkillFromGitHubResponse,
  ListOrganizationSkillsResponse,
  OpenMeldRequestContext,
  PreviewOrganizationSkillFromGitHubBody,
  PreviewOrganizationSkillFromGitHubResponse,
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
  list: (
    input?: OrganizationSkillRequestInput
  ) => Promise<ListOrganizationSkillsResponse>;
  get: (
    input: OrganizationSkillRequestInput & OrganizationSkillMutationTarget
  ) => Promise<GetOrganizationSkillResponse>;
  create: (
    input: OrganizationSkillRequestInput & CreateOrganizationSkillBody
  ) => Promise<CreateOrganizationSkillResponse>;
  importFromGitHub: (
    input: OrganizationSkillRequestInput & ImportOrganizationSkillFromGitHubBody
  ) => Promise<ImportOrganizationSkillFromGitHubResponse>;
  previewFromGitHub: (
    input: OrganizationSkillRequestInput &
      PreviewOrganizationSkillFromGitHubBody
  ) => Promise<PreviewOrganizationSkillFromGitHubResponse>;
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
