import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { HandIcon } from "@phosphor-icons/react";
import {
	type ColleagueAccess,
	type ColleagueAccessState,
	useColleagueAccessState,
} from "#/lib/agents/colleague-access-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";

// A Direct Message with a teammate's Agent whose owner answers first: the
// first message is the request (member-agent-program.md §7). The backend
// flow is unchanged; this is how the requester's Direct Message frames it.

export type DirectMessageAccessRequest = {
	agentName: string;
	ownerName: string;
	access: ColleagueAccess & {
		state: Exclude<ColleagueAccessState, "not_required" | "none">;
	};
};

const WHITESPACE = /\s+/u;

/** The owner's first name, for the shorter sentences. */
function ownerShortName(ownerName: string): string {
	return ownerName.trim().split(WHITESPACE)[0] || ownerName;
}

export function directMessageAccessRequestCopy(input: {
	agentName: string;
	ownerName: string;
}) {
	const { agentName: agent, ownerName: owner } = input;
	const short = ownerShortName(owner);
	return {
		emptyStateTitle: `Ask ${owner} to use ${agent}`,
		emptyStateDescription: `${short} sees your request first. ${agent} starts after ${short} approves.`,
		composerPlaceholder: `Tell ${short} what you need ${agent} for…`,
		waitingComposerHint: `${agent} will reply after ${short} approves`,
	};
}

/** The header badge, replacing "<owner> can view" once a request was sent. */
export function directMessageAccessBadge(
	state: ColleagueAccessState
): string | null {
	switch (state) {
		case "waiting":
			return "Waiting for approval";
		case "approved_once":
			return "Approved once";
		case "always_allowed":
			return "Always allowed";
		case "declined":
			return "Declined";
		case "revoked":
			return "Access removed";
		default:
			return null;
	}
}

/** Whether the next message asks the owner again. */
export function directMessageSendsRequest(
	state: ColleagueAccessState
): boolean {
	return state === "draft" || state === "revoked";
}

/** The colleague's Agent in a Direct Message, when the viewer does not own it. */
export function resolveColleagueDirectMessageAgent(input: {
	snapshot: SpaceMembersSnapshot | null;
	viewerUserId: string | null;
}) {
	if (!(input.snapshot && input.viewerUserId)) {
		return null;
	}
	return (
		input.snapshot.agents.find(
			(agent) =>
				agent.status === "active" &&
				Boolean(agent.ownerUserId) &&
				agent.ownerUserId !== input.viewerUserId
		) ?? null
	);
}

/**
 * Null unless this is a Direct Message with a teammate's Agent that asks its
 * owner first, or while that state loads.
 */
export function useDirectMessageAccessRequest(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	snapshot: SpaceMembersSnapshot | null;
	spaceId: string | null | undefined;
}): DirectMessageAccessRequest | null {
	const viewerUserId = useOptionalAppOrganization()?.currentUserId ?? null;
	const agent =
		input.isDirectMessage && !input.isCenterAgentDirectMessage && input.spaceId
			? resolveColleagueDirectMessageAgent({
					snapshot: input.snapshot,
					viewerUserId,
				})
			: null;
	const access = useColleagueAccessState({
		ownerUserId: agent?.ownerUserId,
		profileId: agent?.profileId,
		spaceId: input.spaceId,
	});
	if (
		!(agent && access?.ownerName) ||
		access.state === "not_required" ||
		access.state === "none"
	) {
		return null;
	}
	return {
		agentName: agent.profileName,
		ownerName: access.ownerName,
		access: { ...access, state: access.state },
	};
}

/** What the request card under the first message says, if anything. */
export function resolveDirectMessageRequestCardStatus(
	request: DirectMessageAccessRequest
): { text: string; canWithdraw: boolean } | null {
	switch (request.access.state) {
		case "waiting":
			return { text: `Waiting for ${request.ownerName}`, canWithdraw: true };
		case "declined":
			return {
				text: `${ownerShortName(request.ownerName)} declined`,
				canWithdraw: false,
			};
		case "revoked":
			return {
				text: `${request.ownerName} removed your access`,
				canWithdraw: false,
			};
		default:
			return null;
	}
}

/** The request card's status row, under the message that is the request. */
export function DirectMessageRequestCardStatus(input: {
	request: DirectMessageAccessRequest;
	busy: boolean;
	onWithdraw: () => void;
}) {
	const status = resolveDirectMessageRequestCardStatus(input.request);
	if (!status) {
		return null;
	}
	return (
		<div
			className="mt-1 flex w-fit max-w-full items-center gap-1.5 self-end rounded-lg border border-border border-dashed bg-card py-1 ps-2.5 pe-1 text-muted-foreground text-xs"
			data-access-request-state={input.request.access.state}
			data-slot="direct-message-request-status"
		>
			<HandIcon aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="min-w-0 truncate py-1">{status.text}</span>
			{status.canWithdraw ? (
				<>
					<span aria-hidden="true">·</span>
					<Button
						className="h-6 px-1.5 text-xs"
						disabled={input.busy}
						onClick={input.onWithdraw}
						size="sm"
						variant="ghost"
					>
						Withdraw
					</Button>
				</>
			) : (
				<span className="pe-1.5" />
			)}
		</div>
	);
}
