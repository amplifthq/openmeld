import type {
	GetOrganizationBindingAuthorizationPreferenceResponse,
	ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
	ListOrganizationBindingAuthorizationProfilesResponse,
	ListOrganizationBindingAuthorizationsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	getOrganizationBindingAuthorizationPreference,
	listCurrentUserAgentProfileOrganizationWakeAccess,
	listOrganizationBindingAuthorizationProfiles,
	listOrganizationBindingAuthorizations,
	type OrganizationBindingAuthorizationsFailure,
} from "#/lib/profiles/organization-binding-authorizations";
import { baseQueryOptions } from "#/query/query-config";

export const currentUserAgentProfileOrganizationWakeAccessQueryKeys = {
	all: [
		"agent-profile-binding",
		"current-user-organization-wake-access",
	] as const,
};

export function currentUserAgentProfileOrganizationWakeAccessQueryOptions(input: {
	enabled: boolean;
}) {
	return queryOptions<
		ListCurrentUserAgentProfileOrganizationWakeAccessResponse,
		OrganizationBindingAuthorizationsFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: listCurrentUserAgentProfileOrganizationWakeAccess,
		queryKey: currentUserAgentProfileOrganizationWakeAccessQueryKeys.all,
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export const organizationBindingAuthorizationQueryKeys = {
	all: ["agent-profile-binding", "organization-authorizations"] as const,
	byOrganization: (organizationId: string) =>
		[...organizationBindingAuthorizationQueryKeys.all, organizationId] as const,
	profiles: (organizationId: string) =>
		[
			...organizationBindingAuthorizationQueryKeys.byOrganization(
				organizationId
			),
			"profiles",
		] as const,
	preference: (organizationId: string) =>
		[
			...organizationBindingAuthorizationQueryKeys.byOrganization(
				organizationId
			),
			"preference",
		] as const,
} as const;

export function organizationBindingAuthorizationsQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListOrganizationBindingAuthorizationsResponse,
		OrganizationBindingAuthorizationsFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () =>
			await listOrganizationBindingAuthorizations({
				organizationId: input.organizationId,
			}),
		queryKey: organizationBindingAuthorizationQueryKeys.byOrganization(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationBindingAuthorizationProfilesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListOrganizationBindingAuthorizationProfilesResponse,
		OrganizationBindingAuthorizationsFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () =>
			await listOrganizationBindingAuthorizationProfiles({
				organizationId: input.organizationId,
			}),
		queryKey: organizationBindingAuthorizationQueryKeys.profiles(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationBindingAuthorizationPreferenceQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetOrganizationBindingAuthorizationPreferenceResponse,
		OrganizationBindingAuthorizationsFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () =>
			await getOrganizationBindingAuthorizationPreference({
				organizationId: input.organizationId,
			}),
		queryKey: organizationBindingAuthorizationQueryKeys.preference(
			input.organizationId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
