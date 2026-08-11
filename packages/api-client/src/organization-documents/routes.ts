const DOCUMENTS_PATH = "/v1/organizations/current/documents";
const MEMBER_RESEARCH_PATH = "/v1/organizations/current/member-research";

export function buildOrganizationDocumentsPath(): string {
  return DOCUMENTS_PATH;
}

export function buildCenterAgentMemberResearchPath(): string {
  return MEMBER_RESEARCH_PATH;
}

export function buildOrganizationDocumentPath(documentId: string): string {
  return `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`;
}

export function buildOrganizationDocumentFoldersPath(): string {
  return `${DOCUMENTS_PATH}/folders`;
}

export function buildOrganizationDocumentFolderPath(folderId: string): string {
  return `${DOCUMENTS_PATH}/folders/${encodeURIComponent(folderId)}`;
}

export function buildOrganizationDocumentApproveDraftPath(
  documentId: string
): string {
  return `${buildOrganizationDocumentPath(documentId)}/approve-draft`;
}

export function buildOrganizationDocumentDiscardDraftPath(
  documentId: string
): string {
  return `${buildOrganizationDocumentPath(documentId)}/discard-draft`;
}
