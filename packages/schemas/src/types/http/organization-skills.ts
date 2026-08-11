import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/organization-skills");

export type OrganizationSkillSource = z.infer<
  Schemas["organizationSkillSourceSchema"]
>;
export type OrganizationSkillGitHubSource = z.infer<
  Schemas["organizationSkillGitHubSourceSchema"]
>;
export type OrganizationSkillPortableMetadata = z.infer<
  Schemas["organizationSkillPortableMetadataSchema"]
>;
export type OrganizationSkillFile = z.infer<
  Schemas["organizationSkillFileSchema"]
>;
export type OrganizationSkillBundle = z.infer<
  Schemas["organizationSkillBundleSchema"]
>;
export type OrganizationSkillReleaseSummary = z.infer<
  Schemas["organizationSkillReleaseSummarySchema"]
>;
export type OrganizationSkillSummary = z.infer<
  Schemas["organizationSkillSummarySchema"]
>;
export type OrganizationSkill = z.infer<Schemas["organizationSkillSchema"]>;
export type ListOrganizationSkillsResponse = z.infer<
  Schemas["listOrganizationSkillsResponseSchema"]
>;
export type GetOrganizationSkillResponse = z.infer<
  Schemas["getOrganizationSkillResponseSchema"]
>;
export type CreateOrganizationSkillBody = z.infer<
  Schemas["createOrganizationSkillBodySchema"]
>;
export type CreateOrganizationSkillResponse = z.infer<
  Schemas["createOrganizationSkillResponseSchema"]
>;
export type UpdateOrganizationSkillBody = z.infer<
  Schemas["updateOrganizationSkillBodySchema"]
>;
export type UpdateOrganizationSkillResponse = z.infer<
  Schemas["updateOrganizationSkillResponseSchema"]
>;
export type SetOrganizationSkillEnabledBody = z.infer<
  Schemas["setOrganizationSkillEnabledBodySchema"]
>;
export type SetOrganizationSkillEnabledResponse = z.infer<
  Schemas["setOrganizationSkillEnabledResponseSchema"]
>;
export type SetOrganizationSkillMaintainersBody = z.infer<
  Schemas["setOrganizationSkillMaintainersBodySchema"]
>;
export type SetOrganizationSkillMaintainersResponse = z.infer<
  Schemas["setOrganizationSkillMaintainersResponseSchema"]
>;
export type DeleteOrganizationSkillBody = z.infer<
  Schemas["deleteOrganizationSkillBodySchema"]
>;
export type DeleteOrganizationSkillResponse = z.infer<
  Schemas["deleteOrganizationSkillResponseSchema"]
>;
export type ImportOrganizationSkillFromGitHubBody = z.infer<
  Schemas["importOrganizationSkillFromGitHubBodySchema"]
>;
export type ImportOrganizationSkillFromGitHubResponse = z.infer<
  Schemas["importOrganizationSkillFromGitHubResponseSchema"]
>;
export type PreviewOrganizationSkillFromGitHubBody = z.infer<
  Schemas["previewOrganizationSkillFromGitHubBodySchema"]
>;
export type OrganizationSkillGitHubPreview = z.infer<
  Schemas["organizationSkillGitHubPreviewSchema"]
>;
export type PreviewOrganizationSkillFromGitHubResponse = z.infer<
  Schemas["previewOrganizationSkillFromGitHubResponseSchema"]
>;
export type CenterAgentReadOrganizationSkillsRpcInput = z.infer<
  Schemas["centerAgentReadOrganizationSkillsRpcInputSchema"]
>;
export type CenterAgentReadOrganizationSkillsResponse = z.infer<
  Schemas["centerAgentReadOrganizationSkillsResponseSchema"]
>;
export type CenterAgentInstallOrganizationSkillRpcInput = z.infer<
  Schemas["centerAgentInstallOrganizationSkillRpcInputSchema"]
>;
export type CenterAgentInstallOrganizationSkillResponse = z.infer<
  Schemas["centerAgentInstallOrganizationSkillResponseSchema"]
>;
export type OrganizationSkillRuntimeRelease = z.infer<
  Schemas["organizationSkillRuntimeReleaseSchema"]
>;
export type OrganizationSkillRuntimeReleaseSelection = z.infer<
  Schemas["organizationSkillRuntimeReleaseSelectionSchema"]
>;
export type OrganizationSkillRuntimeSnapshotResponse = z.infer<
  Schemas["organizationSkillRuntimeSnapshotResponseSchema"]
>;
export type ListOrganizationSkillsRpcInput = z.infer<
  Schemas["listOrganizationSkillsRpcInputSchema"]
>;
export type GetOrganizationSkillRpcInput = z.infer<
  Schemas["getOrganizationSkillRpcInputSchema"]
>;
export type CreateOrganizationSkillRpcInput = z.infer<
  Schemas["createOrganizationSkillRpcInputSchema"]
>;
export type UpdateOrganizationSkillRpcInput = z.infer<
  Schemas["updateOrganizationSkillRpcInputSchema"]
>;
export type SetOrganizationSkillEnabledRpcInput = z.infer<
  Schemas["setOrganizationSkillEnabledRpcInputSchema"]
>;
export type SetOrganizationSkillMaintainersRpcInput = z.infer<
  Schemas["setOrganizationSkillMaintainersRpcInputSchema"]
>;
export type DeleteOrganizationSkillRpcInput = z.infer<
  Schemas["deleteOrganizationSkillRpcInputSchema"]
>;
export type ImportOrganizationSkillFromGitHubRpcInput = z.infer<
  Schemas["importOrganizationSkillFromGitHubRpcInputSchema"]
>;
export type PreviewOrganizationSkillFromGitHubRpcInput = z.infer<
  Schemas["previewOrganizationSkillFromGitHubRpcInputSchema"]
>;
export type ReadOrganizationSkillRuntimeSnapshotRpcInput = z.infer<
  Schemas["readOrganizationSkillRuntimeSnapshotRpcInputSchema"]
>;
export type RecordOrganizationSkillActivationRpcInput = z.infer<
  Schemas["recordOrganizationSkillActivationRpcInputSchema"]
>;
export type RecordOrganizationSkillActivationResponse = z.infer<
  Schemas["recordOrganizationSkillActivationResponseSchema"]
>;
