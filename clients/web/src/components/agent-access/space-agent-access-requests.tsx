import type {
	AgentAccessDecision,
	AgentAccessRequestView,
	HarnessKind,
} from "@openmeld/schemas";
import {
	HOSTED_HARNESS_KIND,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useState } from "react";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { useMemberAgentIndex } from "#/components/member-agents/use-member-agents";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "#/components/spaces/primitives/message";
import { MessageScrollerItem } from "#/components/spaces/primitives/message-scroller";
import { SpaceComposerTray } from "#/components/spaces/space-composer-tray";
import {
	resolveSpaceMessageBubblePresentationClass,
	SPACE_MESSAGE_CONTENT_PADDING_CLASS,
} from "#/components/spaces/space-message-bubble-style";
import { SpaceMessageProfileAvatar } from "#/components/spaces/space-message-profile-avatar";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useOpenDirectMessage } from "#/lib/spaces/use-open-direct-message";
import {
	useAgentAccessRequests,
	useDecideAgentAccessRequest,
	useWithdrawAgentAccessRequest,
} from "#/query/agent-access";
import {
	agentAccessDecisionLabel,
	agentAccessMessageRequesterLabel,
	canMessageAgentAccessRequester,
} from "./agent-access-request-card";

const RECENT_OUTCOME_MS = 24 * 60 * 60 * 1000;

/** What the requester sees about one request in this Space. */
export function requesterAgentAccessCopy(
	request: AgentAccessRequestView
): string | null {
	const { agentProfileName: agent, ownerName: owner } = request;
	switch (request.status) {
		case "pending":
			return request.kind === "space_join"
				? `Waiting for ${owner} to add ${agent}.`
				: `Waiting for ${owner} to allow ${agent}.`;
		case "declined":
			return `${owner} declined, so ${agent} won't reply to that message.`;
		case "voided":
			return `Your request for ${agent} ended because the message was edited or deleted.`;
		case "ignored":
			return `${owner} didn't add ${agent} to this Space.`;
		case "replied_by_dm":
			return `${owner} replied to you by DM.`;
		default:
			return null;
	}
}

/** The owner's one-line summary, for the bar above the composer. */
export function ownerAgentAccessSummary(
	request: AgentAccessRequestView
): string {
	return request.kind === "space_join"
		? `${request.requesterName} asked to add ${request.agentProfileName} here`
		: `${request.requesterName} wants to use ${request.agentProfileName}`;
}

/** The owner's explanation, in the request preview in the conversation. */
export function ownerAgentAccessDescription(
	request: AgentAccessRequestView
): string {
	if (request.kind !== "space_join") {
		return `${request.requesterName} wants ${request.agentProfileName} to answer their message. It waits until you choose.`;
	}
	return request.sourceSignalId
		? `${request.requesterName} asked to add it to this Space. If you add it, it joins and answers their message.`
		: `${request.requesterName} asked to add it to this Space.`;
}

/**
 * Splits the owner's decisions into one primary action and the rest, which
 * sit in an overflow menu. Core orders the decisions; the first is primary.
 */
export function splitAgentAccessDecisions(
	decisions: readonly AgentAccessDecision[]
): {
	primary: AgentAccessDecision | null;
	secondary: AgentAccessDecision[];
} {
	const [primary = null, ...secondary] = decisions;
	return { primary, secondary };
}

/** The newest request per Agent and person, so a retry replaces an old outcome. */
function latestRequests(
	requests: readonly AgentAccessRequestView[]
): AgentAccessRequestView[] {
	const latest = new Map<string, AgentAccessRequestView>();
	for (const request of requests) {
		const key = `${request.viewerRole}:${request.agentProfileId}:${request.requesterProfileId}`;
		const current = latest.get(key);
		if (!current || current.createdAt < request.createdAt) {
			latest.set(key, request);
		}
	}
	return [...latest.values()];
}

/** Pending requests, plus the requester's recent outcomes. */
export function selectVisibleSpaceAgentAccessRequests(
	requests: readonly AgentAccessRequestView[],
	nowMs: number
): AgentAccessRequestView[] {
	return latestRequests(requests).filter(
		(request) =>
			request.status === "pending" ||
			(request.viewerRole === "requester" &&
				nowMs - Date.parse(request.decidedAt ?? request.createdAt) <
					RECENT_OUTCOME_MS &&
				requesterAgentAccessCopy(request) !== null)
	);
}

export type SpaceAgentAccessRequestsState = {
	requests: readonly AgentAccessRequestView[];
	busy: boolean;
	error: string | null;
	decide: (
		request: AgentAccessRequestView,
		decision: AgentAccessDecision
	) => Promise<void>;
	withdraw: (request: AgentAccessRequestView) => void;
	/** Opens the owner's Direct Message with the requester; nothing is decided. */
	messageRequester: (request: AgentAccessRequestView) => void;
	messagePending: boolean;
};

