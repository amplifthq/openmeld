import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER,
	ORGANIZATION_DIRECTORY_CENTER_AGENT_ONLY_QUERY_PARAMETER,
	ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER,
	ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
	ORGANIZATION_DIRECTORY_INCLUDE_PUBLIC_WAKEABILITY_REASON_QUERY_PARAMETER,
	ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER,
	ORGANIZATION_PROFILE_DIRECTORY_INCLUDE_MODEL_SELECTION_QUERY_PARAMETER,
} from "@openmeld/gateway-contract";
import {
	organizationAgentRuntimeOverviewResponseSchema,
	organizationDirectoryResponseSchema,
	organizationProfileDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readCurrentOrganizationDirectory(input: {
	organizationId: string;
	centerAgentOnly?: boolean;
	signal?: AbortSignal;
}): Promise<OrganizationDirectoryResponse> {
	const query = new URLSearchParams({
		[ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER]:
			"true",
		[ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER]: "true",
		[ORGANIZATION_DIRECTORY_INCLUDE_PUBLIC_WAKEABILITY_REASON_QUERY_PARAMETER]:
			"true",
	});
	if (input.centerAgentOnly) {
		query.set(ORGANIZATION_DIRECTORY_CENTER_AGENT_ONLY_QUERY_PARAMETER, "true");
		query.delete(
			ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER
		);
	}
	try {
		return await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid organization directory response.",
			method: "GET",
			signal: input.signal,
			operation: "organization.directory.read",
			schema: organizationDirectoryResponseSchema,
			url: `/v1/organizations/current/directory?${query.toString()}`,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentOrganizationProfileDirectory(input: {
	organizationId: string;
	signal?: AbortSignal;
	identityOnly?: boolean;
}): Promise<OrganizationProfileDirectoryResponse> {
	const query = new URLSearchParams(
		input.identityOnly
			? {
					[ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER]:
						"true",
				}
			: {
					[ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER]:
						"true",
					[ORGANIZATION_PROFILE_DIRECTORY_INCLUDE_MODEL_SELECTION_QUERY_PARAMETER]:
						"true",
					[ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER]:
						"true",
					[ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER]:
						"true",
				}
	);
	try {
		return await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid organization Profile Directory response.",
			method: "GET",
			operation: "organization.profile_directory.read",
			schema: organizationProfileDirectoryResponseSchema,
			signal: input.signal,
			url: `/v1/organizations/current/profile-directory?${query.toString()}`,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentOrganizationAgentRuntimeOverview(input: {
	organizationId: string;
	workloadProfileId?: string;
	signal?: AbortSignal;
}): Promise<OrganizationAgentRuntimeOverviewResponse> {
	const query = new URLSearchParams({
		includeUsageLimits: "true",
		[ORGANIZATION_DIRECTORY_INCLUDE_PUBLIC_WAKEABILITY_REASON_QUERY_PARAMETER]:
			"true",
		[ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER]:
			"2",
		[ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER]: "true",
	});
	if (input.workloadProfileId) {
		query.set("workloadProfileId", input.workloadProfileId);
	}
	try {
		return await createOrganizationScopedWebOpenMeldApiFoundation({
			organizationId: input.organizationId,
		}).requestJson({
			invalidMessage: "Invalid organization Agent Runtime Overview response.",
			method: "GET",
			operation: "organization.agent_runtime_overview.read",
			schema: organizationAgentRuntimeOverviewResponseSchema,
			signal: input.signal,
			url: `/v1/organizations/current/agent-runtime-overview?${query.toString()}`,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export type OrganizationDirectoryFailure = StructuredApiClientFailure;
