import {
	createOrganizationDocumentsApi,
	type OrganizationDocumentRequestInput,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT } from "@openmeld/schemas";
import type {
	ApproveOrganizationDocumentDraftBody,
	CreateOrganizationDocumentBody,
	CreateOrganizationDocumentFolderBody,
	CreateOrganizationDocumentFolderResponse,
	CreateOrganizationDocumentResponse,
	DeleteOrganizationDocumentFolderResponse,
	DeleteOrganizationDocumentResponse,
	DiscardOrganizationDocumentDraftBody,
	GetCenterAgentMemberResearchStatusResponse,
	GetOrganizationDocumentResponse,
	ListOrganizationDocumentsResponse,
	StartCenterAgentMemberResearchBody,
	StartCenterAgentMemberResearchResponse,
	UpdateOrganizationDocumentBody,
	UpdateOrganizationDocumentFolderBody,
	UpdateOrganizationDocumentFolderResponse,
	UpdateOrganizationDocumentResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationDocumentFailure = StructuredApiClientFailure;

function createWebOrganizationDocumentsApi(organizationId: string) {
	return createOrganizationDocumentsApi(
		createWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function listCurrentOrganizationDocuments(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListOrganizationDocumentsResponse> {
	try {
		const response = await createWebOrganizationDocumentsApi(
			input.organizationId
		).list({
			signal: input.signal,
		});
		if (response.organizationId !== input.organizationId) {
			throw new Error("Organization document response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getCurrentCenterAgentMemberResearchStatus(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<GetCenterAgentMemberResearchStatusResponse> {
	try {
		const response = await createWebOrganizationDocumentsApi(
			input.organizationId
		).getMemberResearchStatus({
			signal: input.signal,
		});
		if (response.organizationId !== input.organizationId) {
			throw new Error("Member research response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function startCurrentCenterAgentMemberResearch(
	input: OrganizationDocumentRequestInput & StartCenterAgentMemberResearchBody
): Promise<StartCenterAgentMemberResearchResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).startMemberResearch(input)
	);
}

export async function getCurrentOrganizationDocument(
	input: OrganizationDocumentRequestInput & {
		documentId: string;
		organizationId: string;
	}
): Promise<GetOrganizationDocumentResponse> {
	try {
		const response = await createWebOrganizationDocumentsApi(
			input.organizationId
		).get(input);
		if (response.document.organizationId !== input.organizationId) {
			throw new Error("Organization document response organization mismatch.");
		}
		return response;
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function createCurrentOrganizationDocument(
	input: OrganizationDocumentRequestInput & CreateOrganizationDocumentBody
): Promise<CreateOrganizationDocumentResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(input.expectedOrganizationId).create(
			input
		)
	);
}

export async function updateCurrentOrganizationDocument(
	input: OrganizationDocumentRequestInput &
		UpdateOrganizationDocumentBody & { documentId: string }
): Promise<UpdateOrganizationDocumentResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(input.expectedOrganizationId).update(
			input
		)
	);
}

export async function deleteCurrentOrganizationDocument(
	input: OrganizationDocumentRequestInput & {
		documentId: string;
		expectedOrganizationId: string;
	}
): Promise<DeleteOrganizationDocumentResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(input.expectedOrganizationId).delete(
			input
		)
	);
}

export async function createCurrentOrganizationDocumentFolder(
	input: OrganizationDocumentRequestInput & CreateOrganizationDocumentFolderBody
): Promise<CreateOrganizationDocumentFolderResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).createFolder(input)
	);
}

export async function renameCurrentOrganizationDocumentFolder(
	input: OrganizationDocumentRequestInput &
		UpdateOrganizationDocumentFolderBody & { folderId: string }
): Promise<UpdateOrganizationDocumentFolderResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).updateFolder(input)
	);
}

export async function moveCurrentOrganizationDocumentFolder(
	input: OrganizationDocumentRequestInput & {
		expectedOrganizationId: string;
		folderId: string;
		parentFolderId: string | null;
	}
): Promise<UpdateOrganizationDocumentFolderResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).updateFolder(input)
	);
}

export async function deleteCurrentOrganizationDocumentFolder(
	input: OrganizationDocumentRequestInput & {
		expectedOrganizationId: string;
		folderId: string;
	}
): Promise<DeleteOrganizationDocumentFolderResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).deleteFolder(input)
	);
}

export async function moveCurrentOrganizationDocument(
	input: OrganizationDocumentRequestInput & {
		documentId: string;
		expectedOrganizationId: string;
		folderId: string | null;
	}
): Promise<UpdateOrganizationDocumentResponse> {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(input.expectedOrganizationId).update(
			input
		)
	);
}

export async function approveCurrentOrganizationDocumentDraft(
	input: OrganizationDocumentRequestInput &
		ApproveOrganizationDocumentDraftBody & { documentId: string }
) {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).approveDraft(input)
	);
}

export async function discardCurrentOrganizationDocumentDraft(
	input: OrganizationDocumentRequestInput &
		DiscardOrganizationDocumentDraftBody & { documentId: string }
) {
	return await runMutation(() =>
		createWebOrganizationDocumentsApi(
			input.expectedOrganizationId
		).discardDraft(input)
	);
}

async function runMutation<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveOrganizationDocumentErrorMessage(
	error: unknown
): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.upstreamCode ?? failure.code) {
		case "center_agent_member_research.already_running":
			return "OpenMeld is already learning about a member.";
		case "center_agent_member_research.member_not_found":
			return "This person is no longer in the Organization.";
		case "center_agent.designation_required":
			return "Connect this Organization's Center Agent before learning about members.";
		case "organization_document.knowledge_limit_reached":
			return `This Organization already has ${ORGANIZATION_KNOWLEDGE_DOCUMENT_LIMIT} knowledge documents.`;
		case "organization_document.brief_exists":
			return "This Organization already has an Organization Brief.";
		case "organization_document.member_profile_exists":
			return "This member already has a Profile Report.";
		case "organization_document.write_forbidden":
			return "You do not have permission to make this change.";
		case "organization_document.not_found":
			return "This document no longer exists.";
		case "organization_document.organization_context_changed":
			return "Your active Organization changed. Reload this page before saving.";
		case "organization_document.draft_changed":
			return "This draft changed after you opened it. Review the latest draft before continuing.";
		case "organization_document.draft_not_found":
			return "This draft was already reviewed. Reload the document to see its current content.";
		case "organization_document.working_copy_conflict":
			return "OpenMeld found a newer version while you were editing. Your changes are still here. Copy anything you want to keep, then reload the document.";
		case "organization_document.folder_exists":
			return "A folder with this name already exists.";
		case "organization_document.folder_limit_reached":
			return "This Organization already has 50 document folders.";
		case "organization_document.folder_name_invalid":
			return "Folder names must be between 1 and 200 characters.";
		case "organization_document.managed_placement":
			return "OpenMeld keeps Profile Reports organized automatically. Reload Documents to see the latest folder.";
		case "organization_document.folder_not_found":
			return "This folder no longer exists. Reload the page to see the current folders.";
		default:
			return "OpenMeld could not save this document. Try again.";
	}
}
