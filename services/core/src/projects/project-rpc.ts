import {
  archiveProjectResponseSchema,
  archiveProjectRpcInputSchema,
  createProjectResponseSchema,
  createProjectRpcInputSchema,
  listProjectsResponseSchema,
  listProjectsRpcInputSchema,
  updateProjectResponseSchema,
  updateProjectRpcInputSchema,
} from "@openmeld/schemas";
import type {
  ArchiveProjectResponse,
  ArchiveProjectRpcInput,
  CreateProjectResponse,
  CreateProjectRpcInput,
  ListProjectsResponse,
  ListProjectsRpcInput,
  UpdateProjectResponse,
  UpdateProjectRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import {
  prepareExpectedHumanProjectRequest,
  prepareHumanProjectRequest,
} from "./project-request-preparation";
import {
  parseProjectPayload,
  parseProjectResponse,
} from "./project-rpc-contract";

export async function rpcListProjects(
  env: CoreBindings,
  input: ListProjectsRpcInput
): Promise<ListProjectsResponse> {
  const request = parseProjectPayload(listProjectsRpcInputSchema, input);
  const { authority, service } = await prepareHumanProjectRequest(
    env,
    request.context
  );
  return parseProjectResponse(
    listProjectsResponseSchema,
    await service.list(authority)
  );
}

export async function rpcCreateProject(
  env: CoreBindings,
  input: CreateProjectRpcInput
): Promise<CreateProjectResponse> {
  const request = parseProjectPayload(createProjectRpcInputSchema, input);
  const { context, expectedOrganizationId, ...body } = request;
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context,
    expectedOrganizationId,
  });
  return parseProjectResponse(createProjectResponseSchema, {
    project: await service.create(authority, body),
  });
}

export async function rpcUpdateProject(
  env: CoreBindings,
  input: UpdateProjectRpcInput
): Promise<UpdateProjectResponse> {
  const request = parseProjectPayload(updateProjectRpcInputSchema, input);
  const { context, expectedOrganizationId, projectId, ...body } = request;
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context,
    expectedOrganizationId,
  });
  return parseProjectResponse(updateProjectResponseSchema, {
    project: await service.update(authority, projectId, body),
  });
}

export async function rpcArchiveProject(
  env: CoreBindings,
  input: ArchiveProjectRpcInput
): Promise<ArchiveProjectResponse> {
  const request = parseProjectPayload(archiveProjectRpcInputSchema, input);
  const { authority, service } = await prepareExpectedHumanProjectRequest(env, {
    context: request.context,
    expectedOrganizationId: request.expectedOrganizationId,
  });
  return parseProjectResponse(archiveProjectResponseSchema, {
    project: await service.archive(authority, request.projectId),
  });
}
