"use client";

import { TEAMMATE_AGENT_REQUESTS_ENABLED } from "@openmeld/schemas";

import type {
	AgentProfileCreationRequest,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
	continuePendingAgentProfileCreationLocalSetup,
	readPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import {
	cancelAgentProfileCreationRequest,
	decideAgentProfileCreationRequest,
	retryAgentProfileCreationRequest,
} from "#/lib/profiles/agent-profile-creation-requests";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	agentProfileCreationRequestQueryKeys,
	agentProfileCreationRequestsQueryOptions,
} from "#/query/profiles/agent-profile-creation-requests";

type DirectoryMember = OrganizationProfileDirectoryResponse["members"][number];

export function AgentProfileCreationRequestsPanel(input: {
	currentUserId: string;
	directory:
		| OrganizationProfileDirectoryResponse
		| OrganizationDirectoryResponse;
	focusRequestId: string | null;
	onCreateAgent: () => void;
	onOpenAgent: (profileId: string) => void;
	organizationId: string;
	storageScope: string;
}) {
	const queryClient = useQueryClient();
	const focusedRequestRef = useRef<HTMLElement | null>(null);
	const selectedHumanProfileId =
		input.directory.members.find(
			(member) => member.userId === input.currentUserId
		)?.humanProfile?.profileId ?? null;
	const requestsQuery = useQuery(
		agentProfileCreationRequestsQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	// Retain the teammate UI for reopening, but also filter stale client caches.
	const visibleRequests =
		requestsQuery.data?.requests.filter(
			(request) =>
				TEAMMATE_AGENT_REQUESTS_ENABLED ||
				request.requesterUserId === request.targetOwnerUserId
		) ?? [];
	const requestCount = visibleRequests.length;
	const mutation = useMutation({
		mutationFn: async (action: RequestAction) => {
			switch (action.kind) {
				case "approve":
				case "decline":
					return {
						localSetup: null,
						result: await decideAgentProfileCreationRequest({
							decision: action.kind,
							organizationId: input.organizationId,
							requestId: action.request.id,
						}),
					};
				case "cancel":
					return {
						localSetup: null,
						result: await cancelAgentProfileCreationRequest({
							organizationId: input.organizationId,
							requestId: action.request.id,
						}),
					};
				case "retry": {
					const result =
						action.request.status === "completed"
							? { request: action.request }
							: await retryAgentProfileCreationRequest({
									organizationId: input.organizationId,
									requestId: action.request.id,
								});
					const localSetup =
						await continuePendingAgentProfileCreationLocalSetup({
							organizationId: input.organizationId,
							request: result.request,
							selectedHumanProfileId,
							storageScope: input.storageScope,
						});
					return { localSetup, result };
				}
				default:
					throw new Error(`Unsupported request action: ${action.kind}`);
			}
		},
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: async ({ localSetup, result }) => {
			if (localSetup?.failureMessage) {
				toast.warning(
					`${result.request.profileName} setup is still incomplete. ${localSetup.failureMessage} Open the Agent to finish setup.`
				);
			}
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
						input.organizationId
					),
				}),
				result.request.createdAgentProfileId
					? Promise.all([
							queryClient.invalidateQueries({
								queryKey: organizationQueryKeys.directory(input.organizationId),
							}),
							queryClient.invalidateQueries({
								queryKey: organizationQueryKeys.profileDirectory(
									input.organizationId
								),
							}),
							queryClient.invalidateQueries({
								queryKey: organizationQueryKeys.agentRuntimeOverview(
									input.organizationId
								),
							}),
						])
					: Promise.resolve(),
			]);
		},
	});

	useEffect(() => {
		if (
			requestCount === 0 ||
			!(input.focusRequestId && focusedRequestRef.current)
		) {
			return;
		}
		focusedRequestRef.current.focus({ preventScroll: true });
		focusedRequestRef.current.scrollIntoView({
			behavior: "auto",
			block: "center",
		});
	}, [input.focusRequestId, requestCount]);

	const membersByUserId = useMemo(
		() =>
			new Map(input.directory.members.map((member) => [member.userId, member])),
		[input.directory.members]
	);
	const profilesById = useMemo(
		() =>
			new Map([
				...input.directory.members.flatMap((member) =>
					member.humanProfile
						? [[member.humanProfile.profileId, member.user.name] as const]
						: []
				),
				...input.directory.agentProfiles.map(
					(profile) => [profile.profileId, profile.profileName] as const
				),
			]),
		[input.directory]
	);
	const hasAnotherMember = input.directory.members.some(
		(member) => member.userId !== input.currentUserId
	);

	return (
		<div className="flex min-w-0 flex-col gap-3">
			{TEAMMATE_AGENT_REQUESTS_ENABLED ? (
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="max-w-2xl text-muted-foreground text-xs leading-5">
						Track requests you sent and approve requests for Agents that a
						teammate wants you to own.
					</p>
					<Button
						disabled={!hasAnotherMember}
						onClick={input.onCreateAgent}
						size="sm"
						type="button"
					>
						Request Agent for teammate
					</Button>
				</div>
			) : (
				<p className="text-muted-foreground text-xs">
					Check the progress of Agents you created and finish any remaining
					setup.
				</p>
			)}

			{requestsQuery.isPending ? (
				<p className="rounded-md border border-border/70 px-4 py-6 text-muted-foreground text-sm">
					Loading Agent setup…
				</p>
			) : null}
			{requestsQuery.isError ? (
				<div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-4 py-3">
					<p className="text-destructive text-sm">
						{requestsQuery.error.message}
					</p>
					<Button
						onClick={() => requestsQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			) : null}
			{requestsQuery.data && visibleRequests.length === 0 ? (
				<p className="rounded-md border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
					No Agent setup to show.
				</p>
			) : null}
			{visibleRequests.map((request) => {
				const isFocused = request.id === input.focusRequestId;
				const localSetup =
					request.status === "completed" && request.createdAgentProfileId
						? readPendingAgentProfileCreationLocalSetup({
								organizationId: input.organizationId,
								requestId: request.id,
								storageScope: input.storageScope,
							})
						: null;
				const localSetupPending = Boolean(localSetup);
				const localSetupPathMissing = localSetup?.workspacePath === null;
				return (
					<article
						className={`rounded-md border bg-card px-4 py-3 outline-none ${
							isFocused ? "border-ring ring-2 ring-ring/20" : "border-border"
						}`}
						key={request.id}
						ref={isFocused ? focusedRequestRef : undefined}
						tabIndex={isFocused ? -1 : undefined}
					>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="font-medium text-foreground text-sm">
										{request.profileName}
									</h2>
									<Badge
										variant={statusBadgeVariant(request, localSetupPending)}
									>
										{statusLabel(request, localSetupPending)}
									</Badge>
								</div>
								<p className="text-muted-foreground text-xs leading-5">
									{requestSummary({
										actorName: profilesById.get(request.actorProfileId) ?? null,
										currentUserId: input.currentUserId,
										membersByUserId,
										request,
									})}
								</p>
								{request.failureMessage ? (
									<p className="text-destructive text-xs leading-5">
										{request.failureMessage}
									</p>
								) : null}
								{localSetupPathMissing ? (
									<p className="text-muted-foreground text-xs leading-5">
										Choose the custom working folder again in Agent settings on
										this computer.
									</p>
								) : null}
							</div>
							<RequestActions
								currentUserId={input.currentUserId}
								isPending={mutation.isPending}
								localSetupPending={localSetupPending}
								localSetupRetryAvailable={!localSetupPathMissing}
								onAction={(kind) => mutation.mutate({ kind, request })}
								onOpenAgent={input.onOpenAgent}
								request={request}
							/>
						</div>
					</article>
				);
			})}
		</div>
	);
}

