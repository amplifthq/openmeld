import type {
	AgentAccessDecision,
	AgentAccessRequestView,
} from "@openmeld/schemas";
import {
	ApprovalCard,
	ApprovalCardBody,
	ApprovalCardFooter,
	ApprovalCardHeader,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	ApprovalRequestErrors,
	ApprovalRequestOutcome,
	ApprovalRequestUnavailable,
} from "#/components/inbox/approval-request-states";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { useOpenDirectMessage } from "#/lib/spaces/use-open-direct-message";
import {
	useAgentAccessRequest,
	useDecideAgentAccessRequest,
} from "#/query/agent-access";

export function agentAccessDecisionLabel(
	decision: AgentAccessDecision,
	request: Pick<AgentAccessRequestView, "requesterName">
): string {
	switch (decision) {
		case "allow_once":
			return "Allow once";
		case "always_allow":
			return `Always allow ${request.requesterName}`;
		case "decline":
			return "Decline";
		case "join":
			return "Add to Space";
		case "ignore":
			return "Don't add";
		default:
			throw new Error("Unknown Agent access decision");
	}
}

/**
 * Messaging the requester is a conversation, not a decision: the request
 * stays pending. Offered on a colleague's pending Space request.
 */
export function canMessageAgentAccessRequester(
	request: Pick<
		AgentAccessRequestView,
		"kind" | "requesterKind" | "status" | "viewerRole"
	>
): boolean {
	return (
		request.kind === "space_join" &&
		request.requesterKind === "member" &&
		request.status === "pending" &&
		request.viewerRole === "owner"
	);
}

export function agentAccessMessageRequesterLabel(
	request: Pick<AgentAccessRequestView, "requesterName">
): string {
	return `Message ${request.requesterName}`;
}

function requestTitle(request: AgentAccessRequestView): string {
	if (request.kind === "space_join") {
		return `${request.requesterName} wants ${request.agentProfileName} in a Space`;
	}
	return `${request.requesterName} wants to use ${request.agentProfileName}`;
}

function requestDescription(request: AgentAccessRequestView): string {
	switch (request.kind) {
		case "direct_message":
			return "Their message waits until you choose. Allowing starts a new Session for them, and you can follow it read-only.";
		case "external_message":
			return `${request.requesterName} is outside your organization, so you're asked every time.`;
		case "space_join":
			return "The Agent won't join or run until you choose. You can read the Space in the meantime.";
		default:
			return "";
	}
}

/** What happened, from the owner's side. */
export function agentAccessOutcomeCopy(
	request: AgentAccessRequestView
): string {
	switch (request.status) {
		case "pending":
			return "Waiting for your answer.";
		case "allowed":
			return `Allowed. ${request.agentProfileName} is working for ${request.requesterName} in a new Session.`;
		case "declined":
			return `Declined. ${request.requesterName} can see that you declined.`;
		case "withdrawn":
			return `${request.requesterName} withdrew this request.`;
		case "voided":
			return "The message behind this request was edited or deleted, so there's nothing to answer.";
		case "joined":
			return `${request.agentProfileName} joined the Space and is replying to ${request.requesterName}.`;
		case "replied_by_dm":
			return `You replied to ${request.requesterName} by DM.`;
		case "ignored":
			return `Not added. ${request.agentProfileName} stays out of the Space.`;
		default:
			return "";
	}
}

function requestConversationPath(
	request: AgentAccessRequestView,
	orgSlug: string
): string {
	return request.kind === "direct_message"
		? buildOrganizationDirectMessagePath({ orgSlug, spaceId: request.spaceId })
		: buildOrganizationSpacePath({
				orgSlug,
				spaceId: request.spaceId,
				...(request.sourceSignalId
					? { search: { focusSignalId: request.sourceSignalId } }
					: {}),
			});
}

/** The Agent owner's answer to one consent request (Inbox). */
export function AgentAccessRequestCard(input: {
	requestId: string;
	onInteract?: () => void;
}) {
	const organization = useOptionalAppOrganization();
	const orgSlug = organization?.currentOrganization.slug ?? "";
	const query = useAgentAccessRequest(input.requestId);
	const decide = useDecideAgentAccessRequest();
	const directMessage = useOpenDirectMessage({
		organizationId: organization?.currentOrganization.id ?? null,
		orgSlug,
	});
	const [error, setError] = useState<string | null>(null);
	const request = query.data;
	if (query.isPending) {
		return <SkeletonRows label="Loading request" rows={2} />;
	}
	if (!request) {
		return (
			<ApprovalRequestUnavailable
				message={query.error?.message ?? "This request is unavailable."}
				onRefresh={() => query.refetch()}
			/>
		);
	}
	const respond = async (decision: AgentAccessDecision) => {
		input.onInteract?.();
		setError(null);
		try {
			await decide.mutateAsync({
				decision,
				requestId: request.id,
			});
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Your answer couldn't be confirmed. Refresh this request and try again."
			);
		}
	};
	const disabled = decide.isPending || query.isRefetchError;
	return (
		<ApprovalCard>
			<ApprovalCardHeader
				description={
					request.kind === "space_join" ? "Space request" : "Agent access"
				}
				icon={<RobotIcon />}
				title={requestTitle(request)}
			/>
			<ApprovalCardBody className="space-y-2">
				<p className="text-muted-foreground text-sm">
					{requestDescription(request)}
				</p>
				<Link
					className="text-muted-foreground text-sm underline-offset-4 hover:underline"
					to={requestConversationPath(request, orgSlug)}
				>
					{request.kind === "direct_message"
						? "Open the conversation"
						: "Open the Space"}
				</Link>
			</ApprovalCardBody>
			{request.availableDecisions.length > 0 ? (
				<ApprovalCardFooter>
					{request.availableDecisions.map((decision, index) => (
						<Button
							disabled={disabled}
							key={decision}
							onClick={() => respond(decision)}
							size="sm"
							variant={index === 0 ? "default" : "outline"}
						>
							{agentAccessDecisionLabel(decision, request)}
						</Button>
					))}
					{canMessageAgentAccessRequester(request) ? (
						<Button
							disabled={directMessage.pendingProfileId !== null}
							onClick={() => {
								input.onInteract?.();
								directMessage.open(request.requesterProfileId);
							}}
							size="sm"
							variant="outline"
						>
							{agentAccessMessageRequesterLabel(request)}
						</Button>
					) : null}
				</ApprovalCardFooter>
			) : (
				<ApprovalRequestOutcome>
					{agentAccessOutcomeCopy(request)}
				</ApprovalRequestOutcome>
			)}
			<ApprovalRequestErrors
				error={error}
				onRefresh={() => query.refetch()}
				refetchFailed={query.isRefetchError}
			/>
		</ApprovalCard>
	);
}
