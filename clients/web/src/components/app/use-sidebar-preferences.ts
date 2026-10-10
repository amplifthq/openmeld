import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	type AccountSidebarPreferences,
	type AccountSidebarSnapshot,
	accountSidebarResponseSchema,
} from "@openmeld/schemas";
import {
	useMutation,
	useMutationState,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	accountSidebarQueryKey,
	accountSidebarQueryOptions,
} from "#/query/account/sidebar-preferences";

type SidebarUpdate = (
	preferences: AccountSidebarPreferences
) => AccountSidebarPreferences;

export function useSidebarPreferences(organizationId: string) {
	const { currentUserId } = useAppOrganization();
	const client = useQueryClient();
	const queryKey = accountSidebarQueryKey(currentUserId, organizationId);
	const query = useQuery({
		...accountSidebarQueryOptions(currentUserId, organizationId),
		refetchOnWindowFocus: () =>
			client.isMutating({ mutationKey: queryKey }) === 0,
	});
	const mutation = useMutation({
		mutationKey: queryKey,
		scope: { id: JSON.stringify(queryKey) },
		retry: false,
		mutationFn: (update: SidebarUpdate) => {
			const confirmed = client.getQueryData<AccountSidebarSnapshot>(queryKey);
			if (!confirmed) {
				throw new Error("Sidebar settings are still loading. Try again.");
			}
			return createUnscopedWebOpenMeldApiFoundation().requestJson({
				url: "/v1/account/sidebar",
				method: "PUT",
				operation: "account.sidebar.save",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					organizationId,
					revision: confirmed.revision,
					preferences: update(confirmed.preferences),
				}),
				schema: accountSidebarResponseSchema,
				invalidMessage: "OpenMeld couldn't save your sidebar settings.",
			});
		},
		onMutate: async () => await client.cancelQueries({ queryKey }),
		onSuccess: (data) => client.setQueryData(queryKey, data),
		onError: async (error) => {
			const failure = toStructuredApiClientFailure(error);
			console.error("Could not save sidebar preferences.", error);
			const messages: Record<number, string> = {
				401: "Sign in again to save your sidebar changes.",
				403: "This page can't save sidebar changes. Reopen your workspace and try again.",
				409: "Your sidebar changed on another device. Refresh and try again.",
			};
			toast.error(
				messages[failure.status ?? 0] ??
					"Couldn't save your sidebar changes. Try again."
			);
			await client.invalidateQueries({ queryKey });
		},
	});
	// The query contains confirmed server truth. Native queued mutations own the
	// pending intents; every mounted sidebar derives the same optimistic view.
	const pending = useMutationState<{ id: number; update: SidebarUpdate }>({
		filters: { mutationKey: queryKey, exact: true, status: "pending" },
		select: (item) => ({
			id: item.mutationId,
			update: item.state.variables as SidebarUpdate,
		}),
	}).sort((left, right) => left.id - right.id);
	const preferences = query.data
		? pending.reduce(
				(value, intent) => intent.update(value),
				query.data.preferences
			)
		: undefined;
	return {
		preferences,
		isPending: query.isPending,
		updateAsync: (update: SidebarUpdate) => mutation.mutateAsync(update),
		update: (update: SidebarUpdate) => mutation.mutate(update),
		save: (preferences: AccountSidebarPreferences) => {
			if (query.data && pending.length === 0) {
				mutation.mutate(() => preferences);
			}
		},
		saveAsync: async (preferences: AccountSidebarPreferences) => {
			if (!query.data || pending.length > 0) {
				throw new Error("Sidebar settings are still loading. Try again.");
			}
			await mutation.mutateAsync(() => preferences);
		},
		disabled: !query.data || pending.length > 0,
		isError: query.isError,
		isFetching: query.isFetching,
		retry: query.refetch,
	};
}
