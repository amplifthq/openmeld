import type { z } from "zod/v4";

type ProjectSchemas = typeof import("../../schemas/http/projects");

export type Project = z.infer<ProjectSchemas["projectSchema"]>;
export type ProjectIssueDestination = z.infer<
  ProjectSchemas["projectIssueDestinationSchema"]
>;
export type ProjectIssueRouting = z.infer<
  ProjectSchemas["projectIssueRoutingSchema"]
>;
export type ProjectRepositorySettings = z.infer<
  ProjectSchemas["projectRepositorySettingsSchema"]
>;
export type ProjectCommonAgents = z.infer<
  ProjectSchemas["projectCommonAgentsSchema"]
>;
export type ReadProjectRepositorySettingsResponse = z.infer<
  ProjectSchemas["readProjectRepositorySettingsResponseSchema"]
>;
export type ReadProjectRepositorySettingsRpcInput = z.infer<
  ProjectSchemas["readProjectRepositorySettingsRpcInputSchema"]
>;
export type UpdateProjectRepositorySettingsBody = z.infer<
  ProjectSchemas["updateProjectRepositorySettingsBodySchema"]
>;
export type UpdateProjectRepositorySettingsResponse = z.infer<
  ProjectSchemas["updateProjectRepositorySettingsResponseSchema"]
>;
export type UpdateProjectRepositorySettingsRpcInput = z.infer<
  ProjectSchemas["updateProjectRepositorySettingsRpcInputSchema"]
>;
export type ReadProjectCommonAgentsResponse = z.infer<
  ProjectSchemas["readProjectCommonAgentsResponseSchema"]
>;
export type ReadProjectCommonAgentsRpcInput = z.infer<
  ProjectSchemas["readProjectCommonAgentsRpcInputSchema"]
>;
export type ReadProjectRecentTasksResponse = z.infer<
  ProjectSchemas["readProjectRecentTasksResponseSchema"]
>;
export type ReadProjectRecentTasksRpcInput = z.infer<
  ProjectSchemas["readProjectRecentTasksRpcInputSchema"]
>;
export type UpdateProjectCommonAgentsBody = z.infer<
  ProjectSchemas["updateProjectCommonAgentsBodySchema"]
>;
export type UpdateProjectCommonAgentsResponse = z.infer<
  ProjectSchemas["updateProjectCommonAgentsResponseSchema"]
>;
export type UpdateProjectCommonAgentsRpcInput = z.infer<
  ProjectSchemas["updateProjectCommonAgentsRpcInputSchema"]
>;
export type ReadProjectIssueRoutingResponse = z.infer<
  ProjectSchemas["readProjectIssueRoutingResponseSchema"]
>;
export type ReadProjectIssueRoutingRpcInput = z.infer<
  ProjectSchemas["readProjectIssueRoutingRpcInputSchema"]
>;
export type ResolveProjectIssueActionRpcInput = z.infer<
  ProjectSchemas["resolveProjectIssueActionRpcInputSchema"]
>;
export type ResolveProjectIssueActionResponse = z.infer<
  ProjectSchemas["resolveProjectIssueActionResponseSchema"]
>;
export type UpdateProjectIssueRoutingBody = z.infer<
  ProjectSchemas["updateProjectIssueRoutingBodySchema"]
>;
export type UpdateProjectIssueRoutingResponse = z.infer<
  ProjectSchemas["updateProjectIssueRoutingResponseSchema"]
>;
export type UpdateProjectIssueRoutingRpcInput = z.infer<
  ProjectSchemas["updateProjectIssueRoutingRpcInputSchema"]
>;
export type RepositoryFingerprint = z.infer<
  ProjectSchemas["repositoryFingerprintSchema"]
>;
export type RepositoryUrl = z.infer<ProjectSchemas["repositoryUrlSchema"]>;
export type ProjectSlug = z.infer<ProjectSchemas["projectSlugSchema"]>;
export type ProjectRouteParams = z.infer<
  ProjectSchemas["projectRouteParamsSchema"]
>;
export type ArchiveProjectBody = z.infer<
  ProjectSchemas["archiveProjectBodySchema"]
>;
export type ArchiveProjectResponse = z.infer<
  ProjectSchemas["archiveProjectResponseSchema"]
>;
export type ArchiveProjectRpcInput = z.infer<
  ProjectSchemas["archiveProjectRpcInputSchema"]
>;
export type CreateProjectBody = z.infer<
  ProjectSchemas["createProjectBodySchema"]
>;
export type CreateProjectResponse = z.infer<
  ProjectSchemas["createProjectResponseSchema"]
>;
export type CreateProjectRpcInput = z.infer<
  ProjectSchemas["createProjectRpcInputSchema"]
>;
export type ListProjectsQuery = z.infer<
  ProjectSchemas["listProjectsQuerySchema"]
>;
export type ListProjectsResponse = z.infer<
  ProjectSchemas["listProjectsResponseSchema"]
>;
export type ListProjectsRpcInput = z.infer<
  ProjectSchemas["listProjectsRpcInputSchema"]
>;
export type UpdateProjectBody = z.infer<
  ProjectSchemas["updateProjectBodySchema"]
>;
export type UpdateProjectResponse = z.infer<
  ProjectSchemas["updateProjectResponseSchema"]
>;
export type UpdateProjectRpcInput = z.infer<
  ProjectSchemas["updateProjectRpcInputSchema"]
>;
