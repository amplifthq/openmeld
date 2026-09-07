import { useQuery } from "@tanstack/react-query";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequestResult } from "#/lib/organizations/organization-join-requests";

export const invitationRequestQueryKey = [
	"organization-invitation-requests",
] as const;

export function useInvitationReviewCount() {
	const scope = useOptionalAppOrganization();
	return useQuery({
		queryKey: [
			...invitationRequestQueryKey,
			scope?.currentUserId,
			scope?.currentOrganization.id,
			"summary",
		],
		enabled: Boolean(scope && !scope.currentOrganization.isPersonal),
		queryFn: async () =>
			(
				await requestOrganizationJoinRequestResult({
					action: "summary",
					organizationId: scope?.currentOrganization.id ?? "",
				})
			).actionRequiredCount ?? 0,
		staleTime: 15_000,
		refetchInterval: 30_000,
		retry: false,
	});
}
