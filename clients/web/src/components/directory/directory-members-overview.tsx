"use client";

import type {
	CenterAgentMemberResearchBatch,
	MessageChannelProvider,
	ModelCatalog,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type ComponentProps,
	type FormEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import {
	type CurrentOrganizationComputerServiceState,
	resolveOrganizationComputerGroups,
} from "#/components/computers/organization-computers";
import {
	buildOrganizationHumanProfileRows,
	buildPersonalHumanProfileRows,
	type DirectoryDocumentsStatus,
	type DirectoryProjectionStatus,
	resolveMissingPersonalHumanProfileMessage,
} from "#/components/directory/directory-human-profile-model";
import {
	type DirectoryHumanProfilesViewState,
	DirectoryHumanProfilesWorkspace,
	type DirectoryMemberResearchRequest,
} from "#/components/directory/directory-human-profiles-workspace";
import { OrganizationInviteLink } from "#/components/organizations/organization-invite-link";
import { PersonalWorkspaceInvitationGuidance } from "#/components/organizations/personal-workspace-invitation-guidance";
import {
	isCurrentLocalRuntimeServiceDisconnected,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/computer-summary-status";
import {
	inviteOrganizationMember,
	type OrganizationInviteRole,
} from "#/lib/organizations/auth-organizations";
import {
	disconnectCurrentMessageChannelIdentityLink,
	requestCurrentOrganizationMessageChannelSetup,
	resolveMessageChannelErrorMessage,
} from "#/lib/organizations/message-channels";
import {
	resolveOrganizationDocumentErrorMessage,
	startCurrentCenterAgentMemberResearch,
} from "#/lib/organizations/organization-documents";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationNewOrganizationPath,
	buildOrganizationPeoplePath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import {
	centerAgentMemberResearchQueryKeys,
	centerAgentMemberResearchStatusQueryOptions,
} from "#/query/organizations/center-agent-member-research";
import {
	messageChannelListQueryOptions,
	messageChannelQueryKeys,
} from "#/query/organizations/message-channels";
import {
	organizationComputersQueryOptions,
	organizationMemberRoleQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import {
	organizationDocumentQueryKeys,
	organizationDocumentsQueryOptions,
} from "#/query/organizations/organization-documents";
import {
	isAdditionalHumanProfileCreationEnabled,
	profileCapabilitiesQueryOptions,
} from "#/query/profiles/profile-capabilities";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

const INVITE_ROLE_OPTIONS = [
	{ label: "Member", value: "member" },
	{ label: "Admin", value: "admin" },
] as const satisfies readonly {
	label: string;
	value: OrganizationInviteRole;
}[];

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
	runtimeOverview?: OrganizationAgentRuntimeOverviewResponse;
	storageScope: string;
};

type DirectoryInvitationAccess =
	| { kind: "allowed" }
	| { kind: "forbidden" }
	| { kind: "loading" }
	| { kind: "personal" }
	| { kind: "unavailable" };

const PROFILE_REPORT_DOCUMENTS_ERROR_MESSAGE =
	"Report links are unavailable because Documents could not be loaded.";

function useDirectoryMemberResearch(organizationId: string) {
	const queryClient = useQueryClient();
	const memberResearchQuery = useQuery(
		centerAgentMemberResearchStatusQueryOptions({ organizationId })
	);
	const activeResearchBatch = resolveActiveResearchBatch(
		memberResearchQuery.data?.latestBatch ?? null
	);
	const documentsQuery = useQuery({
		...organizationDocumentsQueryOptions({
			enabled: true,
			organizationId,
		}),
		refetchInterval: activeResearchBatch ? 2000 : false,
	});
	const researchMutation = useMutation({
		mutationFn: async (request: DirectoryMemberResearchRequest) =>
			await startCurrentCenterAgentMemberResearch({
				...request,
				expectedOrganizationId: organizationId,
			}),
		onSuccess: (response) => {
			queryClient.setQueryData(
				centerAgentMemberResearchQueryKeys.status(organizationId),
				{
					latestBatch: response.batch,
					organizationId,
				}
			);
			queryClient
				.invalidateQueries({
					queryKey: organizationDocumentQueryKeys.list(organizationId),
				})
				.catch((error: unknown) =>
					reportMemberResearchDocumentRefreshFailure({ error, organizationId })
				);
		},
	});
	const latestResearchBatch = memberResearchQuery.data?.latestBatch ?? null;
	const observedResearchBatchRef = useRef<{
		id: string;
		status: CenterAgentMemberResearchBatch["status"];
	} | null>(null);
	const completedResearchBatchId =
		latestResearchBatch?.status === "completed" ? latestResearchBatch.id : null;
	useEffect(() => {
		if (!completedResearchBatchId) {
			return;
		}
		queryClient
			.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.list(organizationId),
			})
			.catch((error: unknown) =>
				reportMemberResearchDocumentRefreshFailure({ error, organizationId })
			);
	}, [completedResearchBatchId, organizationId, queryClient]);
	useEffect(() => {
		if (!latestResearchBatch) {
			return;
		}
		const previous = observedResearchBatchRef.current;
		observedResearchBatchRef.current = {
			id: latestResearchBatch.id,
			status: latestResearchBatch.status,
		};
		if (
			previous?.id === latestResearchBatch.id &&
			(previous.status === "queued" || previous.status === "running") &&
			latestResearchBatch.status === "completed"
		) {
			showMemberResearchCompletionToast(latestResearchBatch);
		}
	}, [latestResearchBatch]);

	return {
		activeResearchBatch,
		documentsQuery,
		latestResearchBatch,
		memberResearchQuery,
		researchMutation,
	};
}

