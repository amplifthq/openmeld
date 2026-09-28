import type {
  ArchiveProjectBody,
  ArchiveProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  ListProjectsResponse,
  OpenMeldRequestContext,
  ReadProjectCommonAgentsResponse,
  ReadProjectIssueRoutingResponse,
  ReadProjectRepositorySettingsResponse,
  UpdateProjectBody,
  UpdateProjectCommonAgentsBody,
  UpdateProjectCommonAgentsResponse,
  UpdateProjectIssueRoutingBody,
  UpdateProjectIssueRoutingResponse,
  UpdateProjectRepositorySettingsBody,
  UpdateProjectRepositorySettingsResponse,
  UpdateProjectResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type ProjectRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ListProjectsInput = ProjectRequestInput;
export type CreateProjectInput = ProjectRequestInput & CreateProjectBody;
export type UpdateProjectInput = ProjectRequestInput &
  UpdateProjectBody & { projectId: string };
export type ArchiveProjectInput = ProjectRequestInput &
  ArchiveProjectBody & { projectId: string };
export type ReadProjectIssueRoutingInput = ProjectRequestInput & {
  projectId: string;
};
export type UpdateProjectIssueRoutingInput = ProjectRequestInput &
  UpdateProjectIssueRoutingBody & { projectId: string };
export type ReadProjectRepositorySettingsInput = ProjectRequestInput & {
  projectId: string;
};
export type UpdateProjectRepositorySettingsInput = ProjectRequestInput &
  UpdateProjectRepositorySettingsBody & { projectId: string };
export type ReadProjectCommonAgentsInput = ProjectRequestInput & {
  projectId: string;
};
export type UpdateProjectCommonAgentsInput = ProjectRequestInput &
  UpdateProjectCommonAgentsBody & { projectId: string };

export type ProjectsApi = {
  list: (input?: ListProjectsInput) => Promise<ListProjectsResponse>;
  create: (input: CreateProjectInput) => Promise<CreateProjectResponse>;
  update: (input: UpdateProjectInput) => Promise<UpdateProjectResponse>;
  archive: (input: ArchiveProjectInput) => Promise<ArchiveProjectResponse>;
  readIssueRouting: (
    input: ReadProjectIssueRoutingInput
  ) => Promise<ReadProjectIssueRoutingResponse>;
  updateIssueRouting: (
    input: UpdateProjectIssueRoutingInput
  ) => Promise<UpdateProjectIssueRoutingResponse>;
  readRepositorySettings: (
    input: ReadProjectRepositorySettingsInput
  ) => Promise<ReadProjectRepositorySettingsResponse>;
  updateRepositorySettings: (
    input: UpdateProjectRepositorySettingsInput
  ) => Promise<UpdateProjectRepositorySettingsResponse>;
  readCommonAgents: (
    input: ReadProjectCommonAgentsInput
  ) => Promise<ReadProjectCommonAgentsResponse>;
  updateCommonAgents: (
    input: UpdateProjectCommonAgentsInput
  ) => Promise<UpdateProjectCommonAgentsResponse>;
};

export type CreateProjectsApi = (
  client: OpenMeldApiClientFoundation
) => ProjectsApi;