type RequestAction = {
	kind: "approve" | "cancel" | "decline" | "retry";
	request: AgentProfileCreationRequest;
};

function RequestActions(input: {
	currentUserId: string;
	isPending: boolean;
	localSetupPending: boolean;
	localSetupRetryAvailable: boolean;
	onAction: (kind: RequestAction["kind"]) => void;
	onOpenAgent: (profileId: string) => void;
	request: AgentProfileCreationRequest;
}) {
	const isRequester = input.request.requesterUserId === input.currentUserId;
	const isTarget = input.request.targetOwnerUserId === input.currentUserId;
	if (
		input.request.status === "completed" &&
		input.request.createdAgentProfileId &&
		!input.localSetupPending
	) {
		return (
			<Button
				onClick={() =>
					input.onOpenAgent(input.request.createdAgentProfileId ?? "")
				}
				size="sm"
				variant="outline"
			>
				View Agent
			</Button>
		);
	}
	if (
		input.request.createdAgentProfileId &&
		(input.request.status === "failed" || input.localSetupPending)
	) {
		return (
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button
					onClick={() =>
						input.onOpenAgent(input.request.createdAgentProfileId ?? "")
					}
					size="sm"
					variant="outline"
				>
					View Agent
				</Button>
				{input.request.status === "failed" || input.localSetupRetryAvailable ? (
					<Button
						disabled={input.isPending}
						onClick={() => input.onAction("retry")}
						size="sm"
					>
						Retry setup
					</Button>
				) : null}
			</div>
		);
	}
	if (input.request.status === "pending" && isTarget) {
		return (
			<div className="flex shrink-0 gap-2">
				<Button
					disabled={input.isPending}
					onClick={() => input.onAction("decline")}
					size="sm"
					variant="outline"
				>
					Decline
				</Button>
				<Button
					disabled={input.isPending}
					onClick={() => input.onAction("approve")}
					size="sm"
				>
					Approve
				</Button>
			</div>
		);
	}
	if (input.request.status === "failed") {
		return (
			<div className="flex shrink-0 flex-wrap gap-2">
				{isRequester ? (
					<Button
						disabled={input.isPending}
						onClick={() => input.onAction("cancel")}
						size="sm"
						variant="outline"
					>
						Cancel
					</Button>
				) : null}
				<Button
					disabled={input.isPending}
					onClick={() => input.onAction("retry")}
					size="sm"
				>
					Retry
				</Button>
			</div>
		);
	}
	if (isRequester && input.request.status === "pending") {
		return (
			<Button
				disabled={input.isPending}
				onClick={() => input.onAction("cancel")}
				size="sm"
				variant="outline"
			>
				Cancel request
			</Button>
		);
	}
	return null;
}

