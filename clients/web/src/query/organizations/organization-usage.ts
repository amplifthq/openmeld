import type { OrganizationUsageOverviewResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type OrganizationUsageFailure,
	readCurrentOrganizationUsageOverview,
} from "#/lib/organizations/organization-usage";
import { baseQueryOptions } from "#/query/query-config";

export const organizationUsageQueryKeys = {
	all: ["organization-usage"] as const,
	overview: (organizationId: string) =>
		[...organizationUsageQueryKeys.all, organizationId, "overview"] as const,
};

export function organizationUsageOverviewQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions<
		OrganizationUsageOverviewResponse,
		OrganizationUsageFailure
	>({
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentOrganizationUsageOverview({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationUsageQueryKeys.overview(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
