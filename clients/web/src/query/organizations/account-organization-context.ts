import type { AccountOrganizationContext } from "@openmeld/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { readCurrentAccountOrganizationContext } from "#/lib/organizations/account-organization-context";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { baseQueryOptions } from "#/query/query-config";

// This is the account's membership snapshot, not one copy per destination.
// The existing auth boundary cancels and removes it when the account changes.
export const accountOrganizationContextQueryKey = [
	"account-organization-context",
] as const;

export function accountOrganizationContextQueryOptions(routeFamily: string) {
	return queryOptions({
		queryKey: accountOrganizationContextQueryKey,
		queryFn: ({ signal }) =>
			readCurrentAccountOrganizationContext(routeFamily, signal),
		gcTime: baseQueryOptions.gcTime,
		// An offline entry must reach a recoverable error instead of pausing the
		// parent loader indefinitely. The read itself has a transport deadline.
		networkMode: "always",
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: 0,
	});
}

export const organizationUserInvitationsQueryKey = (userId: string) =>
	["organization-user-invitations", userId] as const;

export function applyOrganizationDeletionToAccountContext(input: {
	deletedOrganizationId: string;
	nextActiveOrganization: OrganizationSummary;
	queryClient: QueryClient;
}): void {
	input.queryClient.setQueryData<AccountOrganizationContext | null>(
		accountOrganizationContextQueryKey,
		(context) =>
			context
				? {
						...context,
						defaultOrganizationId: input.nextActiveOrganization.id,
						organizations: context.organizations.filter(
							(organization) => organization.id !== input.deletedOrganizationId
						),
					}
				: context
	);
}

export function setOrganizationLogoInAccountContext(input: {
	logo: string | null;
	organizationId: string;
	queryClient: QueryClient;
}): void {
	input.queryClient.setQueryData<AccountOrganizationContext | null>(
		accountOrganizationContextQueryKey,
		(context) =>
			context
				? {
						...context,
						organizations: context.organizations.map((organization) =>
							organization.id === input.organizationId
								? { ...organization, logo: input.logo }
								: organization
						),
					}
				: context
	);
}
