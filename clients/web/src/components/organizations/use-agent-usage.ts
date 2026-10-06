import type { AiUsageQuery } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	organizationAiUsageQueryOptions,
	organizationUsageQueryKeys,
} from "#/query/organizations/organization-usage";

export function useAgentUsage(input: {
	organizationId: string;
	userId?: string;
	query: AiUsageQuery;
}) {
	const queryClient = useQueryClient();
	const personal = input.userId !== undefined;
	const profiles = useQuery(
		organizationProfileDirectoryQueryOptions({
			organizationId: input.organizationId,
			enabled: personal,
		})
	);
	const owned = profiles.data?.agentProfiles.filter(
		(profile) => profile.ownerUserId === input.userId && !profile.isCenterAgent
	);
	const query = useQuery({
		...organizationAiUsageQueryOptions({
			organizationId: input.organizationId,
			query: {
				...input.query,
				...(personal
					? {
							agentProfileIds: owned?.map((profile) => profile.profileId) ?? [],
						}
					: {}),
			},
		}),
		enabled: !personal || profiles.isSuccess,
	});
	async function refresh() {
		if (personal) {
			const result = await profiles.refetch();
			if (result.isError) {
				return;
			}
		}
		await queryClient.invalidateQueries({
			queryKey: [
				...organizationUsageQueryKeys.all,
				input.organizationId,
				"records",
			],
		});
	}
	return {
		owned,
		query,
		pending: query.isPending || (personal && profiles.isPending),
		failed: query.isError || (personal && profiles.isError),
		refreshing: query.isFetching || (personal && profiles.isFetching),
		refresh,
	};
}
