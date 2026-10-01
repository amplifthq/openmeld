import type {
	AiUsageQuery,
	OrganizationUsageOverviewResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type OrganizationUsageFailure,
	readCurrentOrganizationUsageOverview,
	readOrganizationAiUsage,
} from "#/lib/organizations/organization-usage";
import { baseQueryOptions } from "#/query/query-config";

export const organizationUsageQueryKeys = {
	all: ["organization-usage"] as const,
	overview: (organizationId: string) =>
		[...organizationUsageQueryKeys.all, organizationId, "overview"] as const,
};

export function organizationAiUsageQueryOptions(input: {
	organizationId: string;
	query: AiUsageQuery;
}) {
	return queryOptions({
		queryKey: [
			...organizationUsageQueryKeys.all,
			input.organizationId,
			"records",
			input.query,
		],
		queryFn: ({ signal }) => readOrganizationAiUsage({ ...input, signal }),
		staleTime: 30_000,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
	});
}

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
