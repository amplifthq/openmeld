import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { resolveOrganizationScope } from "#/lib/organizations/organization-scope";
import type {
	OrganizationScopeResolution,
	OrganizationSummary,
} from "#/lib/organizations/organization-types";
import { baseQueryOptions } from "#/query/query-config";

export const organizationScopeQueryKeys = {
	all: ["organization-scope"] as const,
	bySlug: (organizationSlug: string) =>
		[...organizationScopeQueryKeys.all, organizationSlug] as const,
	userInvitations: (userId: string) =>
		["organization-user-invitations", userId] as const,
};

export function organizationScopeQueryOptions(input: {
	organizationSlug: string;
	routeFamily: string;
}) {
	return queryOptions<OrganizationScopeResolution>({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async () =>
			await resolveOrganizationScope({
				data: {
					orgSlug: input.organizationSlug,
					routeFamily: input.routeFamily,
				},
			}),
		queryKey: organizationScopeQueryKeys.bySlug(input.organizationSlug),
		refetchOnWindowFocus: false,
		retry: false,
		// Route loaders use fetchQuery so each Organization entry revalidates the
		// current membership list before exposing Organization-scoped actions.
		staleTime: 0,
	});
}

export function applyOrganizationDeletionToScopeCache(input: {
	deletedOrganizationId: string;
	deletedOrganizationSlug: string;
	nextActiveOrganization: OrganizationSummary;
	queryClient: QueryClient;
}): void {
	input.queryClient.removeQueries({
		exact: true,
		queryKey: organizationScopeQueryKeys.bySlug(input.deletedOrganizationSlug),
	});
	input.queryClient.setQueriesData<OrganizationScopeResolution>(
		{ queryKey: organizationScopeQueryKeys.all },
		(scope) => {
			if (!scope) {
				return scope;
			}
			const organizations = scope.organizations.filter(
				(organization) => organization.id !== input.deletedOrganizationId
			);
			if (scope.access === "denied") {
				return {
					...scope,
					activeOrganization: input.nextActiveOrganization,
					organizations,
				};
			}
			return {
				...scope,
				activeOrganization: input.nextActiveOrganization,
				organizations,
			};
		}
	);
}

export function setOrganizationLogoInScopeCache(input: {
	logo: string | null;
	organizationId: string;
	organizationSlug: string;
	queryClient: QueryClient;
}): void {
	input.queryClient.setQueryData<OrganizationScopeResolution>(
		organizationScopeQueryKeys.bySlug(input.organizationSlug),
		(scope) => {
			if (!scope) {
				return scope;
			}
			const updateOrganization = (
				organization: OrganizationSummary | null
			): OrganizationSummary | null =>
				organization?.id === input.organizationId
					? { ...organization, logo: input.logo }
					: organization;
			const organizations = scope.organizations.map(
				(organization) => updateOrganization(organization) ?? organization
			);
			if (scope.access === "authorized") {
				return {
					...scope,
					activeOrganization: updateOrganization(scope.activeOrganization),
					currentOrganization:
						updateOrganization(scope.currentOrganization) ??
						scope.currentOrganization,
					organizations,
				};
			}
			return {
				...scope,
				activeOrganization: updateOrganization(scope.activeOrganization),
				organizations,
			};
		}
	);
}
