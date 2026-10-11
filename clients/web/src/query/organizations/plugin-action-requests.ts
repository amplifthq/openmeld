import { createPluginsApi } from "@openmeld/api-client";
import type { PluginActionRequestCommand } from "@openmeld/schemas/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { invalidateInboxFacts } from "./inbox";

export function usePluginActionRequest(requestId: string) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const client = useQueryClient();
	const queryKey = [
		"plugin-action-request",
		currentUserId,
		organizationId,
		requestId,
	];
	const api = createPluginsApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
	const query = useQuery({
		queryKey,
		queryFn: () =>
			api.requestAuthorization({
				organizationId,
				command: { operation: "read", requestId },
			}),
		retry: false,
		refetchInterval: (current) =>
			current.state.data?.state === "pending" ||
			current.state.data?.continuation === "pending"
				? 15_000
				: false,
	});
	const mutation = useMutation({
		mutationFn: (command: PluginActionRequestCommand) =>
			api.requestAuthorization({ organizationId, command }),
		retry: false,
		gcTime: 0,
		onSuccess: (request) => client.setQueryData(queryKey, request),
		onSettled: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey }),
				invalidateInboxFacts({ organizationId, queryClient: client }),
			]);
		},
	});
	return { query, mutation };
}

export function useMessagePluginActionRequests(
	spaceId: string,
	sourceSignalIds: string[]
) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const organizationId = currentOrganization.id;
	const api = createPluginsApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
	return useQuery({
		queryKey: [
			"message-plugin-action-requests",
			currentUserId,
			organizationId,
			spaceId,
			sourceSignalIds,
		],
		queryFn: () =>
			api.listRequests({ organizationId, spaceId, sourceSignalIds }),
		retry: false,
		staleTime: 15_000,
		refetchInterval: 15_000,
	});
}