function statusLabel(
	request: AgentProfileCreationRequest,
	localSetupPending: boolean
): string {
	if (localSetupPending) {
		return "Profile created, setup incomplete";
	}
	if (request.status === "approved" && request.createdAgentProfileId) {
		return "Finishing setup…";
	}
	if (request.status === "failed" && request.createdAgentProfileId) {
		return "Profile created, setup incomplete";
	}
	if (request.status === "pending") {
		return "Waiting for approval";
	}
	if (request.status === "approved") {
		return "Creating Agent…";
	}
	if (request.status === "completed") {
		return "Agent created";
	}
	if (
		request.status === "declined" &&
		request.statusReason === "target_policy_denied"
	) {
		return "Not allowed by settings";
	}
	return request.status[0]?.toUpperCase() + request.status.slice(1);
}

function statusBadgeVariant(
	request: AgentProfileCreationRequest,
	localSetupPending: boolean
) {
	if (
		localSetupPending ||
		request.status === "completed" ||
		(request.status === "failed" && request.createdAgentProfileId)
	) {
		return "secondary" as const;
	}
	if (request.status === "declined" || request.status === "failed") {
		return "destructive" as const;
	}
	return "outline" as const;
}

function requestSummary(input: {
	actorName: string | null;
	currentUserId: string;
	membersByUserId: ReadonlyMap<string, DirectoryMember>;
	request: AgentProfileCreationRequest;
}): string {
	if (input.request.requesterUserId === input.request.targetOwnerUserId) {
		return `Setup started via ${sourceLabel(input.request.source)}.`;
	}
	const requester = memberName(
		input.membersByUserId,
		input.request.requesterUserId,
		input.currentUserId
	);
	const owner = memberName(
		input.membersByUserId,
		input.request.targetOwnerUserId,
		input.currentUserId
	);
	const actor = input.actorName ? ` as ${input.actorName}` : "";
	return `${requester} requested this for ${owner} via ${sourceLabel(input.request.source)}${actor}.`;
}

function memberName(
	membersByUserId: ReadonlyMap<string, DirectoryMember>,
	userId: string,
	currentUserId: string
): string {
	if (userId === currentUserId) {
		return "You";
	}
	return membersByUserId.get(userId)?.user.name ?? "A teammate";
}

function sourceLabel(source: AgentProfileCreationRequest["source"]): string {
	switch (source) {
		case "web":
			return "Web";
		case "cli":
			return "OpenMeld CLI";
		case "local_agent":
			return "a local agent";
		case "center_agent":
			return "the Center Agent";
		default:
			return assertNever(source);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unsupported value: ${String(value)}`);
}
