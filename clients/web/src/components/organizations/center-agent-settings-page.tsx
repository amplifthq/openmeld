"use client";

import type { CenterAgentUpdateProfileBody } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	CaretDownIcon,
	ChatCircleTextIcon,
	FileTextIcon,
	PauseCircleIcon,
	PencilSimpleIcon,
	PlayCircleIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { CenterAgentAvatarEditor } from "#/components/agents/center-agent-avatar-editor";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	AgentConfigurationCard,
	AgentConfigurationGrid,
} from "#/components/profiles/agent-configuration-card";
import {
	designateCurrentCenterAgent,
	openCurrentCenterAgentDirectMessageSpace,
	resolveCenterAgentErrorMessage,
	updateCurrentCenterAgentOperatingState,
	updateCurrentCenterAgentProfile,
} from "#/lib/organizations/center-agent";
import {
	parseCenterAgentRouteSearch,
	resolveSlackOAuthResult,
} from "#/lib/organizations/center-agent-route-search";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationDocumentPath,
	buildOrganizationNewDocumentPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import {
	centerAgentDesignationQueryOptions,
	centerAgentMemoryPolicyQueryOptions,
	centerAgentModelQueryOptions,
	centerAgentOperatingStateQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import {
	organizationDirectoryQueryFilters,
	organizationDirectoryQueryOptions,
	organizationMemberRoleQueryOptions,
	organizationProfileDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { organizationDocumentsQueryOptions } from "#/query/organizations/organization-documents";
import { applySavedAgentAvatarProfile } from "#/query/profiles/agent-avatar";
import { useAgentAvatarInvalidationScope } from "#/query/profiles/agent-avatar-context";
import { CenterAgentAuditJournalPanel } from "./center-agent-audit-journal-panel";
import { CenterAgentModelSection } from "./center-agent-model-section";
import {
	type CenterAgentConnectionStatus,
	type DirectoryAgentProfile,
	resolveCenterAgentConnectionStatus,
	resolveDesignatedCenterAgentProfile,
} from "./center-agent-profile-presentation";
import { CenterAgentRouteStateProvider } from "./center-agent-route-state";
import { OrganizationMemoryPage } from "./organization-memory-page";
import { OrganizationMemoryPolicySection } from "./organization-memory-policy-section";
import { OrganizationMessageChannelsPage } from "./organization-message-channels-page";

const CENTER_AGENT_STATUS_BADGE_CLASS_NAMES = {
	Available: resolveStatusToneProminentBadgeClassName("ready"),
	Disconnected: resolveStatusToneProminentBadgeClassName("muted"),
	Paused: resolveStatusToneProminentBadgeClassName("warning"),
	Unavailable: resolveStatusToneProminentBadgeClassName("warning"),
} as const satisfies Record<CenterAgentConnectionStatus, string>;

function CenterAgentGeneralSettings() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			centerAgentOnly: true,
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: currentOrganization.isPersonal !== true,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const isPersonalOrganization = currentOrganization.isPersonal === true;
	const canManageCenterAgent =
		isPersonalOrganization ||
		canManageOrganizationArea(roleQuery.data, {
			centerAgent: ["update"],
		});
	const canManageMemory =
		isPersonalOrganization ||
		canManageOrganizationArea(roleQuery.data, {
			memory: ["manage"],
		});
	const roleErrorMessage =
		isPersonalOrganization || !roleQuery.isError
			? null
			: roleQuery.error.message;

	return (
		<CenterAgentSettingsContent
			agentProfiles={directoryQuery.data?.agentProfiles ?? []}
			isDirectoryPending={directoryQuery.isPending}
			isPersonalWorkspace={isPersonalOrganization}
			memoryRoleState={{
				canManage: canManageMemory,
				errorMessage: roleErrorMessage,
				isPending: isPersonalOrganization ? false : roleQuery.isPending,
			}}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			orgSlug={currentOrganization.slug}
			roleState={{
				canManage: canManageCenterAgent,
				errorMessage: roleErrorMessage,
				isPending: isPersonalOrganization ? false : roleQuery.isPending,
			}}
		/>
	);
}

export type CenterAgentSettingsRoleState = {
	canManage: boolean;
	errorMessage: string | null;
	isPending: boolean;
};

function CenterAgentOrganizationMemorySection(input: {
	isPersonalWorkspace: boolean;
	organizationId: string;
	presentation?: "card";
	roleState: CenterAgentSettingsRoleState;
}) {
	if (input.isPersonalWorkspace) {
		return null;
	}

	return (
		<OrganizationMemoryPolicySection
			isPersonalWorkspace={false}
			organizationId={input.organizationId}
			presentation={input.presentation}
			roleState={input.roleState}
		/>
	);
}

function isCenterAgentIdentityPending(input: {
	designationPending: boolean;
	hasDesignation: boolean;
	directoryPending: boolean;
	hasProfile: boolean;
}) {
	return (
		input.designationPending ||
		(input.hasDesignation && input.directoryPending && !input.hasProfile)
	);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This component coordinates existing Center Agent queries and mutations across distinct settings states.
export function CenterAgentSettingsContent(input: {
	agentProfiles: readonly DirectoryAgentProfile[];
	isDirectoryPending: boolean;
	isPersonalWorkspace: boolean;
	memoryRoleState: CenterAgentSettingsRoleState;
	organizationId: string;
	organizationName: string;
	orgSlug: string;
	roleState: CenterAgentSettingsRoleState;
}) {
	const queryClient = useQueryClient();
	const avatarInvalidationScope = useAgentAvatarInvalidationScope();
	const navigate = useNavigate();
	const [mutationError, setMutationError] = useState<string | null>(null);
	const [auditOpen, setAuditOpen] = useState(false);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const documentsQuery = useQuery(
		organizationDocumentsQueryOptions({ organizationId: input.organizationId })
	);
	const brief = documentsQuery.data?.documents.find(
		(document) => document.kind === "brief"
	);
	const designation = designationQuery.data?.designation ?? null;
	// Start independent settings reads before the identity section can mount.
	// The child sections reuse these exact query keys and cached responses.
	useQuery(
		centerAgentModelQueryOptions({
			enabled: designation !== null,
			organizationId: input.organizationId,
		})
	);
	useQuery(
		centerAgentMemoryPolicyQueryOptions({
			enabled: !input.isPersonalWorkspace,
			organizationId: input.organizationId,
		})
	);
	const auditDirectoryQuery = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: auditOpen,
			organizationId: input.organizationId,
		})
	);
	const operatingStateQuery = useQuery(
		centerAgentOperatingStateQueryOptions({
			enabled: designation !== null,
			organizationId: input.organizationId,
		})
	);
	const designatedProfile = resolveDesignatedCenterAgentProfile({
		agentProfiles: input.agentProfiles,
		designation,
	});
	const remoteSelectable =
		designationQuery.data?.remoteRuntimeAvailability?.selectable === true;
	const canChangeOperatingState = resolveCanChangeCenterAgentOperatingState({
		canManage: input.roleState.canManage,
		serverAllowsChange:
			operatingStateQuery.data?.canChangeOperatingState === true,
	});
	const invalidateCenterAgentFacts = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.designation(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.operatingState(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.auditJournal(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.directMessageSpaceOpen(
					input.organizationId
				),
			}),
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.directMessageSpaceProjection(
					input.organizationId
				),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.directory(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.profileDirectory(input.organizationId),
			}),
		]);
	};
	const designateMutation = useMutation({
		mutationFn: async (variables: {
			agentProfileId?: string;
			runtime: "remote_agent" | "self_hosted";
		}) =>
			await designateCurrentCenterAgent({
				...variables,
				organizationId: input.organizationId,
			}),
		onError: (error) => {
			setMutationError(resolveCenterAgentErrorMessage(error, "designate"));
		},
		onMutate: () => {
			setMutationError(null);
		},
		onSuccess: async () => {
			await invalidateCenterAgentFacts();
			toast.success("Center Agent updated.");
		},
	});
	const operatingStateMutation = useMutation({
		mutationFn: async (operatingState: "active" | "paused") =>
			await updateCurrentCenterAgentOperatingState({
				operatingState,
				organizationId: input.organizationId,
			}),
		onError: (error) => {
			setMutationError(
				resolveCenterAgentErrorMessage(error, "operating_state_update")
			);
		},
		onMutate: () => {
			setMutationError(null);
		},
		onSettled: async () => {
			await invalidateCenterAgentFacts();
		},
		onSuccess: (response) => {
			toast.success(resolveOperatingStateSuccessMessage(response));
		},
	});
	const updateProfileMutation = useMutation({
		mutationFn: async (variables: {
			profileName?: string;
			avatarStyle?: CenterAgentUpdateProfileBody["avatarStyle"];
			avatar?: CenterAgentUpdateProfileBody["avatar"];
		}) =>
			await updateCurrentCenterAgentProfile({
				organizationId: input.organizationId,
				...variables,
			}),
		onError: (error) => {
			setMutationError(resolveCenterAgentErrorMessage(error, "profile_update"));
		},
		onMutate: () => {
			setMutationError(null);
		},
		onSuccess: async (response, variables) => {
			if (variables.avatarStyle || variables.avatar) {
				await applySavedAgentAvatarProfile(
					queryClient,
					response.profile,
					avatarInvalidationScope
				);
			}
			queryClient.setQueriesData<{
				agentProfiles: Pick<
					DirectoryAgentProfile,
					"profileId" | "profileHandle" | "profileName" | "updatedAt"
				>[];
			}>(
				organizationDirectoryQueryFilters({
					organizationId: input.organizationId,
				}),
				(current) =>
					current === undefined
						? current
						: {
								...current,
								agentProfiles: current.agentProfiles.map((profile) =>
									profile.profileId === response.profile.openMeldProfileId
										? {
												...profile,
												profileHandle: response.profile.profileHandle,
												profileName: response.profile.profileName,
												updatedAt: response.profile.updatedAt,
											}
										: profile
								),
							}
			);
			await invalidateCenterAgentFacts();
			toast.success(
				variables.avatarStyle || variables.avatar
					? "Avatar updated."
					: "Center Agent profile updated."
			);
		},
	});
	const dmMutation = useMutation({
		mutationFn: () =>
			openCurrentCenterAgentDirectMessageSpace({
				organizationId: input.organizationId,
			}),
		onError: (error) => {
			setMutationError(resolveCenterAgentErrorMessage(error, "dm_open"));
		},
		onMutate: () => {
			setMutationError(null);
		},
		onSuccess: (response) => {
			navigate({
				to: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					spaceId: response.spaceId,
				}),
			}).catch((error) => {
				console.error("Failed to navigate to Center Agent DM Space.", error);
			});
		},
	});

	return (
		<>
			{designation && designatedProfile ? null : (
				<AppPageHeader
					description={
						input.isPersonalWorkspace
							? "Manage your coordinator’s identity and connection, and see the actions it has taken."
							: `Manage the identity and connection for ${input.organizationName}’s coordinator, and see the actions it has taken.`
					}
					eyebrow={
						input.isPersonalWorkspace ? "Personal workspace" : "Organization"
					}
					title="Center Agent settings"
				/>
			)}
			{designation && designatedProfile ? (
				<CenterAgentConnectionSection
					canManage={input.roleState.canManage && !input.roleState.isPending}
					disableMessage={
						dmMutation.isPending ||
						operatingStateQuery.isError ||
						operatingStateQuery.data?.operatingState !== "active"
					}
					onMessage={() => dmMutation.mutate()}
					onSaveAvatar={async (avatar) => {
						await updateProfileMutation.mutateAsync({ avatar });
					}}
					operatingState={
						operatingStateQuery.isError
							? null
							: (operatingStateQuery.data?.operatingState ?? null)
					}
					profile={designatedProfile}
					savingAvatar={updateProfileMutation.isPending}
				/>
			) : null}
			{designation && designatedProfile ? (
				<section className="space-y-3">
					<div>
						<h2 className="font-medium text-foreground text-sm">
							How this Agent works
						</h2>
						<p className="mt-1 text-muted-foreground text-xs">
							Settings for {input.organizationName}’s coordinator.
						</p>
					</div>
					<AgentConfigurationGrid>
						<CenterAgentModelSection
							canManage={input.roleState.canManage}
							enabled
							organizationId={input.organizationId}
						/>
						<CenterAgentIdentitySection
							canManage={input.roleState.canManage}
							disableProfileUpdate={updateProfileMutation.isPending}
							onUpdateProfile={(profileName) =>
								updateProfileMutation.mutate({ profileName })
							}
							profile={designatedProfile}
						/>
						{documentsQuery.isSuccess ? (
							<AgentConfigurationCard
								actionLabel="Open Team Brief"
								description="Approved context for Center Agent"
								icon={<FileTextIcon aria-hidden="true" />}
								itemId="center-agent-brief"
								label="Team Brief"
								onClick={() => {
									navigate({
										to: brief
											? buildOrganizationDocumentPath({
													documentId: brief.id,
													orgSlug: input.orgSlug,
												})
											: buildOrganizationNewDocumentPath({
													kind: "brief",
													orgSlug: input.orgSlug,
												}),
									}).catch(console.error);
								}}
								summary={brief ? "View brief" : "Create brief"}
							/>
						) : null}
						<CenterAgentOrganizationMemorySection
							isPersonalWorkspace={input.isPersonalWorkspace}
							organizationId={input.organizationId}
							presentation="card"
							roleState={input.memoryRoleState}
						/>
					</AgentConfigurationGrid>
				</section>
			) : null}
			{designationQuery.data && !designation && documentsQuery.isSuccess ? (
				<section className="rounded-md border border-border/70 bg-card/20 px-5 py-4">
					<Link
						className="inline-flex touch-manipulation items-center font-medium text-sm underline-offset-4 hover:underline max-lg:min-h-11"
						to={
							brief
								? buildOrganizationDocumentPath({
										documentId: brief.id,
										orgSlug: input.orgSlug,
									})
								: buildOrganizationNewDocumentPath({
										kind: "brief",
										orgSlug: input.orgSlug,
									})
						}
					>
						Team Brief →
					</Link>
					<p className="mt-1 text-muted-foreground text-xs">
						Manage the approved knowledge your Center Agent receives in Files.
					</p>
				</section>
			) : null}
			{documentsQuery.isError ? (
				<CenterAgentErrorState
					message="Could not load the Team Brief link."
					onRetry={() => {
						documentsQuery.refetch().catch((error) => {
							console.error("Failed to refresh Team knowledge.", error);
						});
					}}
					title="Could not load Team knowledge."
				/>
			) : null}
			{designationQuery.data && !designation ? (
				<CenterAgentOrganizationMemorySection
					isPersonalWorkspace={input.isPersonalWorkspace}
					organizationId={input.organizationId}
					roleState={input.memoryRoleState}
				/>
			) : null}
			{isCenterAgentIdentityPending({
				designationPending: designationQuery.isPending,
				hasDesignation: designation !== null,
				directoryPending: input.isDirectoryPending,
				hasProfile: Boolean(designatedProfile),
			}) ? (
				<SkeletonForm
					className="rounded-md border border-border/70 p-5"
					fields={2}
					label="Loading Center Agent"
				/>
			) : null}
			{designationQuery.isError ? (
				<CenterAgentErrorState
					message={resolveCenterAgentErrorMessage(
						designationQuery.error,
						"designation_read"
					)}
					onRetry={() => {
						designationQuery.refetch().catch((error) => {
							console.error(
								"Failed to refresh Center Agent designation.",
								error
							);
						});
					}}
				/>
			) : null}
			{designationQuery.data && !designation ? (
				<CenterAgentDisconnectedSection
					connectState={{ isPending: designateMutation.isPending }}
					onConnectRemote={() => {
						if (input.roleState.canManage && remoteSelectable) {
							designateMutation.mutate({ runtime: "remote_agent" });
						}
					}}
					remoteSelectable={remoteSelectable}
					roleState={input.roleState}
				/>
			) : null}
			{designation && designatedProfile ? (
				<>
					<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
						<h2>
							<button
								aria-expanded={auditOpen}
								className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
								onClick={() => setAuditOpen((open) => !open)}
								type="button"
							>
								<span>
									<span className="block font-medium text-foreground text-sm">
										Audit Log
									</span>
									<span className="mt-1 block text-muted-foreground text-xs">
										Review Center Agent actions and requests.
									</span>
								</span>
								<CaretDownIcon
									aria-hidden="true"
									className={`size-4 shrink-0 text-muted-foreground transition-transform ${auditOpen ? "rotate-180" : ""}`}
								/>
							</button>
						</h2>
						{auditOpen ? (
							<CenterAgentAuditJournalPanel
								enabled
								members={auditDirectoryQuery.data?.members ?? []}
								organizationId={input.organizationId}
								profiles={
									auditDirectoryQuery.data?.agentProfiles ?? input.agentProfiles
								}
							/>
						) : null}
					</section>
					<CenterAgentDangerSection
						canChangeOperatingState={canChangeOperatingState}
						disableChange={
							operatingStateQuery.isPending ||
							operatingStateQuery.isError ||
							operatingStateMutation.isPending
						}
						onPause={() => operatingStateMutation.mutate("paused")}
						onResume={() => operatingStateMutation.mutate("active")}
						operatingState={
							operatingStateQuery.isError
								? null
								: (operatingStateQuery.data?.operatingState ?? null)
						}
					/>
					<CenterAgentOperatingStateErrorState
						error={operatingStateQuery.error}
						isError={operatingStateQuery.isError}
						onRetry={() => {
							operatingStateQuery.refetch().catch((error) => {
								console.error(
									"Failed to refresh Center Agent operating state.",
									error
								);
							});
						}}
					/>
				</>
			) : null}
			{designation && !input.isDirectoryPending && !designatedProfile ? (
				<CenterAgentErrorState
					message="OpenMeld found a Center Agent designation, but the managed profile is not available in this workspace directory."
					onRetry={() => {
						queryClient
							.invalidateQueries({
								queryKey: organizationQueryKeys.directory(input.organizationId),
							})
							.catch((error) => {
								console.error(
									"Failed to refresh the workspace directory.",
									error
								);
							});
					}}
					title="Center Agent profile unavailable."
				/>
			) : null}
			{mutationError ? (
				<p
					className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
					role="alert"
				>
					{mutationError}
				</p>
			) : null}
		</>
	);
}

