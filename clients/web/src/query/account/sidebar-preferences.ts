import { accountSidebarResponseSchema } from "@openmeld/schemas";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";

export const accountSidebarQueryKey = (
	accountId: string,
	organizationId: string
) => ["account-sidebar", accountId, organizationId] as const;

export function accountSidebarQueryOptions(
	accountId: string,
	organizationId: string
) {
	return queryOptions({
		queryKey: accountSidebarQueryKey(accountId, organizationId),
		queryFn: () =>
			createUnscopedWebOpenMeldApiFoundation().requestJson({
				url: `/v1/account/sidebar?organizationId=${encodeURIComponent(organizationId)}`,
				method: "GET",
				operation: "account.sidebar.read",
				schema: accountSidebarResponseSchema,
				invalidMessage: "OpenMeld couldn't read your sidebar settings.",
			}),
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
		staleTime: 30_000,
	});
}
