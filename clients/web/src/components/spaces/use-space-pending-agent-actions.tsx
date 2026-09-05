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
	SpaceAgentPermissionModeShortcut,
	SpaceAgentPermissionModeUpdateHandler,
} from "./space-agent-interaction-card";
import { buildEditableSpaceAgentProfilesById } from "./space-agent-profile-edit-access";
import { resolveSpacePermissionModeShortcut } from "./space-pending-agent-action-model";
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
	const permissionModeShortcutsByProfileId = useMemo(
		() =>
			buildSpacePermissionModeShortcuts({
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
		? ({ permissionMode, profileId }) => {
				const context = input.agentProfileEditContext;
				const profile = editableAgentProfilesById.get(profileId);
				const shortcut = permissionModeShortcutsByProfileId.get(profileId);
				if (!(context && profile)) {
					return;
				}

				updateAgentProfileControllerPermissionMode({
					agentControllerPermissionMode: permissionMode,
					context: {
						...context,
						profile,
						queryClient,
					},
				})
					.then(() => {
						toast.success(
							`${shortcut?.label ?? "Permission mode"} saved for ${profile.profileName}.`,
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
					})
					.catch((error) => {
						console.error(
							"The Agent interaction was approved, but its permission mode could not be saved.",
							{ error, permissionMode, profileId }
						);
						toast.error(
							`The request was approved, but ${shortcut?.label ?? "the permission mode"} wasn't saved for ${profile.profileName}.`,
							{
								action: {
									label: "Edit Agent Profile",
									onClick: () => setEditingProfileId(profileId),
								},
							}
						);
					});
			}
		: undefined;
	const surfaceProps: PendingAgentActionSurfaceProps = {
		items: pendingItems,
		onPermissionModeUpdate,
		onRespond: input.onRespond,
		permissionModeShortcutsByProfileId,
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

function buildSpacePermissionModeShortcuts(input: {
	agents: SpaceMembersSnapshot["agents"] | undefined;
	editableAgentProfileIds: ReadonlySet<string>;
}): ReadonlyMap<string, SpaceAgentPermissionModeShortcut> {
	const shortcuts = new Map<string, SpaceAgentPermissionModeShortcut>();
	for (const agent of input.agents ?? []) {
		if (!input.editableAgentProfileIds.has(agent.profileId)) {
			continue;
		}
		const shortcut = resolveSpacePermissionModeShortcut({
			agentControllerPermissionMode: agent.agentControllerPermissionMode,
			agentControllerRef: agent.agentControllerRef,
		});
		if (shortcut) {
			shortcuts.set(agent.profileId, shortcut);
		}
	}
	return shortcuts;
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