function resolveCanChangeCenterAgentOperatingState(input: {
	canManage: boolean;
	serverAllowsChange: boolean;
}): boolean {
	return input.canManage && input.serverAllowsChange;
}

function resolveOperatingStateSuccessMessage(input: {
	affectedTaskCount: number;
	operatingState: "active" | "paused";
}): string {
	if (input.operatingState === "active") {
		return "Center Agent resumed.";
	}
	const taskLabel = input.affectedTaskCount === 1 ? "task was" : "tasks were";
	return `Center Agent paused. ${input.affectedTaskCount} current ${taskLabel} stopped.`;
}

function CenterAgentOperatingStateErrorState(input: {
	error: unknown;
	isError: boolean;
	onRetry: () => void;
}) {
	if (!input.isError) {
		return null;
	}
	return (
		<CenterAgentErrorState
			message={resolveCenterAgentErrorMessage(
				input.error,
				"operating_state_read"
			)}
			onRetry={input.onRetry}
			title="Could not load Center Agent controls."
		/>
	);
}

function CenterAgentDisconnectedSection(input: {
	connectState: { isPending: boolean };
	onConnectRemote: () => void;
	remoteSelectable: boolean;
	roleState: CenterAgentSettingsRoleState;
}) {
	return (
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="font-medium text-foreground text-sm">Connection</h2>
			</div>
			<div className="space-y-5 px-5 py-5">
				<div className="flex items-center gap-4">
					<RobotIcon
						aria-hidden="true"
						className="size-9 text-muted-foreground"
					/>
					<div>
						<p className="font-medium text-foreground">
							Connect your Center Agent
						</p>
						<Badge className="mt-2 border-border bg-muted/40 text-muted-foreground">
							Not Connected
						</Badge>
					</div>
				</div>
				{input.remoteSelectable ? (
					<Button
						disabled={
							!input.roleState.canManage ||
							input.connectState.isPending ||
							Boolean(input.roleState.errorMessage) ||
							input.roleState.isPending
						}
						onClick={input.onConnectRemote}
						type="button"
					>
						<RobotIcon aria-hidden="true" data-icon="inline-start" />
						{input.connectState.isPending
							? "Connecting..."
							: "Connect Center Agent"}
					</Button>
				) : (
					<p className="rounded-md border border-border/70 bg-background/30 px-4 py-3 text-muted-foreground text-sm">
						Center Agent is not available in this Workspace right now.
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{resolveRemoteConnectionDescription({
						canManage: input.roleState.canManage,
						isMutationPending: input.connectState.isPending,
						isRoleError: Boolean(input.roleState.errorMessage),
						isRolePending: input.roleState.isPending,
					})}
				</p>
			</div>
		</section>
	);
}

function resolveRemoteConnectionDescription(input: {
	canManage: boolean;
	isMutationPending: boolean;
	isRoleError: boolean;
	isRolePending: boolean;
}): string {
	if (input.isMutationPending) {
		return "Connecting your Center Agent to OpenMeld’s hosted service.";
	}
	if (input.isRolePending) {
		return "OpenMeld is checking whether you can manage the Center Agent.";
	}
	if (input.isRoleError) {
		return "OpenMeld could not confirm your management permissions. Try again after refreshing.";
	}
	if (!input.canManage) {
		return "Only workspace owners and admins can connect the Center Agent.";
	}
	return "Hosted by OpenMeld and available when your computer is offline.";
}

function CenterAgentConnectionSection(input: {
	canManage: boolean;
	onSaveAvatar: (
		avatar: NonNullable<CenterAgentUpdateProfileBody["avatar"]>
	) => Promise<void>;
	savingAvatar: boolean;
	disableMessage: boolean;
	onMessage: () => void;
	operatingState: "active" | "paused" | null;
	profile: DirectoryAgentProfile;
}) {
	let status:
		| keyof typeof CENTER_AGENT_STATUS_BADGE_CLASS_NAMES
		| "Status unavailable" = "Status unavailable";
	if (input.operatingState === "paused") {
		status = "Paused";
	} else if (input.operatingState === "active") {
		status = resolveCenterAgentConnectionStatus(input.profile);
	}
	return (
		<section className="space-y-3 py-1">
			<p className="text-muted-foreground text-xs">Center Agent settings</p>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-start gap-4">
					<CenterAgentAvatarEditor
						avatarOptions={input.profile.avatarOptions}
						avatarStyle={input.profile.avatarStyle}
						canEdit={input.canManage}
						onSave={input.onSaveAvatar}
						profileId={input.profile.profileId}
						profileName={input.profile.profileName}
						saving={input.savingAvatar}
					/>
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-2xl text-foreground">
							{input.profile.profileName}
						</h1>
						<p className="mt-1 truncate text-muted-foreground text-sm">
							@{input.profile.profileHandle}
						</p>
						<div className="mt-2 flex items-center">
							<Badge
								className={
									status === "Status unavailable"
										? resolveStatusToneProminentBadgeClassName("muted")
										: CENTER_AGENT_STATUS_BADGE_CLASS_NAMES[status]
								}
							>
								{status}
							</Badge>
						</div>
					</div>
				</div>
				<Button
					disabled={input.disableMessage}
					onClick={input.onMessage}
					size="sm"
					type="button"
				>
					<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
					Message
				</Button>
			</div>
		</section>
	);
}

function CenterAgentIdentitySection(input: {
	canManage: boolean;
	disableProfileUpdate: boolean;
	onUpdateProfile: (profileName: string) => void;
	profile: DirectoryAgentProfile;
}) {
	const nameInputId = useId();
	const [nameDraft, setNameDraft] = useState<{
		sourceName: string;
		value: string;
	} | null>(null);
	const name =
		nameDraft?.sourceName === input.profile.profileName
			? nameDraft.value
			: input.profile.profileName;
	const normalizedName = name.trim();
	const canSubmitName =
		input.canManage &&
		normalizedName.length > 0 &&
		normalizedName !== input.profile.profileName &&
		!input.disableProfileUpdate;
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (canSubmitName) {
			input.onUpdateProfile(normalizedName);
		}
	};
	return (
		<div>
			<AgentConfigurationCard
				actionLabel="Edit Identity"
				description={`@${input.profile.profileHandle}`}
				icon={<RobotIcon aria-hidden="true" />}
				itemId="center-agent-identity"
				label="Identity"
				readOnly={!input.canManage}
				summary={input.profile.profileName}
			>
				<div>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-2">
							<Label htmlFor={nameInputId}>Display name</Label>
							<Input
								disabled={input.disableProfileUpdate}
								id={nameInputId}
								onChange={(event) =>
									setNameDraft({
										sourceName: input.profile.profileName,
										value: event.target.value,
									})
								}
								readOnly={!input.canManage}
								value={name}
							/>
							<p className="text-muted-foreground text-xs">
								The handle updates from the display name automatically.
							</p>
						</div>
						{input.canManage ? (
							<Button disabled={!canSubmitName} size="sm" type="submit">
								<PencilSimpleIcon aria-hidden="true" data-icon="inline-start" />
								{input.disableProfileUpdate ? "Saving..." : "Save name"}
							</Button>
						) : null}
					</form>
				</div>
			</AgentConfigurationCard>
		</div>
	);
}

function CenterAgentDangerSection(input: {
	canChangeOperatingState: boolean;
	disableChange: boolean;
	onPause: () => void;
	onResume: () => void;
	operatingState: "active" | "paused" | null;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const isPaused = input.operatingState === "paused";
	let heading = "Operating state unavailable";
	let description = "Check the Agent's state before changing it.";
	let actionLabel = "Unavailable";
	if (input.operatingState === "paused") {
		heading = "Center Agent is paused";
		description =
			"It cannot start or continue tasks in OpenMeld, Slack, or connected channels until an Organization owner or admin resumes it.";
		actionLabel = "Resume";
	} else if (input.operatingState === "active") {
		heading = "Pause Center Agent";
		description =
			"Stops every task currently interacting with the Center Agent across the organization and rejects new tasks until it is resumed.";
		actionLabel = "Pause";
	}
	return (
		<section className="overflow-hidden rounded-md border border-destructive/40 bg-destructive/5">
			<div className="border-destructive/30 border-b px-5 py-4">
				<h2 className="font-medium text-destructive text-sm">Danger zone</h2>
			</div>
			<div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-foreground text-sm">{heading}</p>
					<p className="mt-1 text-muted-foreground text-sm">{description}</p>
					{input.canChangeOperatingState ? null : (
						<p className="mt-2 text-muted-foreground text-xs">
							Only Organization owners and admins can pause the Center Agent.
						</p>
					)}
				</div>
				{input.canChangeOperatingState ? (
					<Button
						disabled={input.disableChange}
						onClick={() => {
							if (isPaused) {
								input.onResume();
								return;
							}
							setConfirmOpen(true);
						}}
						size="sm"
						type="button"
						variant={isPaused ? "outline" : "destructive"}
					>
						{isPaused ? (
							<PlayCircleIcon aria-hidden="true" data-icon="inline-start" />
						) : (
							<PauseCircleIcon aria-hidden="true" data-icon="inline-start" />
						)}
						{actionLabel}
					</Button>
				) : null}
			</div>
			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Pause Center Agent?</DialogTitle>
						<DialogDescription>
							Pausing stops every task currently interacting with the Center
							Agent across OpenMeld, Slack, and connected channels. Its
							identity, conversations, Routines, and connections are preserved.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => setConfirmOpen(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={input.disableChange}
							onClick={() => {
								input.onPause();
								setConfirmOpen(false);
							}}
							type="button"
							variant="destructive"
						>
							Pause Center Agent
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function CenterAgentErrorState(input: {
	message: string;
	onRetry: () => void;
	title?: string;
}) {
	return (
		<div className="rounded-md border border-destructive/50 bg-destructive/10 px-5 py-4">
			<p className="font-medium text-destructive text-sm">
				{input.title ?? "Could not load Center Agent."}
			</p>
			<p className="mt-1 text-muted-foreground text-sm">{input.message}</p>
			<Button
				className="mt-4"
				onClick={input.onRetry}
				size="sm"
				type="button"
				variant="outline"
			>
				Retry
			</Button>
		</div>
	);
}

export function CenterAgentSettingsPage() {
	const searchStr = useRouterState({
		select: (state) => state.location.searchStr,
	});
	const search = Object.fromEntries(new URLSearchParams(searchStr));
	return (
		<CenterAgentRouteStateProvider
			value={{
				channelsSlackOAuthResult: resolveSlackOAuthResult(
					parseCenterAgentRouteSearch(search)
				),
			}}
		>
			<CenterAgentGeneralSettings />
			<section aria-label="Channels" className="mt-4 space-y-6" id="channels">
				<OrganizationMessageChannelsPage />
			</section>
			<section aria-label="Memory" className="mt-4 space-y-6" id="memory">
				<OrganizationMemoryPage />
			</section>
		</CenterAgentRouteStateProvider>
	);
}
