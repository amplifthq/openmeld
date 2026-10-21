import { createPermissionModeSuggestionsApi } from "@openmeld/api-client";
import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

const PENDING_PERMISSION_MODE_SUGGESTIONS_KEY =
	"pending-permission-mode-suggestions";

/** Owner-only permission-mode suggestion cards for one Space. */
export function usePendingPermissionModeSuggestions(spaceId: string) {
	const organization = useOptionalAppOrganization();
	const organizationId = organization?.currentOrganization.id;
	const currentUserId = organization?.currentUserId;
	const queryClient = useQueryClient();
	const queryKey = [
		PENDING_PERMISSION_MODE_SUGGESTIONS_KEY,
		currentUserId,
		organizationId,
		spaceId,
	];
	const query = useQuery({
		queryKey,
		queryFn: organizationId
			? () =>
					createPermissionModeSuggestionsApi(
						createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
					).list({ organizationId, spaceId })
			: skipToken,
		refetchInterval: 30_000,
		staleTime: 15_000,
		retry: false,
	});
	const resolve = useMutation({
		mutationFn: (input: {
			resolution: "applied" | "dismissed";
			suggestionId: string;
		}) => {
			if (!organizationId) {
				throw new Error("Choose an organization first.");
			}
			return createPermissionModeSuggestionsApi(
				createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
			).resolve({ organizationId, ...input });
		},
		retry: false,
		onSettled: () => queryClient.invalidateQueries({ queryKey }),
	});
	return {
		resolve: resolve.mutateAsync,
		suggestions: query.data?.suggestions ?? [],
	};
}
