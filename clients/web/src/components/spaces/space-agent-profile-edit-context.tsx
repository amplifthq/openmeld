"use client";

import type { AuthProfileView, ModelCatalog } from "@openmeld/schemas/types";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type PropsWithChildren,
	use,
	useCallback,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { buildEditableSpaceAgentProfilesById } from "./space-agent-profile-edit-access";

type SpaceAgentProfileEditContextValue = {
	context: AgentProfileEditDialogContext | null;
	modelCatalog: ModelCatalog | null;
	onOpenDirectMessage: ((profileId: string) => Promise<void>) | null;
	pendingDirectMessageProfileId: string | null;
	profilesById: ReadonlyMap<string, AuthProfileView>;
};

const SpaceAgentProfileEditContext =
	createContext<SpaceAgentProfileEditContextValue | null>(null);

export function SpaceAgentProfileEditProvider(
	input: PropsWithChildren<{
		accountProfiles: readonly AuthProfileView[];
		context: AgentProfileEditDialogContext | null;
		currentOwnerUserId: string | null;
		modelCatalog: ModelCatalog | null;
		organizationId: string | null;
		orgSlug: string;
	}>
) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [pendingDirectMessageProfileId, setPendingDirectMessageProfileId] =
		useState<string | null>(null);
	const profilesById = useMemo(
		() =>
			buildEditableSpaceAgentProfilesById({
				accountProfiles: input.accountProfiles,
				currentOwnerUserId: input.currentOwnerUserId,
				editContextAvailable: input.context !== null,
			}),
		[input.accountProfiles, input.context, input.currentOwnerUserId]
	);
	const onOpenDirectMessage = useCallback(
		async (profileId: string) => {
			if (!input.organizationId || pendingDirectMessageProfileId) {
				return;
			}
			setPendingDirectMessageProfileId(profileId);
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
				console.error("Failed to open Agent Direct Message.", error);
				toast.error(resolveDirectMessageOpenErrorMessage(error));
			} finally {
				setPendingDirectMessageProfileId(null);
			}
		},
		[
			input.organizationId,
			input.orgSlug,
			navigate,
			pendingDirectMessageProfileId,
			queryClient,
		]
	);
	const value = useMemo<SpaceAgentProfileEditContextValue>(
		() => ({
			context: input.context,
			modelCatalog: input.modelCatalog,
			onOpenDirectMessage: input.organizationId ? onOpenDirectMessage : null,
			pendingDirectMessageProfileId,
			profilesById,
		}),
		[
			input.context,
			input.modelCatalog,
			input.organizationId,
			onOpenDirectMessage,
			pendingDirectMessageProfileId,
			profilesById,
		]
	);
	return (
		<SpaceAgentProfileEditContext.Provider value={value}>
			{input.children}
		</SpaceAgentProfileEditContext.Provider>
	);
}

export function useOptionalSpaceAgentProfileEditContext() {
	return use(SpaceAgentProfileEditContext);
}
