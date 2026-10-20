import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { readRememberedProfileChat } from "#/components/member-agents/member-agent-last-chat";
import { useMemberAgentIndex } from "#/components/member-agents/use-member-agents";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

/**
 * Opens (or creates) the signed-in member's Direct Message with one profile
 * and navigates to it. With one of the member's MemberAgent Profiles it
 * reopens the chat last opened with that Profile while it still exists. One
 * open runs at a time; failures show a toast.
 */
export function useOpenDirectMessage(input: {
	organizationId: string | null;
	orgSlug: string | undefined;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
	const humanProfileId = useMemberAgentIndex().humanProfileId ?? undefined;
	const open = useCallback(
		async (profileId: string) => {
			if (!(input.organizationId && input.orgSlug) || pendingProfileId) {
				return;
			}
			setPendingProfileId(profileId);
			try {
				const response =
					(await readRememberedChatOrNull({
						queryClient,
						organizationId: input.organizationId,
						humanProfileId,
						agentProfileId: profileId,
					})) ??
					(await openCurrentDirectMessageSpace({
						organizationId: input.organizationId,
						targetProfileId: profileId,
					}));
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
			humanProfileId,
			input.organizationId,
			input.orgSlug,
			navigate,
			pendingProfileId,
			queryClient,
		]
	);
	return { open, pendingProfileId };
}

/** A remembered MemberAgent chat; a failed check falls back to the open. */
export async function readRememberedChatOrNull(input: {
	queryClient: QueryClient;
	organizationId: string;
	humanProfileId: string | undefined;
	agentProfileId: string;
}): Promise<{ spaceId: string; memberProfileId: string } | null> {
	if (!input.humanProfileId) {
		return null;
	}
	try {
		return await readRememberedProfileChat({
			queryClient: input.queryClient,
			scope: {
				organizationId: input.organizationId,
				humanProfileId: input.humanProfileId,
			},
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		console.warn("Could not check the remembered chat.", error);
		return null;
	}
}
