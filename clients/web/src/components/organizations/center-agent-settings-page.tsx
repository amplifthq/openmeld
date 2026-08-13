"use client";

import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
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
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	ChatCircleTextIcon,
	PauseCircleIcon,
	PencilSimpleIcon,
	PlayCircleIcon,
	RobotIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { AppPageHeader } from "#/components/app/app-page-header";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import {
	designateCurrentCenterAgent,
	openCurrentCenterAgentDirectMessageSpace,
	resolveCenterAgentErrorMessage,
	updateCurrentCenterAgentOperatingState,
	updateCurrentCenterAgentProfile,
} from "#/lib/organizations/center-agent";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationDocumentPath,
	buildOrganizationNewDocumentPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import {
	centerAgentDesignationQueryOptions,
	centerAgentOperatingStateQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import {
	organizationDirectoryQueryOptions,
	organizationMemberRoleQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { organizationDocumentsQueryOptions } from "#/query/organizations/organization-documents";
import { CenterAgentAuditJournalPanel } from "./center-agent-audit-journal-panel";
import { CenterAgentModelSection } from "./center-agent-model-section";
import {
	type CenterAgentConnectionStatus,
	type DirectoryAgentProfile,
	resolveCenterAgentConnectionStatus,
	resolveDesignatedCenterAgentProfile,
} from "./center-agent-profile-presentation";
import { CenterAgentUsageSection } from "./center-agent-usage-section";

const CENTER_AGENT_STATUS_BADGE_CLASS_NAMES = {
	Available: resolveStatusToneProminentBadgeClassName("ready"),
	Disconnected: resolveStatusToneProminentBadgeClassName("muted"),
	Paused: resolveStatusToneProminentBadgeClassName("warning"),
	Unavailable: resolveStatusToneProminentBadgeClassName("warning"),
} as const satisfies Record<CenterAgentConnectionStatus, string>;

export function CenterAgentSettingsPage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
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
	const canManage =
		isPersonalOrganization ||
		canManageOrganizationArea(roleQuery.data, {
			centerAgent: ["update"],
		});

	return (
		<CenterAgentSettingsContent
			agentProfiles={directoryQuery.data?.agentProfiles ?? []}
			isDirectoryPending={directoryQuery.isPending}
			isPersonalWorkspace={isPersonalOrganization}
			members={directoryQuery.data?.members ?? []}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			orgSlug={currentOrganization.slug}
			roleState={{
				canManage,
				isError: isPersonalOrganization ? false : roleQuery.isError,
				isPending: isPersonalOrganization ? false : roleQuery.isPending,
			}}
		/>
	);
}

export type CenterAgentSettingsRoleState = {
	canManage: boolean;
	isError: boolean;
	isPending: boolean;
};

export function CenterAgentSettingsContent(input: {
	agentProfiles: readonly DirectoryAgentProfile[];
	isDirectoryPending: boolean;
	isPersonalWorkspace: boolean;
	members: readonly OrganizationDirectoryResponse["members"][number][];
	organizationId: string;
	organizationName: string;
	orgSlug: string;
	roleState: CenterAgentSettingsRoleState;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [mutationError, setMutationError] = useState<string | null>(null);
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
		mutationFn: async (variables: { profileName: string }) =>
			await updateCurrentCenterAgentProfile({
				organizationId: input.organizationId,
				profileName: variables.profileName,
			}),
		onError: (error) => {
			setMutationError(resolveCenterAgentErrorMessage(error, "profile_update"));
		},
		onMutate: () => {
			setMutationError(null);
		},
		onSuccess: async (response) => {
			queryClient.setQueryData(
				organizationQueryKeys.directory(input.organizationId),
				(current: OrganizationDirectoryResponse | undefined) =>
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
			toast.success("Center Agent profile updated.");
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
			<AppPageHeader
				description={
					input.isPersonalWorkspace
						? "Manage your coordinator’s identity and connection, review its usage, and see the actions it has taken."
						: `Manage the identity and connection for ${input.organizationName}’s coordinator, review its usage, and see the actions it has taken.`
				}
				eyebrow={
					input.isPersonalWorkspace ? "Personal workspace" : "Organization"
				}
				title="Center Agent settings"
			/>
			{documentsQuery.isSuccess ? (
				<section className="rounded-md border border-border/70 bg-card/20 px-5 py-4">
					<Link
						className="font-medium text-sm underline-offset-4 hover:underline"
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
						Organization Brief →
					</Link>
					<p className="mt-1 text-muted-foreground text-xs">
						Manage the approved context your Center Agent receives in Documents.
					</p>
				</section>
			) : null}
			{documentsQuery.isError ? (
				<CenterAgentErrorState
					message="OpenMeld could not load the Organization Brief link."
					onRetry={() => {
						documentsQuery.refetch().catch((error) => {
							console.error("Failed to refresh Organization documents.", error);
						});
					}}
					title="Could not load Documents."
				/>
			) : null}
			<CenterAgentUsageSection
				isPersonalWorkspace={input.isPersonalWorkspace}
				organizationId={input.organizationId}
			/>
			{designationQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading Center Agent.</p>
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
					<CenterAgentConnectionSection
						disableMessage={
							dmMutation.isPending ||
							operatingStateQuery.data?.operatingState === "paused"
						}
						onMessage={() => dmMutation.mutate()}
						operatingState={
							operatingStateQuery.data?.operatingState ?? "active"
						}
						profile={designatedProfile}
					/>
					<CenterAgentIdentitySection
						canManage={input.roleState.canManage}
						disableProfileUpdate={updateProfileMutation.isPending}
						onUpdateProfile={(profileName) =>
							updateProfileMutation.mutate({ profileName })
						}
						profile={designatedProfile}
					/>
					<CenterAgentModelSection
						canManage={input.roleState.canManage}
						enabled
						organizationId={input.organizationId}
					/>
					<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
						<div className="border-border/70 border-b px-5 py-4">
							<h2 className="font-medium text-foreground text-sm">Audit Log</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								Review Center Agent actions, Local Agent requests, and the
								context Local Agents reported loading.
							</p>
						</div>
						<CenterAgentAuditJournalPanel
							enabled
							members={input.members}
							organizationId={input.organizationId}
							profiles={input.agentProfiles}
						/>
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
							operatingStateQuery.data?.operatingState ?? "active"
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
							input.roleState.isError ||
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
						isRoleError: input.roleState.isError,
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
	disableMessage: boolean;
	onMessage: () => void;
	operatingState: "active" | "paused";
	profile: DirectoryAgentProfile;
}) {
	const status =
		input.operatingState === "paused"
			? "Paused"
			: resolveCenterAgentConnectionStatus(input.profile);
	return (
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="font-medium text-foreground text-sm">Connection</h2>
			</div>
			<div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
				<div className="flex min-w-0 items-start gap-4">
					<DitherProfileAvatar
						data-testid={`center-agent-profile-avatar-${input.profile.profileId}`}
						profileId={input.profile.profileId}
						profileKind="center-agent"
						profileName={input.profile.profileName}
						size={40}
					/>
					<div className="min-w-0">
						<p className="truncate font-medium text-base text-foreground">
							{input.profile.profileName}
						</p>
						<p className="mt-1 truncate text-muted-foreground text-sm">
							@{input.profile.profileHandle}
						</p>
						<Badge
							className={`mt-3 ${CENTER_AGENT_STATUS_BADGE_CLASS_NAMES[status]}`}
						>
							{status}
						</Badge>
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
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="font-medium text-foreground text-sm">Identity</h2>
			</div>
			<div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.75fr)]">
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
				<dl className="grid content-start gap-4 text-sm">
					<div>
						<dt className="text-muted-foreground">Handle</dt>
						<dd className="mt-1 break-all text-foreground">
							@{input.profile.profileHandle}
						</dd>
					</div>
				</dl>
			</div>
		</section>
	);
}

function CenterAgentDangerSection(input: {
	canChangeOperatingState: boolean;
	disableChange: boolean;
	onPause: () => void;
	onResume: () => void;
	operatingState: "active" | "paused";
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const isPaused = input.operatingState === "paused";
	return (
		<section className="overflow-hidden rounded-md border border-destructive/40 bg-destructive/5">
			<div className="border-destructive/30 border-b px-5 py-4">
				<h2 className="font-medium text-destructive text-sm">Danger zone</h2>
			</div>
			<div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-foreground text-sm">
						{isPaused ? "Center Agent is paused" : "Pause Center Agent"}
					</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{isPaused
							? "It cannot start or continue tasks in OpenMeld, Slack, or connected channels until the Organization creator resumes it."
							: "Stops every task currently interacting with the Center Agent across the organization and rejects new tasks until it is resumed."}
					</p>
					{input.canChangeOperatingState ? null : (
						<p className="mt-2 text-muted-foreground text-xs">
							Only the Organization creator can pause the Center Agent.
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
						{isPaused ? "Resume" : "Pause"}
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