function reportMemberResearchDocumentRefreshFailure(input: {
	error: unknown;
	organizationId: string;
}): void {
	console.warn("[web.center_agent_member_research.document_refresh_failed]", {
		error: input.error,
		organizationId: input.organizationId,
	});
}

function resolveHumanProfilesViewState(input: {
	directMessageIsPending: boolean;
	isPersonalWorkspace: boolean;
	profilesArePending: boolean;
	researchIsPending: boolean;
}): DirectoryHumanProfilesViewState {
	return {
		context: input.isPersonalWorkspace ? "personal" : "organization",
		directMessage: input.directMessageIsPending ? "pending" : "idle",
		profiles: input.profilesArePending ? "loading" : "ready",
		research: input.researchIsPending ? "pending" : "idle",
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
	const disconnectConnectedAccountMutation = useMutation({
		mutationFn: async (identityLinkId: string) =>
			await disconnectCurrentMessageChannelIdentityLink({
				identityLinkId,
				organizationId: input.currentOrganization.id,
			}),
		onError: (error) => {
			console.error("Failed to disconnect Message Channel account.", error);
			toast.error(
				resolveMessageChannelErrorMessage(
					error,
					"OpenMeld could not disconnect this account. Try again."
				)
			);
		},
		onSuccess: (response) => {
			queryClient.setQueryData(
				messageChannelQueryKeys.list(input.currentOrganization.id),
				response
			);
			toast.success("Connected account disconnected.");
		},
	});
	const requestMessageChannelSetupMutation = useMutation({
		mutationFn: async (provider: MessageChannelProvider) =>
			await requestCurrentOrganizationMessageChannelSetup({
				organizationId: input.currentOrganization.id,
				provider,
			}),
		onError: (error) => {
			console.error("Failed to request Message Channel setup.", error);
			toast.error(
				resolveMessageChannelErrorMessage(
					error,
					"OpenMeld could not send this setup request. Try again."
				)
			);
		},
		onSuccess: (response) => {
			queryClient
				.invalidateQueries({
					queryKey: messageChannelQueryKeys.list(input.currentOrganization.id),
				})
				.catch((error: unknown) => {
					console.error(
						"Failed to refresh Message Channel status after requesting setup.",
						error
					);
				});
			if (response.status === "already_requested") {
				toast.success("An organization admin already has this setup request.");
				return;
			}
			toast.success(
				response.recipientCount === 1
					? "Setup request sent to an organization admin."
					: `Setup request sent to ${response.recipientCount} organization admins.`
			);
		},
	});
	const {
		activeResearchBatch,
		documentsQuery,
		latestResearchBatch,
		memberResearchQuery,
		researchMutation,
	} = useDirectoryMemberResearch(input.currentOrganization.id);
	const researchErrors = resolveMemberResearchErrors({
		mutationError: researchMutation.error,
		mutationFailed: researchMutation.isError,
		mutationRequest: researchMutation.variables,
		queryFailed: memberResearchQuery.isError,
	});
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
	const computersStatus = resolveDirectoryProjectionStatus(computersQuery);
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
	const computerGroups = resolveOrganizationComputerGroups({
		currentComputerServiceState: currentComputerServiceProjection.serviceState,
		currentUserId: input.currentUserId,
		directory: input.directoryQuery.data ?? null,
		organizationComputers: computersQuery.data ?? null,
		ownedComputers: input.recovery.localRuntimesQuery.data?.localRuntimes ?? [],
	});
	const memberRows = isPersonalWorkspace
		? buildPersonalHumanProfileRows({
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
				computerGroups,
				computersStatus,
				currentUserComputersStatus: currentComputerServiceProjection.status,
				currentUserId: input.currentUserId,
				documents: documentsQuery.data?.documents ?? [],
				documentsStatus,
				messageChannels: messageChannelsQuery.data ?? null,
				messageChannelsStatus,
				members: input.directoryQuery.data?.members ?? [],
				orgSlug: input.currentOrganization.slug,
				runtimeOverview: input.runtimeOverview,
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
		researchIsPending: researchMutation.isPending,
	});
	const selectedProfileId = resolveSelectedProfileId({
		members: memberRows,
		requestedProfileId: input.focusProfileId,
	});
	const workspaceProps: ComponentProps<typeof DirectoryHumanProfilesWorkspace> =
		{
			activeBatch: activeResearchBatch,
			canCreateProfile: canCreateHumanProfile,
			computerGroups,
			directoryError: computersQuery.isError
				? "OpenMeld couldn't load this member's computers."
				: null,
			directoryIsPending: computersQuery.isPending,
			emptyMessage: profilesEmptyMessage,
			errorMessage: profilesError,
			initialSidebarStates: input.initialSidebarStates,
			latestBatch: latestResearchBatch,
			memberResearchError: researchErrors.member,
			members: memberRows,
			modelCatalog: input.modelCatalog ?? null,
			onCreateProfile: input.onCreateProfile,
			onDisconnectConnectedAccount: (identityLinkId) =>
				disconnectConnectedAccountMutation.mutate(identityLinkId),
			onOpenDirectMessage: openHumanDirectMessage,
			onRetryProfileReports: () => {
				documentsQuery.refetch({ throwOnError: true }).catch((error: unknown) =>
					reportMemberResearchDocumentRefreshFailure({
						error,
						organizationId: input.currentOrganization.id,
					})
				);
			},
			onRequestChannelSetup: async (provider) => {
				await requestMessageChannelSetupMutation.mutateAsync(provider);
			},
			onResearch: (subjectUserId) =>
				researchMutation.mutate({ scope: "member", subjectUserId }),
			onResearchAll: () => researchMutation.mutate({ scope: "all" }),
			onSelectProfile: (profileId) => {
				if (profileId === selectedProfileId) {
					return;
				}
				navigate({
					search: { profileId },
					to: buildOrganizationPeoplePath(input.currentOrganization.slug),
				}).catch((error: unknown) => {
					console.error("Failed to open the selected Human Profile.", error);
				});
			},
			orgSlug: input.currentOrganization.slug,
			pendingResearch: researchMutation.variables,
			profileReportsAreRetrying: documentsQuery.isFetching,
			profileReportsErrorMessage: documentsQuery.isError
				? PROFILE_REPORT_DOCUMENTS_ERROR_MESSAGE
				: null,
			recovery: input.recovery,
			researchErrorMessage: researchErrors.section,
			selectedProfileId,
			state: profilesViewState,
		};
	return {
		invitationAccess: resolveDirectoryInvitationAccess({
			canInvite,
			isPersonalWorkspace,
			isRoleError: roleQuery.isError,
			isRolePending: roleQuery.isPending,
		}),
		isInviteDialogOpen,
		onInviteDialogOpenChange: setIsInviteDialogOpen,
		organization: input.currentOrganization,
		workspaceProps,
	};
}

function DirectoryMembersOverviewView(input: {
	model: ReturnType<typeof useDirectoryMembersOverviewModel>;
}) {
	return (
		<>
			<DirectoryHumanProfilesWorkspace {...input.model.workspaceProps} />
			<DirectoryInviteDialog
				access={input.model.invitationAccess}
				isOpen={input.model.isInviteDialogOpen}
				onOpenChange={input.model.onInviteDialogOpenChange}
				organization={input.model.organization}
			/>
		</>
	);
}

function DirectoryInviteDialog(input: {
	access: DirectoryInvitationAccess;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	organization: OrganizationSummary;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.isOpen}>
			<DialogContent className="max-h-[min(50rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Invite Members</DialogTitle>
					<DialogDescription>
						Invite teammates by email or share an organization invite link.
					</DialogDescription>
				</DialogHeader>
				{input.access.kind === "personal" ? (
					<PersonalWorkspaceInvitationGuidance
						createOrganizationPath={buildOrganizationNewOrganizationPath(
							input.organization.slug
						)}
						title="Create an organization to invite members"
					/>
				) : (
					<DirectoryInvitePanel
						access={input.access}
						organizationId={input.organization.id}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function resolveDirectoryInvitationAccess(input: {
	canInvite: boolean;
	isPersonalWorkspace: boolean;
	isRoleError: boolean;
	isRolePending: boolean;
}): DirectoryInvitationAccess {
	if (input.isPersonalWorkspace) {
		return { kind: "personal" };
	}
	if (input.isRolePending) {
		return { kind: "loading" };
	}
	if (input.isRoleError) {
		return { kind: "unavailable" };
	}
	return { kind: input.canInvite ? "allowed" : "forbidden" };
}

function resolveSelectedProfileId(input: {
	members: readonly { id: string; isCurrentUser: boolean }[];
	requestedProfileId: string | null;
}): string | null {
	return (
		input.members.find((member) => member.id === input.requestedProfileId)
			?.id ??
		input.members.find((member) => member.isCurrentUser)?.id ??
		input.members[0]?.id ??
		null
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

function DirectoryInvitePanel(input: {
	access: Exclude<DirectoryInvitationAccess, { kind: "personal" }>;
	organizationId: string;
}) {
	if (input.access.kind === "loading") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Invite members</CardTitle>
					<CardDescription>
						Checking your invitation permissions.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (input.access.kind === "unavailable") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Invite members</CardTitle>
					<CardDescription>
						OpenMeld could not confirm your invitation permissions.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (input.access.kind === "forbidden") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Invite members</CardTitle>
					<CardDescription>
						Only organization owners and admins can invite teammates. Ask one of
						them if you need to add someone.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<InvitationForm organizationId={input.organizationId} />
			<OrganizationInviteLink organizationId={input.organizationId} />
		</div>
	);
}

export function InvitationForm(input: { organizationId: string }) {
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationInviteRole>("member");
	const [sentMessage, setSentMessage] = useState<string | null>(null);
	const inviteMutation = useMutation({
		mutationFn: async () =>
			await inviteOrganizationMember({
				email: email.trim(),
				organizationId: input.organizationId,
				role,
			}),
		onSuccess: () => {
			setSentMessage(`Invitation sent to ${email.trim()}.`);
			setEmail("");
			setRole("member");
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.directory(input.organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.profileDirectory(
						input.organizationId
					),
				}),
			]).catch(() => undefined);
		},
	});
	const normalizedEmail = email.trim();
	const canSubmit = normalizedEmail.length > 0 && !inviteMutation.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		setSentMessage(null);
		inviteMutation.mutate();
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Invite members</CardTitle>
				<CardDescription>
					Invite a teammate to join this organization and work together in
					Spaces.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
					onSubmit={handleSubmit}
				>
					<div className="grid gap-2">
						<Label htmlFor="organization-invite-email">Email</Label>
						<Input
							autoComplete="email"
							disabled={inviteMutation.isPending}
							id="organization-invite-email"
							onChange={(event) => setEmail(event.target.value)}
							placeholder="teammate@example.com"
							type="email"
							value={email}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="organization-invite-role">Role</Label>
						<Select
							disabled={inviteMutation.isPending}
							onValueChange={(value) =>
								setRole(value === "admin" ? "admin" : "member")
							}
							value={role}
						>
							<SelectTrigger
								displayValue={
									INVITE_ROLE_OPTIONS.find((option) => option.value === role)
										?.label
								}
								id="organization-invite-role"
							/>
							<SelectContent>
								{INVITE_ROLE_OPTIONS.map((option, index) => (
									<SelectItem
										index={index}
										key={option.value}
										value={option.value}
									>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Button disabled={!canSubmit} type="submit">
						<PaperPlaneTiltIcon aria-hidden="true" data-icon="inline-start" />
						Send invitation
					</Button>
				</form>
				{inviteMutation.isError ? (
					<p className="mt-3 text-destructive text-sm">
						{inviteMutation.error.message}
					</p>
				) : null}
				{sentMessage ? (
					<p className="mt-3 text-muted-foreground text-sm">{sentMessage}</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function resolveActiveResearchBatch(
	batch: CenterAgentMemberResearchBatch | null
): CenterAgentMemberResearchBatch | null {
	if (batch?.status === "queued" || batch?.status === "running") {
		return batch;
	}
	return null;
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
	hasFreshReadiness: boolean;
	inventoryStatus: DirectoryProjectionStatus;
	readinessNeedsReconciliation: boolean;
}): DirectoryProjectionStatus {
	if (input.inventoryStatus !== "ready") {
		return input.inventoryStatus;
	}
	if (input.readinessNeedsReconciliation) {
		return "loading";
	}
	return input.hasFreshReadiness ? "ready" : input.computersStatus;
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
		readiness &&
		deviceId &&
		(!input.readinessQuery.isFetching || serviceDisconnected)
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
			hasFreshReadiness: serviceState !== null,
			inventoryStatus: input.inventoryStatus,
			readinessNeedsReconciliation:
				input.readinessQuery.isFetching && !serviceDisconnected,
		}),
	};
}

function showMemberResearchCompletionToast(
	batch: CenterAgentMemberResearchBatch
): void {
	if (batch.failedCount > 0) {
		if (batch.completedCount === 0) {
			toast.warning("Learning finished, but no Profile Reports were created.");
			return;
		}
		toast.warning(
			`Learning finished. ${batch.completedCount} Profile Reports are ready; ${batch.failedCount} could not be completed.`
		);
		return;
	}
	if (batch.scope === "member") {
		const subjectName = batch.tasks[0]?.subjectDisplayName;
		toast.success(
			subjectName
				? `Learning complete. ${subjectName}'s Profile Report is ready.`
				: "Learning complete. The Profile Report is ready."
		);
		return;
	}
	toast.success(
		`Learning complete. ${batch.completedCount} Profile Reports are ready.`
	);
}

function resolveMemberResearchErrors(input: {
	mutationError: unknown;
	mutationFailed: boolean;
	mutationRequest: DirectoryMemberResearchRequest | undefined;
	queryFailed: boolean;
}): {
	member: { message: string; subjectUserId: string } | null;
	section: string | null;
} {
	if (input.mutationFailed) {
		const message = resolveMemberResearchStartErrorMessage(input.mutationError);
		if (input.mutationRequest?.scope === "member") {
			return {
				member: {
					message,
					subjectUserId: input.mutationRequest.subjectUserId,
				},
				section: null,
			};
		}
		return { member: null, section: message };
	}
	if (input.queryFailed) {
		return {
			member: null,
			section: "OpenMeld could not load member research status.",
		};
	}
	return { member: null, section: null };
}

function resolveMemberResearchStartErrorMessage(error: unknown): string {
	const message = resolveOrganizationDocumentErrorMessage(error);
	return message === "OpenMeld could not save this document. Try again."
		? "OpenMeld could not start learning about this member. Try again."
		: message;
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
