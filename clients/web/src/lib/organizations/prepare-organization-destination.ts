import type { QueryClient } from "@tanstack/react-query";
import {
	centerAgentDirectMessageOpenQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

export async function prepareOrganizationDestination(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<void> {
	await input.queryClient.fetchQuery(
		centerAgentDirectMessageOpenQueryOptions({
			organizationId: input.organizationId,
		})
	);
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: centerAgentQueryKeys.designation(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.directory(input.organizationId),
		}),
	]);
}
