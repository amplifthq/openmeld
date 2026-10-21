"use client";

import type {
	AuthProfileView,
	ModelCatalog,
	SpaceMembersSnapshot,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { useQueryClient } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { updateAgentProfileControllerPermissionMode } from "#/components/agents/agent-profile-edit-actions";
import {
	type AgentProfileEditDialogContext,
	AgentProfileEditDialogController,
} from "#/components/agents/agent-profile-edit-dialog-controller";
import type {
	SpaceAgentPermissionModeOption,
	SpaceAgentPermissionModeUpdateHandler,
} from "./space-agent-interaction-card";
import { buildEditableSpaceAgentProfilesById } from "./space-agent-profile-edit-access";
import { resolveSpacePermissionModeOptions } from "./space-pending-agent-action-model";
import type { SpacePendingAgentActions } from "./space-pending-agent-actions";

type PendingAgentActionSurfaceProps = Omit<
	ComponentProps<typeof SpacePendingAgentActions>,
	"returnFocusRef"
>;

export function useSpacePendingAgentActions(input: {
	accountProfiles: readonly AuthProfileView[];
	agentProfileEditContext: AgentProfileEditDialogContext | null | undefined;
	currentOwnerUserId: string | null;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	onRespond: ComponentProps<typeof SpacePendingAgentActions>["onRespond"];
	presentedItems: readonly WakeProgressItem[];
	threadItems: readonly WakeProgressItem[];
}) {
	const queryClient = useQueryClient();
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const editableAgentProfilesById = useMemo(
		() =>
			buildEditableSpaceAgentProfilesById({
				accountProfiles: input.accountProfiles,
				currentOwnerUserId: input.currentOwnerUserId,
				editContextAvailable: Boolean(input.agentProfileEditContext),
			}),
		[
			input.accountProfiles,
			input.agentProfileEditContext,
			input.currentOwnerUserId,
		]
	);
	const editableAgentProfileIds = useMemo(
		() => new Set(editableAgentProfilesById.keys()),
		[editableAgentProfilesById]
	);
	const permissionModeOptionsByProfileId = useMemo(
		() =>
			buildSpacePermissionModeOptions({
				agents: input.membersSnapshot?.agents,
				editableAgentProfileIds,
			}),
		[input.membersSnapshot?.agents, editableAgentProfileIds]
	);
	const pendingItems = useMemo(
		() => [...input.presentedItems, ...input.threadItems],
		[input.presentedItems, input.threadItems]
	);
	const editingProfile = resolveEditingInteractionAgentProfile({
		editableAgentProfilesById,
		profileId: editingProfileId,
	});
	const onPermissionModeUpdate:
		| SpaceAgentPermissionModeUpdateHandler
		| undefined = input.agentProfileEditContext
		? async ({ permissionMode, profileId }) => {
				const context = input.agentProfileEditContext;
				const profile = editableAgentProfilesById.get(profileId);
				const modeOption = permissionModeOptionsByProfileId
					.get(profileId)
					?.find((option) => option.permissionMode === permissionMode);
				if (!(context && profile)) {
					throw new Error(
						"You can no longer edit this Agent's permissions. Refresh and try again."
					);
				}

				return await updateAgentProfileControllerPermissionMode({
					agentControllerPermissionMode: permissionMode,
					context: {
						...context,
						profile,
						queryClient,
					},
				})
					.then((binding) => {
						if (!binding.bindingId) {
							throw new Error(
								"Settings were saved, but OpenMeld could not confirm the updated permissions. Refresh before continuing."
							);
						}
						toast.success(
							`${modeOption?.label ?? "Permission mode"} saved for ${profile.profileName}.`,
							{
								description:
									"It applies after OpenMeld Service syncs. This Wake changes only if the local agent accepts the update live.",
							}
						);
						context.onSaved(profileId).catch((error) => {
							console.error(
								"The Agent permission mode was saved, but the Space could not refresh its Agent facts.",
								{ error, permissionMode, profileId }
							);
						});
						return {
							bindingId: binding.bindingId,
							mode: permissionMode,
						};
					})
					.catch((error) => {
						console.error(
							"The Agent permission update could not be confirmed; its approval is still pending.",
							{ error, permissionMode, profileId }
						);
						toast.error(
							`Couldn't confirm ${modeOption?.label ?? "the permission mode"} for ${profile.profileName}. The request is still waiting for approval.`,
							{
								action: {
									label: "Edit Agent Profile",
									onClick: () => setEditingProfileId(profileId),
								},
							}
						);
						throw error;
					});
			}
		: undefined;
	const surfaceProps: PendingAgentActionSurfaceProps = {
		editableAgentProfileIds,
		items: pendingItems,
		onPermissionModeUpdate,
		onRespond: input.onRespond,
		permissionModeOptionsByProfileId,
	};

	return {
		profileEditDialog:
			editingProfile && input.agentProfileEditContext ? (
				<AgentProfileEditDialogController
					context={input.agentProfileEditContext}
					initialSection="permissions"
					modelCatalog={input.modelCatalog}
					onOpenChange={(open) => {
						if (!open) {
							setEditingProfileId(null);
						}
					}}
					open={true}
					profile={editingProfile}
				/>
			) : null,
		surfaceProps,
	};
}

function buildSpacePermissionModeOptions(input: {
	agents: SpaceMembersSnapshot["agents"] | undefined;
	editableAgentProfileIds: ReadonlySet<string>;
}): ReadonlyMap<string, readonly SpaceAgentPermissionModeOption[]> {
	const options = new Map<string, readonly SpaceAgentPermissionModeOption[]>();
	for (const agent of input.agents ?? []) {
		if (!input.editableAgentProfileIds.has(agent.profileId)) {
			continue;
		}
		const choices = resolveSpacePermissionModeOptions({
			agentControllerPermissionMode: agent.agentControllerPermissionMode,
			agentControllerRef: agent.agentControllerRef,
		});
		if (choices.length > 0) {
			options.set(agent.profileId, choices);
		}
	}
	return options;
}

function resolveEditingInteractionAgentProfile<T>(input: {
	editableAgentProfilesById: ReadonlyMap<string, T>;
	profileId: string | null;
}): T | null {
	if (!input.profileId) {
		return null;
	}
	return input.editableAgentProfilesById.get(input.profileId) ?? null;
}