/**
 * Consent requests in one Space. The bar above the composer and the preview
 * in the conversation read this one state, so an answer from either place
 * disables both and shows one error.
 */
export function useSpaceAgentAccessRequests(
	spaceId: string | undefined
): SpaceAgentAccessRequestsState {
	const query = useAgentAccessRequests(
		{ spaceId: spaceId ?? "" },
		{ enabled: Boolean(spaceId) }
	);
	const decideMutation = useDecideAgentAccessRequest();
	const withdrawMutation = useWithdrawAgentAccessRequest();
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const directMessage = useOpenDirectMessage({
		organizationId: organization?.id ?? null,
		orgSlug: organization?.slug,
	});
	const [nowMs] = useState(() => Date.now());
	const requests = spaceId
		? selectVisibleSpaceAgentAccessRequests(query.data ?? [], nowMs)
		: [];
	return {
		requests,
		busy: decideMutation.isPending || withdrawMutation.isPending,
		error:
			decideMutation.error?.message ?? withdrawMutation.error?.message ?? null,
		decide: async (request, decision) => {
			withdrawMutation.reset();
			// A failed answer is shown from the mutation state.
			await decideMutation
				.mutateAsync({ decision, requestId: request.id })
				.catch(() => null);
		},
		withdraw: (request) => {
			decideMutation.reset();
			withdrawMutation.mutate(request.id);
		},
		messageRequester: (request) => {
			directMessage.open(request.requesterProfileId);
		},
		messagePending: directMessage.pendingProfileId !== null,
	};
}

function agentAccessPreviewElementId(requestId: string): string {
	return `agent-access-request-${requestId}`;
}

/**
 * The requested Agent drawn with the same avatar as its message rows. The
 * Agent is not in this Space yet, so its Harness supplies the controller
 * when the saved profile is not loaded.
 */
function RequestedAgentAvatar(input: {
	profileId: string;
	profileName: string;
	/** Fixed size for the composer bar; message rows size it responsively. */
	size?: number;
}) {
	const harnessKind = useMemberAgentIndex().index.byProfileId.get(
		input.profileId
	)?.harnessKind;
	const agentControllerRef = agentControllerRefForHarness(harnessKind);
	if (input.size) {
		return (
			<RemoteAgentAvatar
				agentControllerRef={agentControllerRef}
				profileId={input.profileId}
				profileName={input.profileName}
				size={input.size}
			/>
		);
	}
	return (
		<SpaceMessageProfileAvatar
			agentControllerRef={agentControllerRef}
			displayName={input.profileName}
			profileId={input.profileId}
			profileKind="agent"
			responsive
		/>
	);
}

function agentControllerRefForHarness(
	harnessKind: HarnessKind | undefined
): string | null {
	if (!harnessKind) {
		return null;
	}
	return harnessKind === HOSTED_HARNESS_KIND
		? HOSTED_REMOTE_AGENT_CONTROLLER_REF
		: `builtin:${harnessKind}`;
}

