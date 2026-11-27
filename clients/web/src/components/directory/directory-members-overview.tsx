"use client";

import type {
	ModelCatalog,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ComponentProps, useRef, useState } from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import {
	type CurrentOrganizationComputerServiceState,
	resolveOrganizationComputerGroups,
} from "#/components/computers/organization-computers";
import {
	buildDirectoryAgentProfilesByOwner,
	buildOrganizationHumanProfileRows,
	buildPersonalHumanProfileRows,
	type DirectoryDocumentsStatus,
	type DirectoryProjectionStatus,
	resolveCurrentOrganizationComputersProjection,
	resolveMissingPersonalHumanProfileMessage,
} from "#/components/directory/directory-human-profile-model";
import {
	type DirectoryHumanProfilesViewState,
	DirectoryHumanProfilesWorkspace,
} from "#/components/directory/directory-human-profiles-workspace";
import { OrganizationInviteDialog } from "#/components/organizations/organization-invite-dialog";
import {
	isCurrentLocalRuntimeServiceDisconnected,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/computer-summary-status";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationPersonPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { messageChannelListQueryOptions } from "#/query/organizations/message-channels";
import {
	organizationComputersQueryOptions,
	organizationMemberRoleQueryOptions,
} from "#/query/organizations/organization-directory";
import { organizationDocumentsQueryOptions } from "#/query/organizations/organization-documents";
import {
	isAdditionalHumanProfileCreationEnabled,
	profileCapabilitiesQueryOptions,
} from "#/query/profiles/profile-capabilities";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { DirectoryMemberRemoval } from "./directory-member-removal";

type DirectoryQueryState = {
	data?: OrganizationProfileDirectoryResponse | OrganizationDirectoryResponse;
	error: { message?: string } | null;
	isError: boolean;
	isPending: boolean;
};

type HumanDirectMessageIntent = {
	organizationId: string;
	organizationSlug: string;
	targetProfileId: string;
};

type LocalAgentRecoveryController = ReturnType<
	typeof useLocalAgentRecoveryController
>;

type DirectoryMembersOverviewProps = {
	account: AppShellAccount;
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	directoryQuery: DirectoryQueryState;
	focusProfileId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	modelCatalog?: ModelCatalog | null;
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	recovery: LocalAgentRecoveryController;
	storageScope: string;
};

function resolveHumanProfilesViewState(input: {
	directMessageIsPending: boolean;
	isPersonalWorkspace: boolean;
	profilesArePending: boolean;
}): DirectoryHumanProfilesViewState {
	return {
		context: input.isPersonalWorkspace ? "personal" : "organization",
		directMessage: input.directMessageIsPending ? "pending" : "idle",
		profiles: input.profilesArePending ? "loading" : "ready",
	};
}

export function DirectoryMembersOverview(input: DirectoryMembersOverviewProps) {
	const model = useDirectoryMembersOverviewModel(input);
	return <DirectoryMembersOverviewView model={model} />;
}

function useDirectoryMembersOverviewModel(
	input: DirectoryMembersOverviewProps
) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const directMessageIntentInFlightRef = useRef(false);
	const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
	const profileCapabilitiesQuery = useQuery(profileCapabilitiesQueryOptions());
	const canCreateHumanProfile = isAdditionalHumanProfileCreationEnabled(
		profileCapabilitiesQuery
	);
	const isPersonalWorkspace = input.currentOrganization.isPersonal === true;
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !isPersonalWorkspace,
			organizationId: input.currentOrganization.id,
			userId: input.currentUserId,
		})
	);
	const canInvite = canManageOrganizationArea(roleQuery.data, {
		invitation: ["create"],
	});
	const canManageConnectedAccounts = canManageOrganizationArea(roleQuery.data, {
		channel: ["disconnect"],
	});
	const canManageMessageChannels = canManageOrganizationArea(roleQuery.data, {
		channel: ["connect"],
	});
	const directMessageMutation = useMutation({
		mutationFn: async (intent: HumanDirectMessageIntent) =>
			await openCurrentDirectMessageSpace({
				organizationId: intent.organizationId,
				targetProfileId: intent.targetProfileId,
			}),
		onError: (error) => {
			console.error("Failed to open Human Profile Direct Message.", error);
			toast.error(resolveDirectMessageOpenErrorMessage(error));
		},
		onSuccess: async (response, intent) => {
			await queryClient.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			await navigate({
				to: buildOrganizationDirectMessagePath({
					orgSlug: intent.organizationSlug,
					search: { profileId: response.memberProfileId },
					spaceId: response.spaceId,
				}),
			});
		},
	});
	const openHumanDirectMessage = async (targetProfileId: string) => {
		if (directMessageIntentInFlightRef.current) {
			return;
		}
		directMessageIntentInFlightRef.current = true;
		try {
			await directMessageMutation.mutateAsync({
				organizationId: input.currentOrganization.id,
				organizationSlug: input.currentOrganization.slug,
				targetProfileId,
			});
		} finally {
			directMessageIntentInFlightRef.current = false;
		}
	};
	const computersQuery = useQuery(
		organizationComputersQueryOptions({
			enabled: true,
			organizationId: input.currentOrganization.id,
		})
	);
	const messageChannelsQuery = useQuery({
		...messageChannelListQueryOptions({
			organizationId: input.currentOrganization.id,
		}),
		enabled: !isPersonalWorkspace,
	});
	const documentsQuery = useQuery(
		organizationDocumentsQueryOptions({
			enabled: true,
			organizationId: input.currentOrganization.id,
		})
	);
	const personalProfilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: isPersonalWorkspace,
			storageScope: input.storageScope,
		})
	);
	const documentsStatus = resolveDirectoryDocumentsStatus({
		isError: documentsQuery.isError,
		isSuccess: documentsQuery.isSuccess,
	});
	const { data: organizationComputers, status: computersStatus } =
		resolveCurrentOrganizationComputersProjection(computersQuery);
	const currentUserInventoryStatus = resolveDirectoryProjectionStatus(
		input.recovery.localRuntimesQuery
	);
	const currentComputerServiceProjection =
		resolveCurrentComputerServiceProjection({
			computersStatus,
			inventoryStatus: currentUserInventoryStatus,
			readinessQuery: input.recovery.currentLocalRuntimeReplyReadinessQuery,
		});
	const messageChannelsStatus =
		resolveDirectoryProjectionStatus(messageChannelsQuery);
	const { computerGroups, strictComputerGroups } =
		resolveDirectoryComputerGroups({
			currentComputerServiceState:
				currentComputerServiceProjection.serviceState,
			currentUserId: input.currentUserId,
			directory: input.directoryQuery.data ?? null,
			organizationComputers: computersQuery.data ?? null,
			ownedComputers:
				input.recovery.localRuntimesQuery.data?.localRuntimes ?? [],
			strictOrganizationComputers: organizationComputers,
		});
	const memberRows = isPersonalWorkspace
		? buildPersonalHumanProfileRows({
				agentProfileSummaries: buildDirectoryAgentProfilesByOwner({
					members: input.directoryQuery.data?.members ?? [],
					agentProfiles: input.directoryQuery.data?.agentProfiles ?? [],
					orgSlug: input.currentOrganization.slug,
				}).get(input.currentUserId),
				account: input.account,
				canCreateHumanProfile,
				computers: computersQuery.data ?? null,
				computersStatus,
				documents: documentsQuery.data?.documents ?? [],
				documentsStatus,
				orgSlug: input.currentOrganization.slug,
				profiles: personalProfilesQuery.data ?? [],
				subjectUserId: input.currentUserId,
			})
		: buildOrganizationHumanProfileRows({
				agentProfiles: input.directoryQuery.data?.agentProfiles ?? [],
				canManageConnectedAccounts,
				canManageMessageChannels,
				computerGroups: strictComputerGroups,
				computersStatus,
				currentUserComputersStatus: currentComputerServiceProjection.status,
				currentUserId: input.currentUserId,
				documents: documentsQuery.data?.documents ?? [],
				documentsStatus,
				messageChannels: messageChannelsQuery.data ?? null,
				messageChannelsStatus,
				members: input.directoryQuery.data?.members ?? [],
				orgSlug: input.currentOrganization.slug,
			});
	const profilesArePending = isPersonalWorkspace
		? personalProfilesQuery.isPending
		: input.directoryQuery.isPending;
	const profilesError = resolveHumanProfilesError({
		directoryErrorMessage: input.directoryQuery.error?.message,
		directoryFailed: input.directoryQuery.isError,
		isPersonalWorkspace,
		personalProfilesFailed: personalProfilesQuery.isError,
	});
	const profilesEmptyMessage = isPersonalWorkspace
		? resolveMissingPersonalHumanProfileMessage(canCreateHumanProfile)
		: "No members appear in this organization yet.";
	const profilesViewState = resolveHumanProfilesViewState({
		directMessageIsPending: directMessageMutation.isPending,
		isPersonalWorkspace,
		profilesArePending,
	});
	const selectedProfileId = input.focusProfileId;
	const workspaceProps: ComponentProps<typeof DirectoryHumanProfilesWorkspace> =
		{
			canCreateProfile: canCreateHumanProfile,
			computerGroups,
			directoryError: computersQuery.isError
				? "OpenMeld couldn't load this member's computers."
				: null,
			directoryIsPending: computersQuery.isPending,
			emptyMessage: profilesEmptyMessage,
			errorMessage: profilesError,
			initialSidebarStates: input.initialSidebarStates,
			memberActions: (
				<DirectoryMemberRemoval
					directoryQuery={input.directoryQuery}
					organization={input.currentOrganization}
					profileId={selectedProfileId}
					roleQuery={roleQuery}
					userId={input.currentUserId}
				/>
			),
			members: memberRows,
			onCreateProfile: input.onCreateProfile,
			onOpenDirectMessage: openHumanDirectMessage,
			organizationId: input.currentOrganization.id,
			onSelectProfile: (profileId) => {
				if (profileId === selectedProfileId) {
					return;
				}
				navigate({
					to: buildOrganizationPersonPath({
						orgSlug: input.currentOrganization.slug,
						personId: profileId,
					}),
				}).catch((error: unknown) => {
					console.error("Failed to open the selected Human Profile.", error);
				});
			},
			orgSlug: input.currentOrganization.slug,
			recovery: input.recovery,
			selectedProfileId,
			state: profilesViewState,
			strictComputerGroups,
		};
	return {
		canInvite: isPersonalWorkspace || canInvite,
		isInviteDialogOpen,
		onInviteDialogOpenChange: setIsInviteDialogOpen,
		workspaceProps,
	};
}

