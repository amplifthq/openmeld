"use client";

import type {
	CenterAgentMemberResearchBatch,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import {
	buildOrganizationHumanProfileRows,
	buildPersonalHumanProfileRows,
	type DirectoryDocumentsStatus,
	type DirectoryMemberOpenMeldServiceDisplayState,
	resolveMissingPersonalHumanProfileMessage,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryHumanProfilesSection,
	type DirectoryHumanProfilesViewState,
	type DirectoryMemberResearchRequest,
} from "#/components/directory/directory-human-profiles-section";
import { OrganizationInviteLink } from "#/components/organizations/organization-invite-link";
import { PersonalWorkspaceInvitationGuidance } from "#/components/organizations/personal-workspace-invitation-guidance";
import {
	inviteOrganizationMember,
	type OrganizationInviteRole,
} from "#/lib/organizations/auth-organizations";
import {
	resolveOrganizationDocumentErrorMessage,
	startCurrentCenterAgentMemberResearch,
} from "#/lib/organizations/organization-documents";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationNewOrganizationPath,
} from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { listActiveProfilesByKind } from "#/lib/profiles/human-profiles";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import {
	centerAgentMemberResearchQueryKeys,
	centerAgentMemberResearchStatusQueryOptions,
} from "#/query/organizations/center-agent-member-research";
import {
	organizationMemberOpenMeldServiceStatusesQueryOptions,
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
	data?: OrganizationDirectoryResponse;
	error: { message?: string } | null;
	isError: boolean;
	isPending: boolean;
};

type HumanDirectMessageIntent = {
	organizationId: string;
	organizationSlug: string;
	targetProfileId: string;
};

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

export function DirectoryMembersOverview(input: {
	account: AppShellAccount;
	currentOrganization: OrganizationSummary;
	currentUserId: string;
	directoryQuery: DirectoryQueryState;
	focusProfileId: string | null;
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	storageScope: string;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const directMessageIntentInFlightRef = useRef(false);
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
	const memberOpenMeldServiceStatusesQuery = useQuery(
		organizationMemberOpenMeldServiceStatusesQueryOptions({
			enabled: !isPersonalWorkspace,
			organizationId: input.currentOrganization.id,
		})
	);
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
	const personalHumanProfiles = listActiveProfilesByKind(
		personalProfilesQuery.data ?? [],
		"human"
	);
	const documentsStatus = resolveDirectoryDocumentsStatus({
		isError: documentsQuery.isError,
		isSuccess: documentsQuery.isSuccess,
	});
	const currentMemberOpenMeldServiceStatuses =
		memberOpenMeldServiceStatusesQuery.isError
			? []
			: (memberOpenMeldServiceStatusesQuery.data?.members ?? []);
	const memberOpenMeldServiceStatesByUserId = new Map(
		currentMemberOpenMeldServiceStatuses.map((member) => [
			member.userId,
			member.state,
		])
	);
	const memberOpenMeldServiceFallbackState: DirectoryMemberOpenMeldServiceDisplayState =
		memberOpenMeldServiceStatusesQuery.isPending ? "checking" : "unknown";
	const memberRows = isPersonalWorkspace
		? buildPersonalHumanProfileRows({
				account: input.account,
				canCreateHumanProfile,
				canCreateProfiles: documentsQuery.data?.canManage ?? false,
				documents: documentsQuery.data?.documents ?? [],
				documentsStatus,
				orgSlug: input.currentOrganization.slug,
				profiles: personalHumanProfiles,
				subjectUserId: documentsQuery.data?.currentUserId ?? "",
			})
		: buildOrganizationHumanProfileRows({
				canCreateProfiles: documentsQuery.data?.canManage ?? false,
				currentUserId: input.currentUserId,
				documents: documentsQuery.data?.documents ?? [],
				documentsStatus,
				memberOpenMeldServiceFallbackState,
				memberOpenMeldServiceStatesByUserId,
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
		researchIsPending: researchMutation.isPending,
	});
	const profilesSection = (
		<DirectoryHumanProfilesSection
			activeBatch={activeResearchBatch}
			canCreateProfile={canCreateHumanProfile}
			emptyMessage={profilesEmptyMessage}
			errorMessage={profilesError}
			focusProfileId={input.focusProfileId}
			latestBatch={latestResearchBatch}
			memberResearchError={researchErrors.member}
			members={memberRows}
			onCreateProfile={input.onCreateProfile}
			onFocusConsumed={input.onFocusConsumed}
			onOpenDirectMessage={openHumanDirectMessage}
			onResearch={(subjectUserId) =>
				researchMutation.mutate({ scope: "member", subjectUserId })
			}
			onResearchAll={() => researchMutation.mutate({ scope: "all" })}
			pendingResearch={researchMutation.variables}
			researchErrorMessage={researchErrors.section}
			state={profilesViewState}
		/>
	);

	if (isPersonalWorkspace) {
		return (
			<div className="flex flex-col gap-4">
				<PersonalWorkspaceInvitationGuidance
					createOrganizationPath={buildOrganizationNewOrganizationPath(
						input.currentOrganization.slug
					)}
					title="Invite members"
				/>
				{documentsQuery.isError ? (
					<DocumentProfileLinksError onRetry={() => documentsQuery.refetch()} />
				) : null}
				{profilesSection}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<DirectoryInvitePanel
				canInvite={canInvite}
				isRoleError={roleQuery.isError}
				isRolePending={roleQuery.isPending}
				organizationId={input.currentOrganization.id}
			/>
			{documentsQuery.isError ? (
				<DocumentProfileLinksError onRetry={() => documentsQuery.refetch()} />
			) : null}
			{profilesSection}
		</div>
	);
}

function DirectoryInvitePanel(input: {
	canInvite: boolean;
	isRoleError: boolean;
	isRolePending: boolean;
	organizationId: string;
}) {
	if (input.isRolePending) {
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

	if (input.isRoleError) {
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

	if (!input.canInvite) {
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
			queryClient
				.invalidateQueries({
					queryKey: organizationQueryKeys.directory(input.organizationId),
				})
				.catch(() => undefined);
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
			? "OpenMeld could not load Human Profiles right now."
			: null;
	}
	if (!input.directoryFailed) {
		return null;
	}
	return (
		input.directoryErrorMessage ??
		"OpenMeld could not load organization Human Profiles right now."
	);
}

function DocumentProfileLinksError(input: { onRetry: () => void }) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4">
			<p className="text-destructive text-sm">
				Report links are unavailable because Documents could not be loaded.
			</p>
			<Button onClick={input.onRetry} size="sm" variant="outline">
				Retry
			</Button>
		</div>
	);
}
