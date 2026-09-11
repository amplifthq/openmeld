import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { invalidateInboxFacts } from "./inbox";
import { organizationQueryKeys } from "./organization-directory";

export const invitationRequestQueryKey = [
	"organization-invitation-requests",
] as const;

export function useInvitationRequests() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return useInfiniteQuery({
		queryKey: [
			...invitationRequestQueryKey,
			currentUserId,
			currentOrganization.id,
			"list",
		],
		initialPageParam: undefined as
			| { createdAt: number; id: string; pending: boolean }
			| undefined,
		queryFn: ({ pageParam }) =>
			requestOrganizationJoinRequests({
				action: "list",
				organizationId: currentOrganization.id,
				...(pageParam ? { before: pageParam } : {}),
			}),
		getNextPageParam: (page) => {
			const last = page.at(-1);
			return page.length === 100 && last
				? {
						createdAt: last.createdAt,
						id: last.id,
						pending: last.status === "pending",
					}
				: undefined;
		},
		refetchInterval: 30_000,
		retry: false,
	});
}

export function useInvitationRequest(requestId: string) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryKey = [
		...invitationRequestQueryKey,
		currentUserId,
		currentOrganization.id,
		requestId,
	];
	const query = useQuery({
		queryKey,
		queryFn: async () => {
			const [request] = await requestOrganizationJoinRequests({
				action: "get",
				requestId,
			});
			if (!request || request.organizationId !== currentOrganization.id) {
				throw new Error("This request is not available in this organization.");
			}
			return request;
		},
		retry: false,
		refetchInterval: 15_000,
	});
	const mutation = useInvitationRequestMutation(requestId);
	return { query, mutation };
}

export function useInvitationRequestMutation(requestId: string) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const client = useQueryClient();
	return useMutation({
		mutationFn: (action: "approve" | "reject" | "retry") =>
			requestOrganizationJoinRequests({ action, requestId }),
		onSuccess: (requests) => {
			const updated = requests[0];
			if (updated) {
				client.setQueryData(
					[
						...invitationRequestQueryKey,
						currentUserId,
						currentOrganization.id,
						requestId,
					],
					updated
				);
			}
		},
		onSettled: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: invitationRequestQueryKey }),
				invalidateInboxFacts({
					organizationId: currentOrganization.id,
					queryClient: client,
				}),
				client.invalidateQueries({
					queryKey: organizationQueryKeys.invitations(currentOrganization.id),
				}),
				client.invalidateQueries({
					queryKey: organizationQueryKeys.directory(currentOrganization.id),
				}),
			]);
		},
	});
}
