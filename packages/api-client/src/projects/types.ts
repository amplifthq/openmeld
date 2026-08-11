import type {
  ArchiveProjectBody,
  ArchiveProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  ListProjectsResponse,
  OpenMeldRequestContext,
  UpdateProjectBody,
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

export type ProjectsApi = {
  list: (input?: ListProjectsInput) => Promise<ListProjectsResponse>;
  create: (input: CreateProjectInput) => Promise<CreateProjectResponse>;
  update: (input: UpdateProjectInput) => Promise<UpdateProjectResponse>;
  archive: (input: ArchiveProjectInput) => Promise<ArchiveProjectResponse>;
};

export type CreateProjectsApi = (
  client: OpenMeldApiClientFoundation
) => ProjectsApi;
