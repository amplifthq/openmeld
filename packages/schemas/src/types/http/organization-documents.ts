import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/organization-documents");

export type OrganizationDocumentKind = z.infer<
  Schemas["organizationDocumentKindSchema"]
>;
export type ProfileReportType = z.infer<Schemas["profileReportTypeSchema"]>;
export type OrganizationDocumentSummary = z.infer<
  Schemas["organizationDocumentSummarySchema"]
>;
export type OrganizationDocumentFolder = z.infer<
  Schemas["organizationDocumentFolderSchema"]
>;
export type CreateOrganizationDocumentFolderBody = z.infer<
  Schemas["createOrganizationDocumentFolderBodySchema"]
>;
export type CreateOrganizationDocumentFolderResponse = z.infer<
  Schemas["createOrganizationDocumentFolderResponseSchema"]
>;
export type UpdateOrganizationDocumentFolderBody = z.infer<
  Schemas["updateOrganizationDocumentFolderBodySchema"]
>;
export type UpdateOrganizationDocumentFolderResponse = z.infer<
  Schemas["updateOrganizationDocumentFolderResponseSchema"]
>;
export type DeleteOrganizationDocumentFolderResponse = z.infer<
  Schemas["deleteOrganizationDocumentFolderResponseSchema"]
>;
export type CreateOrganizationDocumentFolderRpcInput = z.infer<
  Schemas["createOrganizationDocumentFolderRpcInputSchema"]
>;
export type UpdateOrganizationDocumentFolderRpcInput = z.infer<
  Schemas["updateOrganizationDocumentFolderRpcInputSchema"]
>;
export type DeleteOrganizationDocumentFolderRpcInput = z.infer<
  Schemas["deleteOrganizationDocumentFolderRpcInputSchema"]
>;
export type OrganizationDocument = z.infer<
  Schemas["organizationDocumentSchema"]
>;
export type ListOrganizationDocumentsResponse = z.infer<
  Schemas["listOrganizationDocumentsResponseSchema"]
>;
export type GetOrganizationDocumentResponse = z.infer<
  Schemas["getOrganizationDocumentResponseSchema"]
>;
export type CreateOrganizationDocumentBody = z.infer<
  Schemas["createOrganizationDocumentBodySchema"]
>;
export type CreateOrganizationDocumentResponse = z.infer<
  Schemas["createOrganizationDocumentResponseSchema"]
>;
export type UpdateOrganizationDocumentBody = z.infer<
  Schemas["updateOrganizationDocumentBodySchema"]
>;
export type UpdateOrganizationDocumentResponse = z.infer<
  Schemas["updateOrganizationDocumentResponseSchema"]
>;
export type DeleteOrganizationDocumentResponse = z.infer<
  Schemas["deleteOrganizationDocumentResponseSchema"]
>;
export type ApproveOrganizationDocumentDraftBody = z.infer<
  Schemas["approveOrganizationDocumentDraftBodySchema"]
>;
export type ApproveOrganizationDocumentDraftResponse = z.infer<
  Schemas["approveOrganizationDocumentDraftResponseSchema"]
>;
export type DiscardOrganizationDocumentDraftBody = z.infer<
  Schemas["discardOrganizationDocumentDraftBodySchema"]
>;
export type DiscardOrganizationDocumentDraftResponse = z.infer<
  Schemas["discardOrganizationDocumentDraftResponseSchema"]
>;
export type ListOrganizationDocumentsRpcInput = z.infer<
  Schemas["listOrganizationDocumentsRpcInputSchema"]
>;
export type GetOrganizationDocumentRpcInput = z.infer<
  Schemas["getOrganizationDocumentRpcInputSchema"]
>;
export type CreateOrganizationDocumentRpcInput = z.infer<
  Schemas["createOrganizationDocumentRpcInputSchema"]
>;
export type UpdateOrganizationDocumentRpcInput = z.infer<
  Schemas["updateOrganizationDocumentRpcInputSchema"]
>;
export type DeleteOrganizationDocumentRpcInput = z.infer<
  Schemas["deleteOrganizationDocumentRpcInputSchema"]
>;
export type ApproveOrganizationDocumentDraftRpcInput = z.infer<
  Schemas["approveOrganizationDocumentDraftRpcInputSchema"]
>;
export type DiscardOrganizationDocumentDraftRpcInput = z.infer<
  Schemas["discardOrganizationDocumentDraftRpcInputSchema"]
>;
export type CenterAgentReadOrganizationDocumentsRpcInput = z.infer<
  Schemas["centerAgentReadOrganizationDocumentsRpcInputSchema"]
>;
export type CenterAgentReadOrganizationDocumentsResponse = z.infer<
  Schemas["centerAgentReadOrganizationDocumentsResponseSchema"]
>;
export type CenterAgentOrganizationDocumentsComputerSnapshotRpcInput = z.infer<
  Schemas["centerAgentOrganizationDocumentsComputerSnapshotRpcInputSchema"]
>;
export type CenterAgentOrganizationDocumentsComputerSnapshotResponse = z.infer<
  Schemas["centerAgentOrganizationDocumentsComputerSnapshotResponseSchema"]
>;
export type CenterAgentDraftOrganizationDocumentRpcInput = z.infer<
  Schemas["centerAgentDraftOrganizationDocumentRpcInputSchema"]
>;
export type CenterAgentDraftOrganizationDocumentResponse = z.infer<
  Schemas["centerAgentDraftOrganizationDocumentResponseSchema"]
>;
export type RecordCenterAgentMemberResearchComputerFileRpcInput = z.infer<
  Schemas["recordCenterAgentMemberResearchComputerFileRpcInputSchema"]
>;
export type RecordCenterAgentMemberResearchComputerFileResponse = z.infer<
  Schemas["recordCenterAgentMemberResearchComputerFileResponseSchema"]
>;
export type CenterAgentManageOrganizationDocumentsRpcInput = z.infer<
  Schemas["centerAgentManageOrganizationDocumentsRpcInputSchema"]
>;
export type CenterAgentManageOrganizationDocumentsResponse = z.infer<
  Schemas["centerAgentManageOrganizationDocumentsResponseSchema"]
>;
export type OrganizationDocumentPromptContextRpcInput = z.infer<
  Schemas["organizationDocumentPromptContextRpcInputSchema"]
>;
export type OrganizationDocumentPromptContextResponse = z.infer<
  Schemas["organizationDocumentPromptContextResponseSchema"]
>;
export type OrganizationDocumentSourceReference = z.infer<
  Schemas["organizationDocumentSourceReferenceSchema"]
>;