/** One primary decision, the rest in an overflow menu. */
function AgentAccessDecisionActions(input: {
	request: AgentAccessRequestView;
	state: SpaceAgentAccessRequestsState;
}) {
	const { primary, secondary } = splitAgentAccessDecisions(
		input.request.availableDecisions
	);
	if (!primary) {
		return null;
	}
	const { request, state } = input;
	const canMessage = canMessageAgentAccessRequester(request);
	return (
		<div className="flex shrink-0 items-center gap-1">
			<Button
				disabled={state.busy}
				onClick={() => state.decide(request, primary)}
				size="sm"
			>
				{agentAccessDecisionLabel(primary, request)}
			</Button>
			{secondary.length > 0 || canMessage ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="More choices"
								disabled={state.busy}
								size="icon-sm"
								variant="ghost"
							>
								<DotsThreeIcon size={16} />
							</Button>
						}
					/>
					<FluidDropdownMenuContent align="end">
						<FluidDropdownMenuGroup>
							{canMessage ? (
								<FluidDropdownMenuItem
									disabled={state.messagePending}
									index={0}
									onClick={() => state.messageRequester(request)}
								>
									{agentAccessMessageRequesterLabel(request)}
								</FluidDropdownMenuItem>
							) : null}
							{secondary.map((decision, index) => (
								<FluidDropdownMenuItem
									disabled={state.busy}
									index={index + (canMessage ? 1 : 0)}
									key={decision}
									onClick={() => state.decide(request, decision)}
								>
									{agentAccessDecisionLabel(decision, request)}
								</FluidDropdownMenuItem>
							))}
						</FluidDropdownMenuGroup>
					</FluidDropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}

/**
 * The compact bar above the composer: one line per request, the action on
 * the right. It sits at the top of the composer tray stack, above pending
 * Agent actions and queued messages.
 */
export function SpaceAgentAccessBar(input: {
	/** Whether the request previews are mounted, so the summary can reveal one. */
	previewsVisible?: boolean;
	state: SpaceAgentAccessRequestsState;
}) {
	const { state } = input;
	if (state.requests.length === 0) {
		return null;
	}
	return (
		<SpaceComposerTray
			aria-label="Agent requests"
			aria-live="polite"
			data-slot="space-agent-access-bar"
		>
			<ul className="px-1.5 pt-1">
				{state.requests.map((request) => (
					<li
						className="flex min-h-10 min-w-0 items-center gap-2 py-1 ps-1.5"
						data-agent-access-request-id={request.id}
						key={request.id}
					>
						<RequestedAgentAvatar
							profileId={request.agentProfileId}
							profileName={request.agentProfileName}
							size={20}
						/>
						{request.viewerRole === "owner" ? (
							<OwnerBarRow
								previewVisible={input.previewsVisible !== false}
								request={request}
								state={state}
							/>
						) : (
							<RequesterBarRow request={request} state={state} />
						)}
					</li>
				))}
			</ul>
			{state.error ? (
				<p className="px-3 pb-1 text-destructive text-xs" role="alert">
					{state.error}
				</p>
			) : null}
		</SpaceComposerTray>
	);
}

function OwnerBarRow(input: {
	previewVisible: boolean;
	request: AgentAccessRequestView;
	state: SpaceAgentAccessRequestsState;
}) {
	const reduceMotion = useReducedMotion();
	const summary = ownerAgentAccessSummary(input.request);
	const className = "min-w-0 flex-1 truncate text-left text-[13px] leading-5";
	return (
		<>
			{input.previewVisible ? (
				<button
					className={cn(
						className,
						"cursor-pointer rounded-sm border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					)}
					onClick={() =>
						document
							.getElementById(agentAccessPreviewElementId(input.request.id))
							?.scrollIntoView({
								behavior: reduceMotion ? "auto" : "smooth",
								block: "nearest",
							})
					}
					title={summary}
					type="button"
				>
					{summary}
				</button>
			) : (
				// Older history is shown, so there is no preview to reveal.
				<p className={className} title={summary}>
					{summary}
				</p>
			)}
			<AgentAccessDecisionActions request={input.request} state={input.state} />
		</>
	);
}

function RequesterBarRow(input: {
	request: AgentAccessRequestView;
	state: SpaceAgentAccessRequestsState;
}) {
	const copy = requesterAgentAccessCopy(input.request);
	return (
		<>
			<p
				className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground leading-5"
				title={copy ?? undefined}
			>
				{copy}
			</p>
			{input.request.status === "pending" ? (
				<Button
					className="shrink-0"
					disabled={input.state.busy}
					onClick={() => input.state.withdraw(input.request)}
					size="sm"
					variant="ghost"
				>
					Withdraw
				</Button>
			) : null}
		</>
	);
}

/**
 * The owner's preview of each pending request, at the end of the
 * conversation. It reads like a message from the requested Agent so the
 * owner sees who would join, but it is presentation only: no timestamp,
 * never a published message.
 */
export function SpaceAgentAccessPreviews(input: {
	/** False while older history is shown; the preview belongs at the end. */
	showsLatestMessages?: boolean;
	state: SpaceAgentAccessRequestsState;
}) {
	if (input.showsLatestMessages === false) {
		return null;
	}
	const pending = input.state.requests.filter(
		(request) =>
			request.viewerRole === "owner" && request.availableDecisions.length > 0
	);
	return pending.map((request) => (
		<MessageScrollerItem
			className="[content-visibility:visible]"
			key={request.id}
			messageId={`agent-access-request:${request.id}`}
		>
			<Message
				aria-label={`Request to add ${request.agentProfileName}`}
				className="px-0 py-1.5"
				data-slot="space-agent-access-preview"
				id={agentAccessPreviewElementId(request.id)}
				role="group"
			>
				<MessageContent className="w-full min-w-0 gap-0">
					<MessageHeader className="items-center gap-1.5 px-0">
						<RequestedAgentAvatar
							profileId={request.agentProfileId}
							profileName={request.agentProfileName}
						/>
						<span className="min-w-0 truncate text-foreground text-xs">
							{request.agentProfileName}
						</span>
						<span className="shrink-0 text-muted-foreground">·</span>
						<span className="shrink-0 text-muted-foreground">
							{request.kind === "space_join"
								? "Not in this Space yet"
								: "Needs your OK"}
						</span>
					</MessageHeader>
					<div
						className={cn(
							resolveSpaceMessageBubblePresentationClass({ isSelf: false }),
							"flex w-fit max-w-full flex-col gap-3 border-border border-dashed bg-card text-sm",
							SPACE_MESSAGE_CONTENT_PADDING_CLASS
						)}
					>
						<p className="text-muted-foreground">
							{ownerAgentAccessDescription(request)}
						</p>
						<div className="flex items-center justify-start">
							<AgentAccessDecisionActions
								request={request}
								state={input.state}
							/>
						</div>
					</div>
				</MessageContent>
			</Message>
		</MessageScrollerItem>
	));
}
