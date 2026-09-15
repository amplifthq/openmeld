"use client";

import { TEAMMATE_AGENT_REQUESTS_ENABLED } from "@openmeld/schemas";

import type {
	AgentProfileCreationRequest,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { formatAgentCreationFailure } from "#/lib/profiles/agent-creation-failure";
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
import { AgentCreationComputerRecovery } from "./agent-creation-computer-recovery";

type DirectoryMember = OrganizationProfileDirectoryResponse["members"][number];

export function AgentProfileCreationRequestsPanel(input: {
	currentUserId: string;
	directory:
		| OrganizationProfileDirectoryResponse
		| OrganizationDirectoryResponse;
	focusRequestId: string | null;
	onCreateAgent: () => void;
	onOpenAgent: (profileId: string) => void;
	onOpenRequest?: (requestId: string) => void;
	organizationId: string;
	orgSlug?: string;
	storageScope: string;
}) {
	const queryClient = useQueryClient();
	const [recoveryRequest, setRecoveryRequest] =
		useState<AgentProfileCreationRequest | null>(null);
	const focusedRequestRef = useRef<HTMLTableRowElement | null>(null);
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
		requestsQuery.data?.requests
			.filter(
				(request) =>
					TEAMMATE_AGENT_REQUESTS_ENABLED ||
					request.requesterUserId === request.targetOwnerUserId
			)
			.toSorted((left, right) =>
				right.createdAt.localeCompare(left.createdAt)
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
			if (result.request.status === "cancelled") {
				toast.success("Setup cancelled. No Agent was created.");
			}
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
			{recoveryRequest ? (
				<AgentCreationComputerRecovery
					currentUserId={input.currentUserId}
					onClose={() => setRecoveryRequest(null)}
					onRecovered={async (request) => {
						const setup = await continuePendingAgentProfileCreationLocalSetup({
							organizationId: input.organizationId,
							request,
							selectedHumanProfileId,
							storageScope: input.storageScope,
						});
						if (setup?.failureMessage) {
							toast.warning(setup.failureMessage);
						}
						await Promise.all([
							queryClient.invalidateQueries({
								queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
									input.organizationId
								),
							}),
							queryClient.invalidateQueries({
								queryKey: organizationQueryKeys.profileDirectory(
									input.organizationId
								),
							}),
						]);
						if (request.createdAgentProfileId) {
							input.onOpenAgent(request.createdAgentProfileId);
						} else {
							input.onOpenRequest?.(request.id);
							if (request.status === "failed") {
								toast.error(
									"Setup still needs attention. Review the latest attempt for the next step."
								);
							} else if (request.status === "cancelled") {
								toast.info(
									"This setup was cancelled. Select Restart setup on that attempt to continue."
								);
							} else {
								toast.success(
									"Setup started. You can follow its progress here."
								);
							}
						}
					}}
					orgSlug={input.orgSlug}
					request={recoveryRequest}
					storageScope={input.storageScope}
				/>
			) : null}
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
			) : null}

			{requestsQuery.isPending ? (
				<p className="rounded-md border border-border/70 px-4 py-6 text-muted-foreground text-sm">
					Loading Agent creation history…
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
					No Agent creation history yet.
				</p>
			) : null}
			{visibleRequests.length > 0 ? (
				<Table aria-label="Agent creation history">
					<TableHeader>
						<TableRow>
							<TableHead>Agent</TableHead>
							<TableHead>Result</TableHead>
							<TableHead>Started</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{visibleRequests.map((request, index) => {
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
								<TableRow
									className={`outline-none ${
										isFocused
											? "border-ring ring-2 ring-ring/20"
											: "border-border"
									}`}
									index={index}
									key={request.id}
									ref={isFocused ? focusedRequestRef : undefined}
									tabIndex={isFocused ? -1 : undefined}
								>
									<TableCell className="max-w-64 whitespace-normal align-top">
										<h2 className="font-medium text-foreground text-sm">
											{request.profileName}
										</h2>
										<p className="mt-1 text-muted-foreground text-xs leading-5">
											{requestSummary({
												actorName:
													profilesById.get(request.actorProfileId) ?? null,
												currentUserId: input.currentUserId,
												membersByUserId,
												request,
											})}
										</p>
									</TableCell>
									<TableCell className="max-w-md space-y-2 whitespace-normal align-top">
										<Badge
											variant={statusBadgeVariant(request, localSetupPending)}
										>
											{statusLabel(request, localSetupPending)}
										</Badge>
										{request.failureMessage ? (
											<p className="text-destructive text-xs leading-5">
												{formatAgentCreationFailure(
													request.failureMessage,
													Boolean(request.createdAgentProfileId)
												)}
											</p>
										) : null}
										{localSetupPathMissing ? (
											<p className="text-muted-foreground text-xs leading-5">
												Choose the custom working folder again in Agent settings
												on this computer.
											</p>
										) : null}
									</TableCell>
									<TableCell className="align-top text-muted-foreground">
										<time dateTime={request.createdAt}>
											{new Date(request.createdAt).toLocaleDateString("en-US", {
												month: "short",
												day: "numeric",
												year: "numeric",
											})}
										</time>
									</TableCell>
									<TableCell className="align-top">
										<RequestActions
											currentUserId={input.currentUserId}
											isPending={mutation.isPending}
											localSetupPending={localSetupPending}
											localSetupRetryAvailable={!localSetupPathMissing}
											onAction={(kind) => mutation.mutate({ kind, request })}
											onChooseComputer={() => setRecoveryRequest(request)}
											onOpenAgent={input.onOpenAgent}
											request={request}
										/>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			) : null}
		</div>
	);
}

type RequestAction = {
	kind: "approve" | "cancel" | "decline" | "retry";
	request: AgentProfileCreationRequest;
};

function RequestActions(input: {
	onChooseComputer: () => void;
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
	const canChooseComputer =
		isRequester &&
		isTarget &&
		Boolean(input.request.configuration?.targetComputerId) &&
		!input.request.createdAgentProfileId;
	if (input.request.status === "cancelled" && canChooseComputer) {
		return (
			<Button onClick={input.onChooseComputer} size="sm" variant="outline">
				Restart setup
			</Button>
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
						Cancel setup
					</Button>
				) : null}
				{canChooseComputer ? (
					<Button
						disabled={input.isPending}
						onClick={input.onChooseComputer}
						size="sm"
					>
						Choose computer
					</Button>
				) : (
					<Button
						disabled={input.isPending}
						onClick={() => input.onAction("retry")}
						size="sm"
					>
						Retry setup
					</Button>
				)}
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
		return "Needs attention";
	}
	if (request.status === "approved" && request.createdAgentProfileId) {
		return "Finishing setup…";
	}
	if (request.status === "failed" && request.createdAgentProfileId) {
		return "Needs attention";
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
		return `Started via ${sourceLabel(input.request.source)}.`;
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