function resolveDirectoryComputerGroups(
	input: Parameters<typeof resolveOrganizationComputerGroups>[0] & {
		strictOrganizationComputers: ReturnType<
			typeof resolveCurrentOrganizationComputersProjection
		>["data"];
	}
) {
	// Read-only Agent logos retain the last success; status and detail actions
	// use only the current projection when the latest request fails.
	const computerGroups = resolveOrganizationComputerGroups(input);
	const strictComputerGroups =
		input.organizationComputers === input.strictOrganizationComputers
			? computerGroups
			: resolveOrganizationComputerGroups({
					...input,
					organizationComputers: input.strictOrganizationComputers,
				});
	return { computerGroups, strictComputerGroups };
}

function DirectoryMembersOverviewView(input: {
	model: ReturnType<typeof useDirectoryMembersOverviewModel>;
}) {
	return (
		<>
			<DirectoryHumanProfilesWorkspace
				{...input.model.workspaceProps}
				onInviteMembers={
					input.model.canInvite
						? () => input.model.onInviteDialogOpenChange(true)
						: undefined
				}
			/>
			{input.model.isInviteDialogOpen ? (
				<OrganizationInviteDialog
					onOpenChange={input.model.onInviteDialogOpenChange}
					open={input.model.isInviteDialogOpen}
				/>
			) : null}
		</>
	);
}

