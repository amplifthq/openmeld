import {
	type AccountSidebarPreferences,
	type AccountSidebarSnapshot,
	accountSidebarResponseSchema,
} from "@openmeld/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export function useSidebarPreferences(
	profileId: string,
	organizationId: string
) {
	const client = useQueryClient();
	const queryKey = ["account-sidebar", profileId, organizationId];
	const query = useQuery({
		queryKey,
		queryFn: () =>
			createUnscopedWebOpenMeldApiFoundation().requestJson({
				url: `/v1/account/sidebar?organizationId=${encodeURIComponent(organizationId)}`,
				method: "GET",
				operation: "account.sidebar.read",
				schema: accountSidebarResponseSchema,
				invalidMessage: "OpenMeld couldn't read your sidebar settings.",
			}),
		staleTime: 0,
		refetchOnWindowFocus: () =>
			client.isMutating({ mutationKey: queryKey }) === 0,
	});
	const mutation = useMutation({
		mutationKey: queryKey,
		mutationFn: (snapshot: AccountSidebarSnapshot) => {
			return createUnscopedWebOpenMeldApiFoundation().requestJson({
				url: "/v1/account/sidebar",
				method: "PUT",
				operation: "account.sidebar.save",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					organizationId,
					...snapshot,
				}),
				schema: accountSidebarResponseSchema,
				invalidMessage: "OpenMeld couldn't save your sidebar settings.",
			});
		},
		onMutate: async (snapshot) => {
			await client.cancelQueries({ queryKey });
			const previous = client.getQueryData(queryKey);
			client.setQueryData(queryKey, { ok: true, ...snapshot });
			return previous;
		},
		onSuccess: (data) => client.setQueryData(queryKey, data),
		onError: async (error, _snapshot, previous) => {
			if (previous) {
				client.setQueryData(queryKey, previous);
			}
			toast.error(error.message);
			await client.invalidateQueries({ queryKey });
		},
	});
	return {
		preferences: query.data?.preferences,
		save: (preferences: AccountSidebarPreferences) => {
			if (query.data && !mutation.isPending) {
				mutation.mutate({ revision: query.data.revision, preferences });
			}
		},
		disabled: !query.data || mutation.isPending,
		isError: query.isError,
		retry: query.refetch,
	};
}
