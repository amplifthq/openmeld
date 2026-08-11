import type { z } from "zod/v4";

type ProjectSchemas = typeof import("../../schemas/http/projects");

export type Project = z.infer<ProjectSchemas["projectSchema"]>;
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
