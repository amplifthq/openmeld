import type { ListMemberAgentsResponse } from "@openmeld/schemas";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AuthProfileView,
	DaemonServiceLane,
	GetAgentProfilePrimaryBindingResponse,
	LocalRuntimeExecutionTarget,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	isOpenCodeAgentControllerRef,
	openCodePermissionEquals,
} from "#/components/profiles/open-code-permissions-field";
import {
	updateAgentProfilePrimaryBindingAgentControllerCollaborationMode,
	updateAgentProfilePrimaryBindingAgentControllerPermissionMode,
	updateAgentProfilePrimaryBindingModelSelection,
	updateAgentProfilePrimaryBindingOpenCodePermission,
} from "#/lib/profiles/agent-profile-primary-binding";
import {
	ensureWebAgentProfileRuntimeBinding,
	formatWebAgentProfileRuntimeBindingFailure,
} from "#/lib/profiles/agent-profile-runtime-binding";
import { renameOpenMeldProfile } from "#/lib/profiles/rename-profile";
import { refreshWebAgentReadinessFacts } from "#/query/agents/execution-readiness";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import {
	organizationDirectoryQueryFilters,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import {
	agentProfilePrimaryBindingQueryKeys,
	agentProfilePrimaryBindingQueryOptions,
} from "#/query/profiles/primary-binding";
import { startQueryKeys } from "#/query/query-keys";

export type AgentProfileModelSelectionUpdate = {
	modelId: string;
	reasoningLevel: string | null;
};

export type AgentProfileControllerChangeUpdate = {
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	reasoningLevel: string | null;
};

export type AgentProfileEditActionContext = {
	actorProfileId: string | null;
	deviceId: string | null;
	executionTarget: LocalRuntimeExecutionTarget | null;
	onBindingUpdated?: (
		binding: NonNullable<GetAgentProfilePrimaryBindingResponse["binding"]>
	) => void;
	organizationId: string;
	profile: AuthProfileView;
	queryClient: QueryClient;
	runtimeLane: DaemonServiceLane | null;
	storageScope: string;
};

type AgentProfileBindingUpdateResult = {
	binding?: GetAgentProfilePrimaryBindingResponse["binding"];
	status: "accepted" | "rejected";
};

export function formatAgentProfileRuntimeSettingsSavedMessage(
	_profileName: string
): string {
	return "Agent settings saved.";
}

export async function changeAgentProfileController(input: {
	context: AgentProfileEditActionContext;
	update: AgentProfileControllerChangeUpdate;
}) {
	const deviceId =
		input.context.executionTarget?.deviceId ?? input.context.deviceId;
	const runtimeLane =
		input.context.executionTarget?.runtimeLane ?? input.context.runtimeLane;
	if (!(deviceId && runtimeLane)) {
		throw new Error("Connect your computer before changing the local agent.");
	}
	const bindingResult = await ensureWebAgentProfileRuntimeBinding({
		actorProfileId: input.context.actorProfileId,
		agentControllerRef: input.update.agentControllerRef,
		agentProfileId: input.context.profile.openMeldProfileId,
		...(input.update.agentControllerCollaborationMode
			? {
					agentControllerCollaborationMode:
						input.update.agentControllerCollaborationMode,
				}
			: {}),
		...(input.update.agentControllerPermissionMode
			? {
					agentControllerPermissionMode:
						input.update.agentControllerPermissionMode,
				}
			: {}),
		deviceId,
		modelId: input.update.modelId,
		openCodePermission: isOpenCodeAgentControllerRef(
			input.update.agentControllerRef
		)
			? input.update.openCodePermission
			: null,
		organizationId: input.context.organizationId,
		reasoningLevel: input.update.reasoningLevel,
		runtimeLane,
		writeMode: "reconnect",
	});
	if (bindingResult.status !== "accepted") {
		throw new Error(formatWebAgentProfileRuntimeBindingFailure(bindingResult));
	}
	const queryKey = agentProfilePrimaryBindingQueryKeys.profile(
		input.context.storageScope,
		input.context.profile.openMeldProfileId
	);
	await invalidateAgentProfilePrimaryBindingEditQueries({
		queryClient: input.context.queryClient,
		queryKey,
		storageScope: input.context.storageScope,
	});
	const primaryBindingResponse = await input.context.queryClient.fetchQuery(
		agentProfilePrimaryBindingQueryOptions({
			agentProfileId: input.context.profile.openMeldProfileId,
			enabled: true,
			organizationId: input.context.organizationId,
			storageScope: input.context.storageScope,
		})
	);
	if (!primaryBindingResponse.binding) {
		throw new Error(
			"OpenMeld could not load the updated Agent Profile settings."
		);
	}
	await commitAgentProfileBindingUpdate({
		binding: primaryBindingResponse.binding,
		context: input.context,
	});
}

export async function updateAgentProfileControllerCollaborationMode(input: {
	agentControllerCollaborationMode: AgentControllerCollaborationMode;
	context: AgentProfileEditActionContext;
}) {
	await runAgentProfileBindingUpdate({
		context: input.context,
		matchesRequestedBinding: (binding) =>
			binding.agentControllerCollaborationMode ===
			input.agentControllerCollaborationMode,
		update: async () =>
			await updateAgentProfilePrimaryBindingAgentControllerCollaborationMode({
				actorProfileId: input.context.actorProfileId,
				agentControllerCollaborationMode:
					input.agentControllerCollaborationMode,
				agentProfileId: input.context.profile.openMeldProfileId,
				organizationId: input.context.organizationId,
			}),
	});
}

export async function updateAgentProfileControllerPermissionMode(input: {
	agentControllerPermissionMode: AgentControllerPermissionMode;
	context: AgentProfileEditActionContext;
}) {
	return await runAgentProfileBindingUpdate({
		context: input.context,
		matchesRequestedBinding: (binding) =>
			binding.agentControllerPermissionMode ===
			input.agentControllerPermissionMode,
		update: async () =>
			await updateAgentProfilePrimaryBindingAgentControllerPermissionMode({
				actorProfileId: input.context.actorProfileId,
				agentControllerPermissionMode: input.agentControllerPermissionMode,
				agentProfileId: input.context.profile.openMeldProfileId,
				organizationId: input.context.organizationId,
			}),
	});
}

export async function updateAgentProfileModelSelection(input: {
	context: AgentProfileEditActionContext;
	modelSelection: AgentProfileModelSelectionUpdate;
}) {
	await runAgentProfileBindingUpdate({
		context: input.context,
		matchesRequestedBinding: (binding) =>
			binding.modelSelection?.modelId === input.modelSelection.modelId &&
			(binding.modelSelection.reasoningLevel ?? null) ===
				input.modelSelection.reasoningLevel,
		update: async () =>
			await updateAgentProfilePrimaryBindingModelSelection({
				actorProfileId: input.context.actorProfileId,
				agentProfileId: input.context.profile.openMeldProfileId,
				modelId: input.modelSelection.modelId,
				organizationId: input.context.organizationId,
				reasoningLevel: input.modelSelection.reasoningLevel,
			}),
	});
}

export async function updateAgentProfileOpenCodePermission(input: {
	context: AgentProfileEditActionContext;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
}) {
	await runAgentProfileBindingUpdate({
		context: input.context,
		matchesRequestedBinding: (binding) =>
			openCodePermissionEquals(
				binding.openCodePermission ?? null,
				input.openCodePermission
			),
		update: async () =>
			await updateAgentProfilePrimaryBindingOpenCodePermission({
				actorProfileId: input.context.actorProfileId,
				agentProfileId: input.context.profile.openMeldProfileId,
				openCodePermission: input.openCodePermission,
				organizationId: input.context.organizationId,
			}),
	});
}

export async function renameAgentProfile(input: {
	context: AgentProfileEditActionContext;
	profileName: string;
}) {
	const updatedProfile = await renameOpenMeldProfile({
		actorProfileId: input.context.actorProfileId,
		profileId: input.context.profile.openMeldProfileId,
		profileName: input.profileName,
	});
	await Promise.all([
		input.context.queryClient.cancelQueries({
			queryKey: memberAgentQueryKeys.all(input.context.organizationId),
			exact: true,
		}),
		input.context.queryClient.cancelQueries({
			queryKey: startQueryKeys.profilesForStorageScope(
				input.context.storageScope
			),
		}),
		input.context.queryClient.cancelQueries({
			...organizationDirectoryQueryFilters({
				organizationId: input.context.organizationId,
			}),
		}),
	]);
	updateAgentProfileListCaches({
		organizationId: input.context.organizationId,
		profile: updatedProfile,
		queryClient: input.context.queryClient,
		storageScope: input.context.storageScope,
	});
	await Promise.all([
		input.context.queryClient.invalidateQueries({
			queryKey: memberAgentQueryKeys.all(input.context.organizationId),
			exact: true,
			refetchType: "none",
		}),
		input.context.queryClient.invalidateQueries({
			queryKey: startQueryKeys.profilesForStorageScope(
				input.context.storageScope
			),
			refetchType: "none",
		}),
		input.context.queryClient.invalidateQueries({
			...organizationDirectoryQueryFilters({
				organizationId: input.context.organizationId,
			}),
			refetchType: "none",
		}),
	]);
	return updatedProfile;
}

export function updateAgentProfileListCaches(input: {
	organizationId: string;
	profile: AuthProfileView;
	queryClient: QueryClient;
	storageScope: string;
}) {
	input.queryClient.setQueryData<ListMemberAgentsResponse>(
		memberAgentQueryKeys.all(input.organizationId),
		(current) =>
			current
				? {
						...current,
						memberAgents: current.memberAgents.map((agent) => ({
							...agent,
							profiles: agent.profiles.map((profile) =>
								profile.openMeldProfileId === input.profile.openMeldProfileId
									? { ...profile, profileName: input.profile.profileName }
									: profile
							),
						})),
						unassignedProfiles: current.unassignedProfiles.map((profile) =>
							profile.openMeldProfileId === input.profile.openMeldProfileId
								? { ...profile, profileName: input.profile.profileName }
								: profile
						),
					}
				: current
	);
	input.queryClient.setQueriesData<readonly AuthProfileView[]>(
		{
			queryKey: startQueryKeys.profilesForStorageScope(input.storageScope),
		},
		(current) =>
			current?.map((profile) =>
				profile.openMeldProfileId === input.profile.openMeldProfileId
					? input.profile
					: profile
			)
	);
	input.queryClient.setQueryData<OrganizationDirectoryResponse>(
		organizationQueryKeys.directory(input.organizationId),
		(current) =>
			current
				? {
						...current,
						agentProfiles: current.agentProfiles.map((profile) =>
							profile.profileId === input.profile.openMeldProfileId
								? {
										...profile,
										profileHandle: input.profile.profileHandle,
										profileName: input.profile.profileName,
										avatarStyle: input.profile.avatarStyle,
										updatedAt: input.profile.updatedAt,
									}
								: profile
						),
					}
				: current
	);
	input.queryClient.setQueryData<OrganizationProfileDirectoryResponse>(
		organizationQueryKeys.profileDirectory(input.organizationId),
		(current) =>
			current
				? {
						...current,
						agentProfiles: current.agentProfiles.map((profile) =>
							profile.profileId === input.profile.openMeldProfileId
								? {
										...profile,
										profileHandle: input.profile.profileHandle,
										profileName: input.profile.profileName,
										avatarStyle: input.profile.avatarStyle,
										updatedAt: input.profile.updatedAt,
									}
								: profile
						),
					}
				: current
	);
}

export async function invalidateAgentProfilePrimaryBindingEditQueries(input: {
	queryClient: QueryClient;
	queryKey: ReturnType<typeof agentProfilePrimaryBindingQueryKeys.profile>;
	storageScope: string;
}) {
	await input.queryClient.invalidateQueries({ queryKey: input.queryKey });
}

async function runAgentProfileBindingUpdate(input: {
	context: AgentProfileEditActionContext;
	matchesRequestedBinding: (
		binding: NonNullable<GetAgentProfilePrimaryBindingResponse["binding"]>
	) => boolean;
	update: () => Promise<AgentProfileBindingUpdateResult>;
}) {
	const response = await input.update();
	if (response.status !== "accepted" || !response.binding) {
		throw new Error("OpenMeld could not save the Agent Profile settings.");
	}
	if (!input.matchesRequestedBinding(response.binding)) {
		throw new Error(
			"OpenMeld could not verify that the Agent Profile settings were saved. Please try again."
		);
	}
	await commitAgentProfileBindingUpdate({
		binding: response.binding,
		context: input.context,
	});
	return response.binding;
}

async function commitAgentProfileBindingUpdate(input: {
	binding: NonNullable<GetAgentProfilePrimaryBindingResponse["binding"]>;
	context: AgentProfileEditActionContext;
}) {
	const queryKey = agentProfilePrimaryBindingQueryKeys.profile(
		input.context.storageScope,
		input.context.profile.openMeldProfileId
	);
	// A read started before the write must not overwrite its acknowledged result.
	await input.context.queryClient.cancelQueries({ queryKey });
	input.context.queryClient.setQueryData<GetAgentProfilePrimaryBindingResponse>(
		queryKey,
		{
			binding: input.binding,
			grantsClaimSuccess: false,
			status: "found",
		}
	);
	input.context.onBindingUpdated?.(input.binding);
	// The mutation response proves the save. Refreshing other views must neither
	// hold the editor open nor turn a committed write into a reported failure.
	Promise.all([
		invalidateAgentProfilePrimaryBindingEditQueries({
			queryClient: input.context.queryClient,
			queryKey,
			storageScope: input.context.storageScope,
		}),
		refreshWebAgentReadinessFacts({
			agentProfileIds: [input.context.profile.openMeldProfileId],
			organizationId: input.context.organizationId,
			queryClient: input.context.queryClient,
			storageScope: input.context.storageScope,
		}),
	]).catch((error: unknown) => {
		console.error(
			"Agent settings were saved, but their refresh failed.",
			error
		);
		toast.warning(
			"Settings saved. Refresh the page to reload the latest status."
		);
	});
}
