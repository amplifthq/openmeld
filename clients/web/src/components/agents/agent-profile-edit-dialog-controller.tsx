"use client";

import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AuthProfileView,
	ModelCatalog,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { MemberAgentHarnessLock } from "#/components/member-agents/member-agent-harness-lock";
import {
	agentProfileControllerChangeEligibilityQueryOptions,
	agentProfilePrimaryBindingQueryOptions,
} from "#/query/profiles/primary-binding";
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
	resolveAgentProfileControllerChangeOptions,
	resolveAgentProfileEditState,
} from "./agent-profile-edit-state";
import {
	AgentProfileConfigurationOverview,
	AgentProfileEditDialog,
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
	initialSection?: "permissions";
	modelCatalog: ModelCatalog | null;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	profile: AuthProfileView;
}) {
	const controller = useAgentProfileEditController({
		context: input.context,
		enabled: input.open,
		modelCatalog: input.modelCatalog,
		profile: input.profile,
	});

	return (
		<MemberAgentHarnessLock profileId={input.profile.openMeldProfileId}>
			<AgentProfileEditDialog
				controllerChangeEligibilityStatus={
					controller.controllerChangeEligibilityStatus
				}
				controllerChangeOptions={controller.controllerChangeOptions}
				editState={controller.editState}
				initialSection={input.initialSection}
				isLoading={input.open && controller.isLoading}
				isPending={controller.isPending}
				loadErrorMessage={
					input.open && controller.isError
						? "OpenMeld could not load this Agent's settings. Close this dialog and try again."
						: null
				}
				modelCatalog={input.modelCatalog}
				onControllerChange={controller.onControllerChange}
				onControllerCollaborationModeUpdate={
					controller.onControllerCollaborationModeUpdate
				}
				onControllerPermissionModeUpdate={
					controller.onControllerPermissionModeUpdate
				}
				onModelSelectionUpdate={controller.onModelSelectionUpdate}
				onOpenChange={input.onOpenChange}
				onOpenCodePermissionUpdate={controller.onOpenCodePermissionUpdate}
				onRenameProfile={controller.onRenameProfile}
				onSaveComplete={async () => undefined}
				open={input.open}
				profileName={input.profile.profileName}
			/>
		</MemberAgentHarnessLock>
	);
}

export function AgentProfileInlineConfigurationController(input: {
	context: AgentProfileEditDialogContext;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	modelCatalog: ModelCatalog | null;
	ownerEntry: SpaceMemberDirectoryEntry | null;
	profile: AuthProfileView;
}) {
	const controller = useAgentProfileEditController({
		context: input.context,
		enabled: true,
		modelCatalog: input.modelCatalog,
		profile: input.profile,
	});
	if (controller.isLoading) {
		return (
			<div className="rounded-lg border border-border bg-muted/20 px-3 py-4 text-muted-foreground text-sm">
				Loading Agent settings…
			</div>
		);
	}
	if (controller.isError) {
		return (
			<div
				className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-destructive text-sm"
				role="alert"
			>
				OpenMeld could not load this Agent’s settings. Close this profile and
				try again.
			</div>
		);
	}
	return (
		<MemberAgentHarnessLock profileId={input.profile.openMeldProfileId}>
			<AgentProfileConfigurationOverview
				compact
				controllerChangeEligibilityStatus={
					controller.controllerChangeEligibilityStatus
				}
				controllerChangeOptions={controller.controllerChangeOptions}
				controllerDisplayName={input.entry.controllerDisplayName}
				controllerModelSummary={
					resolveDetailsValue(input.details, "model") ??
					input.entry.controllerDisplayName ??
					"No Controller connected"
				}
				details={input.details}
				disabled={controller.isPending}
				editState={controller.editState}
				modelCatalog={input.modelCatalog}
				modelCompatibilityContext={null}
				onControllerChange={controller.onControllerChange}
				onControllerCollaborationModeUpdate={
					controller.onControllerCollaborationModeUpdate
				}
				onControllerPermissionModeUpdate={
					controller.onControllerPermissionModeUpdate
				}
				onModelSelectionUpdate={controller.onModelSelectionUpdate}
				onOpenCodePermissionUpdate={controller.onOpenCodePermissionUpdate}
				onRenameProfile={controller.onRenameProfile}
				ownerAvatarUrl={input.ownerEntry?.avatarUrl}
				ownerProfileId={input.ownerEntry?.profileId}
				runtime={null}
				showHeading={false}
			/>
		</MemberAgentHarnessLock>
	);
}

function useAgentProfileEditController(input: {
	context: AgentProfileEditDialogContext;
	enabled: boolean;
	modelCatalog: ModelCatalog | null;
	profile: AuthProfileView;
}) {
	const queryClient = useQueryClient();
	const [isPending, setIsPending] = useState(false);
	const bindingQuery = useQuery(
		agentProfilePrimaryBindingQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: input.enabled,
			organizationId: input.context.organizationId,
			storageScope: input.context.storageScope,
		})
	);
	const controllerChangeEligibilityQuery = useQuery(
		agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: input.enabled,
			organizationId: input.context.organizationId,
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
			input.context
				.onSaved(input.profile.openMeldProfileId)
				.catch((error: unknown) => {
					console.error(
						"Agent Profile was saved, but current views could not be refreshed.",
						error
					);
					toast.warning(
						"The Agent was saved, but OpenMeld could not refresh the latest settings. Refresh the page to see them."
					);
				});
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
		await runEditAction(async () => {
			await updateAgentProfileControllerPermissionMode({
				agentControllerPermissionMode,
				context: editActionContext,
			});
		}, `OpenMeld could not update ${input.profile.profileName}.`);
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

	return {
		controllerChangeEligibilityStatus:
			controllerChangeEligibilityQuery.data?.status ?? "unavailable",
		controllerChangeOptions,
		editState,
		isError: bindingQuery.isError,
		isLoading: bindingQuery.isPending,
		isPending,
		onControllerChange: handleControllerChange,
		onControllerCollaborationModeUpdate:
			handleControllerCollaborationModeUpdate,
		onControllerPermissionModeUpdate: handleControllerPermissionModeUpdate,
		onModelSelectionUpdate: handleModelSelectionUpdate,
		onOpenCodePermissionUpdate: handleOpenCodePermissionUpdate,
		onRenameProfile: handleRenameProfile,
	};
}

function resolveDetailsValue(
	details: ProfileDetailsSnapshot,
	fieldId: string
): string | null {
	for (const section of details.sections) {
		const row = section.rows.find((candidate) => candidate.id === fieldId);
		if (row) {
			return row.value;
		}
	}
	return null;
}
