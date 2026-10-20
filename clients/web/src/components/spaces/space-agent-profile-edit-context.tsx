"use client";

import type { AuthProfileView, ModelCatalog } from "@openmeld/schemas/types";
import { createContext, type PropsWithChildren, use, useMemo } from "react";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { useOpenDirectMessage } from "#/lib/spaces/use-open-direct-message";
import { buildEditableSpaceAgentProfilesById } from "./space-agent-profile-edit-access";

type SpaceAgentProfileEditContextValue = {
	context: AgentProfileEditDialogContext | null;
	modelCatalog: ModelCatalog | null;
	onOpenDirectMessage: ((profileId: string) => Promise<void>) | null;
	organizationId: string | null;
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
		orgSlug?: string;
	}>
) {
	const directMessage = useOpenDirectMessage({
		organizationId: input.organizationId,
		orgSlug: input.orgSlug,
	});
	const onOpenDirectMessage = directMessage.open;
	const pendingDirectMessageProfileId = directMessage.pendingProfileId;
	const profilesById = useMemo(
		() =>
			buildEditableSpaceAgentProfilesById({
				accountProfiles: input.accountProfiles,
				currentOwnerUserId: input.currentOwnerUserId,
				editContextAvailable: input.context !== null,
			}),
		[input.accountProfiles, input.context, input.currentOwnerUserId]
	);
	const value = useMemo<SpaceAgentProfileEditContextValue>(
		() => ({
			context: input.context,
			modelCatalog: input.modelCatalog,
			onOpenDirectMessage: input.organizationId ? onOpenDirectMessage : null,
			organizationId: input.organizationId,
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
