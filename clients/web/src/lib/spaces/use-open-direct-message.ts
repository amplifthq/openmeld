import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

/**
 * Opens (or creates) the signed-in member's Direct Message with one profile
 * and navigates to it. One open runs at a time; failures show a toast.
 */
export function useOpenDirectMessage(input: {
	organizationId: string | null;
	orgSlug: string | undefined;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
	const open = useCallback(
		async (profileId: string) => {
			if (!(input.organizationId && input.orgSlug) || pendingProfileId) {
				return;
			}
			setPendingProfileId(profileId);
			try {
				const response = await openCurrentDirectMessageSpace({
					organizationId: input.organizationId,
					targetProfileId: profileId,
				});
				await queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
					refetchType: "none",
				});
				await navigate({
					to: buildOrganizationDirectMessagePath({
						orgSlug: input.orgSlug,
						search: { profileId: response.memberProfileId },
						spaceId: response.spaceId,
					}),
				});
			} catch (error) {
				console.error("Failed to open a Direct Message.", error);
				toast.error(resolveDirectMessageOpenErrorMessage(error));
			} finally {
				setPendingProfileId(null);
			}
		},
		[
			input.organizationId,
			input.orgSlug,
			navigate,
			pendingProfileId,
			queryClient,
		]
	);
	return { open, pendingProfileId };
}
