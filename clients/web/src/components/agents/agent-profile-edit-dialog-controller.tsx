"use client";

import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AuthProfileView,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { agentProfilePrimaryBindingQueryOptions } from "#/query/profiles/primary-binding";
import {
	type AgentProfileControllerChangeUpdate,
	type AgentProfileEditActionContext,
	type AgentProfileModelSelectionUpdate,
	changeAgentProfileController,
	formatAgentProfileRuntimeSettingsSavedMessage,
	renameAgentProfile,
	updateAgentProfileControllerCollaborationMode,
	updateAgentProfileControllerPermissionMode,
	updateAgentProfileModelSelection,
	updateAgentProfileOpenCodePermission,
} from "./agent-profile-edit-actions";
import {
	AgentProfileEditDialog,
	resolveAgentProfileControllerChangeOptions,
	resolveAgentProfileEditState,
} from "./agents-page-agent-profiles-card";
import { formatMutationError } from "./agents-page-formatters";

export type AgentProfileEditDialogContext = Omit<
	AgentProfileEditActionContext,
	"profile" | "queryClient"
> & {
	onSaved: (profileId: string) => Promise<void>;
};

export function AgentProfileEditDialogController(input: {
	context: AgentProfileEditDialogContext;
	modelCatalog: ModelCatalog | null;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	profile: AuthProfileView;
}) {
	const queryClient = useQueryClient();
	const [isPending, setIsPending] = useState(false);
	const bindingQuery = useQuery(
		agentProfilePrimaryBindingQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: input.open,
			storageScope: input.context.storageScope,
		})
	);
	const binding = bindingQuery.data?.binding ?? null;
	const editState = resolveAgentProfileEditState({
		binding,
		modelCatalog: input.modelCatalog,
	});
	const controllerChangeOptions = resolveAgentProfileControllerChangeOptions(
		input.context.executionTarget
	);
	const editActionContext: AgentProfileEditActionContext = {
		...input.context,
		profile: input.profile,
		queryClient,
	};
	const runEditAction = async (
		action: () => Promise<void>,
		errorMessage: string,
		successMessage = formatAgentProfileRuntimeSettingsSavedMessage(
			input.profile.profileName
		)
	) => {
		setIsPending(true);
		let updateError: unknown = null;
		try {
			await action();
			toast.success(successMessage);
		} catch (error) {
			updateError = error;
			toast.error(formatMutationError(error, errorMessage));
		} finally {
			setIsPending(false);
		}
		if (updateError) {
			return Promise.reject(updateError);
		}
	};
	const handleControllerChange = async (
		update: AgentProfileControllerChangeUpdate
	) =>
		await runEditAction(
			async () =>
				await changeAgentProfileController({
					context: editActionContext,
					update,
				}),
			`OpenMeld could not change the controller for ${input.profile.profileName}.`
		);
	const handleControllerCollaborationModeUpdate = async (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) =>
		await runEditAction(
			async () =>
				await updateAgentProfileControllerCollaborationMode({
					agentControllerCollaborationMode,
					context: editActionContext,
				}),
			`OpenMeld could not update ${input.profile.profileName}.`
		);
	const handleControllerPermissionModeUpdate = async (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) =>
		await runEditAction(
			async () =>
				await updateAgentProfileControllerPermissionMode({
					agentControllerPermissionMode,
					context: editActionContext,
				}),
			`OpenMeld could not update ${input.profile.profileName}.`
		);
	const handleModelSelectionUpdate = async (
		modelSelection: AgentProfileModelSelectionUpdate
	) =>
		await runEditAction(
			async () =>
				await updateAgentProfileModelSelection({
					context: editActionContext,
					modelSelection,
				}),
			`OpenMeld could not update ${input.profile.profileName}.`
		);
	const handleOpenCodePermissionUpdate = async (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) =>
		await runEditAction(
			async () =>
				await updateAgentProfileOpenCodePermission({
					context: editActionContext,
					openCodePermission,
				}),
			`OpenMeld could not update the OpenCode permissions for ${input.profile.profileName}.`
		);
	const handleRenameProfile = async (profileName: string) =>
		await runEditAction(
			async () => {
				await renameAgentProfile({
					context: editActionContext,
					profileName,
				});
			},
			`OpenMeld could not rename ${input.profile.profileName}.`,
			`Agent renamed to ${profileName}.`
		);

	return (
		<AgentProfileEditDialog
			controllerChangeOptions={controllerChangeOptions}
			editState={editState}
			isLoading={input.open && bindingQuery.isPending}
			isPending={isPending}
			loadErrorMessage={
				input.open && bindingQuery.isError
					? "OpenMeld could not load this Agent's settings. Close this dialog and try again."
					: null
			}
			modelCatalog={input.modelCatalog}
			onControllerChange={handleControllerChange}
			onControllerCollaborationModeUpdate={
				handleControllerCollaborationModeUpdate
			}
			onControllerPermissionModeUpdate={handleControllerPermissionModeUpdate}
			onModelSelectionUpdate={handleModelSelectionUpdate}
			onOpenChange={input.onOpenChange}
			onOpenCodePermissionUpdate={handleOpenCodePermissionUpdate}
			onRenameProfile={handleRenameProfile}
			onSaveComplete={async () => {
				try {
					await input.context.onSaved(input.profile.openMeldProfileId);
				} catch (error) {
					console.error(
						"Agent Profile was saved, but current views could not be refreshed.",
						error
					);
					toast.error(
						"The Agent was saved, but OpenMeld could not refresh the latest settings. Refresh the page to see them."
					);
				}
			}}
			open={input.open}
			profileName={input.profile.profileName}
		/>
	);
}
