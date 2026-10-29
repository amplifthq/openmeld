import { createPluginsApi } from "@openmeld/api-client";
import type { PluginActionRequestCommand } from "@openmeld/schemas/types";
import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import {
	useAppOrganization,
	useOptionalAppOrganization,
} from "#/lib/organizations/organization-context";
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
				includeIssuePreview: true,
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
			api.requestAuthorization({
				organizationId,
				command,
				includeIssuePreview: true,
			}),
		retry: false,
		gcTime: 0,
		onSuccess: (request) => client.setQueryData(queryKey, request),
		onSettled: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey }),
				client.invalidateQueries({
					queryKey: [
						"pending-plugin-action-requests",
						currentUserId,
						organizationId,
					],
				}),
				invalidateInboxFacts({ organizationId, queryClient: client }),
			]);
		},
	});
	return { query, mutation };
}

export function usePendingSpacePluginActionRequests(
	spaceId: string,
	activeThreadId: string | null
) {
	const organization = useOptionalAppOrganization();
	const organizationId = organization?.currentOrganization.id;
	const currentUserId = organization?.currentUserId;
	const query = useQuery({
		queryKey: [
			"pending-plugin-action-requests",
			currentUserId,
			organizationId,
			spaceId,
		],
		queryFn: organizationId
			? () =>
					createPluginsApi(
						createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
					).listRequests({ organizationId, spaceId })
			: skipToken,
		refetchInterval: 15_000,
		staleTime: 15_000,
		retry: false,
	});
	const requests = query.data?.requests ?? [];
	return {
		...query,
		conversation: requests.filter(
			(request) => !activeThreadId || request.sourceThreadId !== activeThreadId
		),
		thread: requests.filter(
			(request) =>
				Boolean(activeThreadId) && request.sourceThreadId === activeThreadId
		),
	};
}

export function useMessagePluginActionRequests(
	spaceId: string,
	sourceSignalIds: string[]
) {
	const organization = useOptionalAppOrganization();
	const organizationId = organization?.currentOrganization.id;
	const currentUserId = organization?.currentUserId;
	return useQuery({
		queryKey: [
			"message-plugin-action-requests",
			currentUserId,
			organizationId,
			spaceId,
			sourceSignalIds,
		],
		queryFn:
			organizationId && sourceSignalIds.length > 0
				? async () => {
						const api = createPluginsApi(
							createOrganizationScopedWebOpenMeldApiFoundation({
								organizationId,
							})
						);
						const batches = await Promise.all(
							Array.from(
								{ length: Math.ceil(sourceSignalIds.length / 1000) },
								(_, index) =>
									api.listRequests({
										organizationId,
										spaceId,
										sourceSignalIds: sourceSignalIds.slice(
											index * 1000,
											(index + 1) * 1000
										),
									})
							)
						);
						return { requests: batches.flatMap((batch) => batch.requests) };
					}
				: skipToken,
		retry: false,
		staleTime: 15_000,
		refetchInterval: 15_000,
	});
}
