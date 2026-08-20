"use client";

import type {
	AgentProfileCreationRequest,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	cancelAgentProfileCreationRequest,
	createAgentProfileCreationRequest,
	decideAgentProfileCreationRequest,
	retryAgentProfileCreationRequest,
} from "#/lib/profiles/agent-profile-creation-requests";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	agentProfileCreationRequestQueryKeys,
	agentProfileCreationRequestsQueryOptions,
} from "#/query/profiles/agent-profile-creation-requests";

type DirectoryMember = OrganizationDirectoryResponse["members"][number];

export function AgentProfileCreationRequestsPanel(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse;
	focusRequestId: string | null;
	onOpenAgent: (profileId: string) => void;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const focusedRequestRef = useRef<HTMLElement | null>(null);
	const requestsQuery = useQuery(
		agentProfileCreationRequestsQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const requestCount = requestsQuery.data?.requests.length ?? 0;
	const mutation = useMutation({
		mutationFn: async (action: RequestAction) => {
			switch (action.kind) {
				case "approve":
				case "decline":
					return await decideAgentProfileCreationRequest({
						decision: action.kind,
						organizationId: input.organizationId,
						requestId: action.requestId,
					});
				case "cancel":
					return await cancelAgentProfileCreationRequest({
						organizationId: input.organizationId,
						requestId: action.requestId,
					});
				case "retry":
					return await retryAgentProfileCreationRequest({
						organizationId: input.organizationId,
						requestId: action.requestId,
					});
				default:
					throw new Error(`Unsupported request action: ${action.kind}`);
			}
		},
		onError: (error) => {
			toast.error(error.message);
		},
		onSuccess: async (result) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
						input.organizationId
					),
				}),
				result.request.status === "completed"
					? queryClient.invalidateQueries({
							queryKey: organizationQueryKeys.directory(input.organizationId),
						})
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
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="max-w-2xl text-muted-foreground text-xs leading-5">
					Track requests you sent and approve requests for Agents that a
					teammate wants you to own.
				</p>
				<Button
					disabled={!hasAnotherMember}
					onClick={() => setIsCreateOpen(true)}
					size="sm"
					type="button"
				>
					Request Agent for teammate
				</Button>
			</div>

			{requestsQuery.isPending ? (
				<p className="rounded-md border border-border/70 px-4 py-6 text-muted-foreground text-sm">
					Loading requests…
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
			{requestsQuery.data?.requests.length === 0 ? (
				<p className="rounded-md border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
					No Agent requests yet.
				</p>
			) : null}
			{requestsQuery.data?.requests.map((request) => {
				const isFocused = request.id === input.focusRequestId;
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
									<Badge variant={statusBadgeVariant(request.status)}>
										{statusLabel(request)}
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
							</div>
							<RequestActions
								currentUserId={input.currentUserId}
								isPending={mutation.isPending}
								onAction={(kind) =>
									mutation.mutate({ kind, requestId: request.id })
								}
								onOpenAgent={input.onOpenAgent}
								request={request}
							/>
						</div>
					</article>
				);
			})}

			{isCreateOpen ? (
				<CreateAgentRequestDialog
					currentUserId={input.currentUserId}
					members={input.directory.members}
					onCreated={async () => {
						setIsCreateOpen(false);
						await queryClient.invalidateQueries({
							queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
								input.organizationId
							),
						});
					}}
					onOpenChange={setIsCreateOpen}
					organizationId={input.organizationId}
				/>
			) : null}
		</div>
	);
}

type RequestAction = {
	kind: "approve" | "cancel" | "decline" | "retry";
	requestId: string;
};

function RequestActions(input: {
	currentUserId: string;
	isPending: boolean;
	onAction: (kind: RequestAction["kind"]) => void;
	onOpenAgent: (profileId: string) => void;
	request: AgentProfileCreationRequest;
}) {
	const isRequester = input.request.requesterUserId === input.currentUserId;
	const isTarget = input.request.targetOwnerUserId === input.currentUserId;
	if (
		input.request.status === "completed" &&
		input.request.createdAgentProfileId
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
			<div className="flex shrink-0 gap-2">
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
	if (
		isRequester &&
		(input.request.status === "pending" || input.request.status === "approved")
	) {
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

function CreateAgentRequestDialog(input: {
	currentUserId: string;
	members: readonly DirectoryMember[];
	onCreated: () => Promise<void>;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
}) {
	const candidates = input.members.filter(
		(member) => member.userId !== input.currentUserId
	);
	const [targetOwnerUserId, setTargetOwnerUserId] = useState(
		candidates[0]?.userId ?? ""
	);
	const [profileName, setProfileName] = useState("");
	const [idempotencyKey] = useState(
		() => `web-agent-request-${crypto.randomUUID()}`
	);
	const mutation = useMutation({
		mutationFn: async () =>
			await createAgentProfileCreationRequest({
				idempotencyKey,
				organizationId: input.organizationId,
				profileName,
				targetOwnerUserId,
			}),
		onError: (error) => toast.error(error.message),
		onSuccess: async (result) => {
			toast.success(createdRequestMessage(result.request.status));
			await input.onCreated();
		},
	});
	const selectedMember = candidates.find(
		(member) => member.userId === targetOwnerUserId
	);

	return (
		<Dialog onOpenChange={input.onOpenChange} open={true}>
			<DialogContent className="sm:max-w-md">
				<form
					onSubmit={(event: FormEvent) => {
						event.preventDefault();
						if (targetOwnerUserId && profileName.trim()) {
							mutation.mutate();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>Request an Agent for a teammate</DialogTitle>
						<DialogDescription>
							They’ll approve the request based on their settings. The Agent
							will belong to them.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-5">
						<div className="space-y-2">
							<Label htmlFor="agent-request-owner">Owner</Label>
							<Select
								onValueChange={setTargetOwnerUserId}
								value={targetOwnerUserId}
							>
								<SelectTrigger
									displayValue={
										selectedMember?.user.name ?? "Choose a teammate"
									}
									id="agent-request-owner"
								/>
								<SelectContent>
									{candidates.map((member, index) => (
										<SelectItem
											index={index}
											key={member.userId}
											value={member.userId}
										>
											{member.user.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
							<Label htmlFor="agent-request-name">Agent name</Label>
							<Input
								autoComplete="off"
								id="agent-request-name"
								maxLength={80}
								onChange={(event) => setProfileName(event.target.value)}
								placeholder="Release Reviewer"
								value={profileName}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={
								mutation.isPending || !targetOwnerUserId || !profileName.trim()
							}
							type="submit"
						>
							{mutation.isPending ? "Sending…" : "Send request"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function statusLabel(request: AgentProfileCreationRequest): string {
	if (request.status === "pending") {
		return "Waiting for approval";
	}
	if (request.status === "approved") {
		return "Approved";
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

function statusBadgeVariant(status: AgentProfileCreationRequest["status"]) {
	if (status === "completed") {
		return "secondary" as const;
	}
	if (status === "declined" || status === "failed") {
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

function createdRequestMessage(
	status: AgentProfileCreationRequest["status"]
): string {
	if (status === "completed") {
		return "Agent created.";
	}
	if (status === "declined") {
		return "This teammate doesn’t allow Agent creation requests.";
	}
	return "Request sent.";
}

function assertNever(value: never): never {
	throw new Error(`Unsupported value: ${String(value)}`);
}
