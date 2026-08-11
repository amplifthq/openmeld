import {
	createAgentProfileBindingApi,
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AuthorizeAgentProfileBindingForOrganizationResponse,
	BulkAuthorizeAgentProfileBindingsForOrganizationResponse,
	GetOrganizationBindingAuthorizationPreferenceResponse,
	ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
	ListOrganizationBindingAuthorizationProfilesResponse,
	ListOrganizationBindingAuthorizationsResponse,
	RevokeAgentProfileBindingForOrganizationResponse,
	SaveOrganizationWakeAccessChoiceResponse,
	SetOrganizationBindingAuthorizationPreferenceResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type OrganizationBindingAuthorizationsFailure =
	StructuredApiClientFailure;

export async function listOrganizationBindingAuthorizations(input: {
	organizationId: string;
}): Promise<ListOrganizationBindingAuthorizationsResponse> {
	try {
		return await createAgentProfileBindingApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).listOrganizationAuthorizations();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentUserAgentProfileOrganizationWakeAccess(): Promise<ListCurrentUserAgentProfileOrganizationWakeAccessResponse> {
	try {
		return await createAgentProfileBindingApi(
			createWebOpenMeldApiFoundation()
		).listCurrentUserOrganizationWakeAccess();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function authorizeAgentProfileBindingForCurrentOrganization(input: {
	agentProfileId: string;
	organizationId: string;
}): Promise<AuthorizeAgentProfileBindingForOrganizationResponse> {
	try {
		return await createAgentProfileBindingApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).authorizePrimaryBindingForOrganization({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function revokeAgentProfileBindingForCurrentOrganization(input: {
	agentProfileId: string;
	organizationId: string;
}): Promise<RevokeAgentProfileBindingForOrganizationResponse> {
	try {
		return await createAgentProfileBindingApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).revokePrimaryBindingForOrganization({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function bulkAuthorizeAgentProfileBindingsForOrganization(input: {
	agentProfileIds?: string[];
	organizationId: string;
}): Promise<BulkAuthorizeAgentProfileBindingsForOrganizationResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).bulkAuthorizeAgentProfileBindings({
			...(input.agentProfileIds
				? { agentProfileIds: input.agentProfileIds }
				: {}),
			organizationId: input.organizationId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listOrganizationBindingAuthorizationProfiles(input: {
	organizationId: string;
}): Promise<ListOrganizationBindingAuthorizationProfilesResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).listBindingAuthorizationProfiles({
			organizationId: input.organizationId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getOrganizationBindingAuthorizationPreference(input: {
	organizationId: string;
}): Promise<GetOrganizationBindingAuthorizationPreferenceResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getBindingAuthorizationPreference({
			organizationId: input.organizationId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setOrganizationBindingAuthorizationPreference(input: {
	autoAuthorizeAgentProfileBindings: boolean;
	organizationId: string;
}): Promise<SetOrganizationBindingAuthorizationPreferenceResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).setBindingAuthorizationPreference({
			autoAuthorizeAgentProfileBindings:
				input.autoAuthorizeAgentProfileBindings,
			organizationId: input.organizationId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function saveOrganizationWakeAccessChoice(input: {
	enableWakeAccess: boolean;
	organizationId: string;
}): Promise<SaveOrganizationWakeAccessChoiceResponse> {
	try {
		return await createOrganizationApi(
			createWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).saveWakeAccessChoice(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
