import {
  archiveProjectBodySchema,
  archiveProjectResponseSchema,
  createProjectBodySchema,
  createProjectResponseSchema,
  listProjectsResponseSchema,
  projectRouteParamsSchema,
  readProjectCommonAgentsResponseSchema,
  readProjectIssueRoutingResponseSchema,
  readProjectRepositorySettingsResponseSchema,
  updateProjectBodySchema,
  updateProjectCommonAgentsBodySchema,
  updateProjectCommonAgentsResponseSchema,
  updateProjectIssueRoutingBodySchema,
  updateProjectIssueRoutingResponseSchema,
  updateProjectRepositorySettingsBodySchema,
  updateProjectRepositorySettingsResponseSchema,
  updateProjectResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildProjectCommonAgentsPath,
  buildProjectIssueRoutingPath,
  buildProjectPath,
  buildProjectRepositoriesPath,
  buildProjectsPath,
} from "./routes";
import type { CreateProjectsApi, ProjectRequestInput } from "./types";

export const createProjectsApi: CreateProjectsApi = (
  client: OpenMeldApiClientFoundation
) => ({
  list: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Project list response",
      method: "GET",
      operation: "project.list",
      schema: listProjectsResponseSchema,
      url: buildProjectsPath(),
    }),

  readIssueRouting: async (input) => {
    const projectId = requireProjectId(input.projectId);
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Project issue routing response",
      method: "GET",
      operation: "project.issue-routing.read",
      schema: readProjectIssueRoutingResponseSchema,
      url: buildProjectIssueRoutingPath(projectId),
    });
  },

  updateIssueRouting: async (input) => {
    const projectId = requireProjectId(input.projectId);
    const body = requireValidInput(
      updateProjectIssueRoutingBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        expectedRevision: input.expectedRevision,
        destination: input.destination,
      },
      "Project issue routing request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project issue routing update response",
      method: "PUT",
      operation: "project.issue-routing.update",
      schema: updateProjectIssueRoutingResponseSchema,
      url: buildProjectIssueRoutingPath(projectId),
    });
  },

  readRepositorySettings: async (input) => {
    const projectId = requireProjectId(input.projectId);
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Project repository settings response",
      method: "GET",
      operation: "project.repositories.read",
      schema: readProjectRepositorySettingsResponseSchema,
      url: buildProjectRepositoriesPath(projectId),
    });
  },

  updateRepositorySettings: async (input) => {
    const projectId = requireProjectId(input.projectId);
    const body = requireValidInput(
      updateProjectRepositorySettingsBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        expectedRevision: input.expectedRevision,
        repositoryUrls: input.repositoryUrls,
        defaultRepositoryUrl: input.defaultRepositoryUrl,
      },
      "Project repository settings request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project repository settings update response",
      method: "PUT",
      operation: "project.repositories.update",
      schema: updateProjectRepositorySettingsResponseSchema,
      url: buildProjectRepositoriesPath(projectId),
    });
  },

  readCommonAgents: async (input) => {
    const projectId = requireProjectId(input.projectId);
    return await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Project Common Agents response",
      method: "GET",
      operation: "project.common-agents.read",
      schema: readProjectCommonAgentsResponseSchema,
      url: buildProjectCommonAgentsPath(projectId),
    });
  },

  updateCommonAgents: async (input) => {
    const projectId = requireProjectId(input.projectId);
    const body = requireValidInput(
      updateProjectCommonAgentsBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        expectedRevision: input.expectedRevision,
        agentProfileIds: input.agentProfileIds,
      },
      "Project Common Agents request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project Common Agents update response",
      method: "PUT",
      operation: "project.common-agents.update",
      schema: updateProjectCommonAgentsResponseSchema,
      url: buildProjectCommonAgentsPath(projectId),
    });
  },

  create: async (input) => {
    const body = requireValidInput(
      createProjectBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        name: input.name,
        ...(input.operationId === undefined
          ? {}
          : { operationId: input.operationId }),
        ...(input.repositoryFingerprint === undefined
          ? {}
          : { repositoryFingerprint: input.repositoryFingerprint }),
        ...(input.repositoryUrl === undefined
          ? {}
          : { repositoryUrl: input.repositoryUrl }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
      },
      "Project create request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project create response",
      method: "POST",
      operation: "project.create",
      schema: createProjectResponseSchema,
      url: buildProjectsPath(),
    });
  },

  update: async (input) => {
    const projectId = requireProjectId(input.projectId);
    const body = requireValidInput(
      updateProjectBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.repositoryFingerprint === undefined
          ? {}
          : { repositoryFingerprint: input.repositoryFingerprint }),
        ...(input.repositoryUrl === undefined
          ? {}
          : { repositoryUrl: input.repositoryUrl }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
      },
      "Project update request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project update response",
      method: "PATCH",
      operation: "project.update",
      schema: updateProjectResponseSchema,
      url: buildProjectPath(projectId),
    });
  },

  archive: async (input) => {
    const projectId = requireProjectId(input.projectId);
    const body = requireValidInput(
      archiveProjectBodySchema,
      { expectedOrganizationId: input.expectedOrganizationId },
      "Project archive request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Project archive response",
      method: "DELETE",
      operation: "project.archive",
      schema: archiveProjectResponseSchema,
      url: buildProjectPath(projectId),
    });
  },
});

function requireProjectId(value: string): string {
  return requireValidInput(
    projectRouteParamsSchema,
    { projectId: value },
    "Project identifier is invalid."
  ).projectId;
}

function requestOptions(input: ProjectRequestInput): {
  requestContext?: ProjectRequestInput["requestContext"];
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

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
