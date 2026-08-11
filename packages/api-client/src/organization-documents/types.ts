import type {
  ApproveOrganizationDocumentDraftBody,
  ApproveOrganizationDocumentDraftResponse,
  CreateOrganizationDocumentBody,
  CreateOrganizationDocumentFolderBody,
  CreateOrganizationDocumentFolderResponse,
  CreateOrganizationDocumentResponse,
  DeleteOrganizationDocumentFolderResponse,
  DeleteOrganizationDocumentResponse,
  DiscardOrganizationDocumentDraftBody,
  DiscardOrganizationDocumentDraftResponse,
  GetCenterAgentMemberResearchStatusResponse,
  GetOrganizationDocumentResponse,
  ListOrganizationDocumentsResponse,
  OpenMeldRequestContext,
  StartCenterAgentMemberResearchBody,
  StartCenterAgentMemberResearchResponse,
  UpdateOrganizationDocumentBody,
  UpdateOrganizationDocumentFolderBody,
  UpdateOrganizationDocumentFolderResponse,
  UpdateOrganizationDocumentResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type OrganizationDocumentRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OrganizationDocumentsApi = {
  getMemberResearchStatus: (
    input?: OrganizationDocumentRequestInput
  ) => Promise<GetCenterAgentMemberResearchStatusResponse>;
  startMemberResearch: (
    input: OrganizationDocumentRequestInput & StartCenterAgentMemberResearchBody
  ) => Promise<StartCenterAgentMemberResearchResponse>;
  list: (
    input?: OrganizationDocumentRequestInput
  ) => Promise<ListOrganizationDocumentsResponse>;
  get: (
    input: OrganizationDocumentRequestInput & { documentId: string }
  ) => Promise<GetOrganizationDocumentResponse>;
  create: (
    input: OrganizationDocumentRequestInput & CreateOrganizationDocumentBody
  ) => Promise<CreateOrganizationDocumentResponse>;
  update: (
    input: OrganizationDocumentRequestInput &
      UpdateOrganizationDocumentBody & { documentId: string }
  ) => Promise<UpdateOrganizationDocumentResponse>;
  delete: (
    input: OrganizationDocumentRequestInput & {
      documentId: string;
      expectedOrganizationId: string;
    }
  ) => Promise<DeleteOrganizationDocumentResponse>;
  createFolder: (
    input: OrganizationDocumentRequestInput &
      CreateOrganizationDocumentFolderBody
  ) => Promise<CreateOrganizationDocumentFolderResponse>;
  updateFolder: (
    input: OrganizationDocumentRequestInput &
      UpdateOrganizationDocumentFolderBody & { folderId: string }
  ) => Promise<UpdateOrganizationDocumentFolderResponse>;
  deleteFolder: (
    input: OrganizationDocumentRequestInput & {
      expectedOrganizationId: string;
      folderId: string;
    }
  ) => Promise<DeleteOrganizationDocumentFolderResponse>;
  approveDraft: (
    input: OrganizationDocumentRequestInput &
      ApproveOrganizationDocumentDraftBody & { documentId: string }
  ) => Promise<ApproveOrganizationDocumentDraftResponse>;
  discardDraft: (
    input: OrganizationDocumentRequestInput &
      DiscardOrganizationDocumentDraftBody & { documentId: string }
  ) => Promise<DiscardOrganizationDocumentDraftResponse>;
};

export type CreateOrganizationDocumentsApi = (
  client: OpenMeldApiClientFoundation
) => OrganizationDocumentsApi;