function resolveDirectoryProjectionStatus(input: {
	isError: boolean;
	isPending: boolean;
}): DirectoryProjectionStatus {
	if (input.isPending) {
		return "loading";
	}
	return input.isError ? "failed" : "ready";
}

function resolveDirectoryDocumentsStatus(input: {
	isError: boolean;
	isSuccess: boolean;
}): DirectoryDocumentsStatus {
	if (input.isSuccess) {
		return "ready";
	}
	if (input.isError) {
		return "failed";
	}
	return "loading";
}

function resolveCurrentUserComputersStatus(input: {
	computersStatus: DirectoryProjectionStatus;
	hasReadinessSnapshot: boolean;
	inventoryStatus: DirectoryProjectionStatus;
	readinessNeedsReconciliation: boolean;
}): DirectoryProjectionStatus {
	if (input.inventoryStatus !== "ready") {
		return input.inventoryStatus;
	}
	if (input.readinessNeedsReconciliation && !input.hasReadinessSnapshot) {
		return "loading";
	}
	return input.hasReadinessSnapshot ? "ready" : input.computersStatus;
}

function resolveCurrentComputerServiceProjection(input: {
	computersStatus: DirectoryProjectionStatus;
	inventoryStatus: DirectoryProjectionStatus;
	readinessQuery: LocalAgentRecoveryController["currentLocalRuntimeReplyReadinessQuery"];
}): {
	serviceState: CurrentOrganizationComputerServiceState | null;
	status: DirectoryProjectionStatus;
} {
	const readiness = input.readinessQuery.data ?? null;
	const serviceDisconnected = readiness
		? isCurrentLocalRuntimeServiceDisconnected(readiness)
		: false;
	const deviceId = resolveCurrentLocalRuntimeSubjectDeviceId(readiness);
	const serviceState =
		readiness && deviceId
			? {
					deviceId,
					state: serviceDisconnected
						? ("not_connected" as const)
						: ("connected" as const),
				}
			: null;
	return {
		serviceState,
		status: resolveCurrentUserComputersStatus({
			computersStatus: input.computersStatus,
			hasReadinessSnapshot: serviceState !== null,
			inventoryStatus: input.inventoryStatus,
			readinessNeedsReconciliation:
				input.readinessQuery.isFetching && !serviceDisconnected,
		}),
	};
}

function resolveHumanProfilesError(input: {
	directoryErrorMessage: string | undefined;
	directoryFailed: boolean;
	isPersonalWorkspace: boolean;
	personalProfilesFailed: boolean;
}): string | null {
	if (input.isPersonalWorkspace) {
		return input.personalProfilesFailed
			? "OpenMeld could not load people right now."
			: null;
	}
	if (!input.directoryFailed) {
		return null;
	}
	return (
		input.directoryErrorMessage ??
		"OpenMeld could not load people in this organization right now."
	);
}
