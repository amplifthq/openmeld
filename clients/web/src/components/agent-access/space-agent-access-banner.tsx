import type { AgentAccessRequestView } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import {
	useAgentAccessRequests,
	useDecideAgentAccessRequest,
	useWithdrawAgentAccessRequest,
} from "#/query/agent-access";
import { agentAccessDecisionLabel } from "./agent-access-request-card";

const RECENT_OUTCOME_MS = 24 * 60 * 60 * 1000;

/** What the requester sees about one request in this Space. */
export function requesterAgentAccessCopy(
	request: AgentAccessRequestView
): string | null {
	const { agentProfileName: agent, ownerName: owner } = request;
	switch (request.status) {
		case "pending":
			return request.kind === "space_join"
				? `Requested ${owner}. ${agent} joins once they agree.`
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

/**
 * Consent requests in this Space: the requester waits or withdraws; the
 * Agent owner, who may be only an observer here, answers.
 */
export function SpaceAgentAccessBanner(input: { spaceId?: string }) {
	return input.spaceId ? (
		<SpaceAgentAccessRequests spaceId={input.spaceId} />
	) : null;
}

function SpaceAgentAccessRequests(input: { spaceId: string }) {
	const requests = useAgentAccessRequests({ spaceId: input.spaceId });
	const [nowMs] = useState(() => Date.now());
	const visible = latestRequests(requests.data ?? []).filter(
		(request) =>
			request.status === "pending" ||
			(request.viewerRole === "requester" &&
				nowMs - Date.parse(request.decidedAt ?? request.createdAt) <
					RECENT_OUTCOME_MS &&
				requesterAgentAccessCopy(request) !== null)
	);
	if (visible.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Agent requests"
			aria-live="polite"
			className="mx-3 mb-2 space-y-2 rounded-xl border border-border bg-card px-4 py-3 sm:mx-4"
			data-slot="space-agent-access-banner"
		>
			{visible.map((request) =>
				request.viewerRole === "owner" ? (
					<OwnerRequestRow key={request.id} request={request} />
				) : (
					<RequesterRequestRow key={request.id} request={request} />
				)
			)}
		</section>
	);
}

function RequesterRequestRow(input: { request: AgentAccessRequestView }) {
	const withdraw = useWithdrawAgentAccessRequest();
	const { request } = input;
	return (
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<p className="min-w-0 text-muted-foreground">
				{requesterAgentAccessCopy(request)}
			</p>
			{request.status === "pending" ? (
				<Button
					disabled={withdraw.isPending}
					onClick={() => withdraw.mutate(request.id)}
					size="sm"
					variant="outline"
				>
					Withdraw
				</Button>
			) : null}
			{withdraw.error ? (
				<p className="w-full text-destructive text-xs" role="alert">
					{withdraw.error.message}
				</p>
			) : null}
		</div>
	);
}

function OwnerRequestRow(input: { request: AgentAccessRequestView }) {
	const decide = useDecideAgentAccessRequest();
	const navigate = useNavigate();
	const orgSlug = useOptionalAppOrganization()?.currentOrganization.slug ?? "";
	const { request } = input;
	return (
		<div className="space-y-2 text-sm">
			<p className="text-muted-foreground">
				{request.kind === "space_join"
					? `${request.requesterName} asked for ${request.agentProfileName} here. You can read this Space, but you need to join to post.`
					: `${request.requesterName} wants to use ${request.agentProfileName}. Their message waits for your answer.`}
			</p>
			<div className="flex flex-wrap gap-2">
				{request.availableDecisions.map((decision, index) => (
					<Button
						disabled={decide.isPending}
						key={decision}
						onClick={async () => {
							// A failed answer is shown below from the mutation state.
							const response = await decide
								.mutateAsync({ decision, requestId: request.id })
								.catch(() => null);
							if (response?.directMessageSpaceId) {
								await navigate({
									to: buildOrganizationDirectMessagePath({
										orgSlug,
										spaceId: response.directMessageSpaceId,
									}),
								});
							}
						}}
						size="sm"
						variant={index === 0 ? "default" : "outline"}
					>
						{agentAccessDecisionLabel(decision, request)}
					</Button>
				))}
			</div>
			{decide.error ? (
				<p className="text-destructive text-xs" role="alert">
					{decide.error.message}
				</p>
			) : null}
		</div>
	);
}
