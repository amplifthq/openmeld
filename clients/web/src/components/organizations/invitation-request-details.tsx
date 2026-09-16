import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";

export function RequestDetails({
	request,
	pending,
	disabled = false,
	onReview,
	showEmail = true,
}: {
	showEmail?: boolean;
	request: OrganizationJoinRequest;
	pending: boolean;
	disabled?: boolean;
	onReview?: (action: "approve" | "reject") => void;
}) {
	return (
		<div className="space-y-3">
			<div className="min-w-0 space-y-1">
				{showEmail ? (
					<p className="break-all font-medium text-sm">{request.email}</p>
				) : null}
				<p className="text-muted-foreground text-xs">
					Requested by {request.requestedByName ?? "a team member"} · Member
					{request.spaceName ? ` · Includes ${request.spaceName}` : ""}
				</p>
			</div>
			{request.status !== "pending" ? (
				<p className="text-muted-foreground text-sm">
					{invitationOutcome(request)}
				</p>
			) : null}
			{request.reviewedAt ? (
				<p className="text-muted-foreground text-xs">
					{reviewDecisionLabel(request.status)} by{" "}
					{request.reviewedByName ?? "a team member"} ·{" "}
					{formatInvitationDate(request.reviewedAt)}
				</p>
			) : null}
			<InvitationRequestActions
				disabled={disabled}
				onReview={onReview}
				pending={pending}
				request={request}
			/>
		</div>
	);
}

export function InvitationRequestActions({
	request,
	pending,
	disabled = false,
	onReview,
	compact = false,
}: {
	request: OrganizationJoinRequest;
	pending: boolean;
	disabled?: boolean;
	onReview?: (action: "approve" | "reject") => void;
	compact?: boolean;
}) {
	if (
		!(onReview && request.canReview) ||
		request.joinedAt ||
		request.invitationSentAt ||
		(request.status !== "pending" && request.status !== "approved")
	) {
		return null;
	}
	const label =
		compact && request.status === "pending"
			? "Approve"
			: invitationAction(request);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Button
				aria-label={
					compact ? `${invitationAction(request)}: ${request.email}` : undefined
				}
				disabled={pending || disabled}
				onClick={() => onReview("approve")}
				size="sm"
			>
				{pending ? "Saving…" : label}
			</Button>
			{request.status === "pending" ? (
				<Button
					aria-label={
						compact ? `Decline invitation: ${request.email}` : undefined
					}
					disabled={pending || disabled}
					onClick={() => onReview("reject")}
					size="sm"
					variant={compact ? "outline" : "ghost"}
				>
					Decline
				</Button>
			) : null}
		</div>
	);
}

export function reviewDecisionLabel(
	status: OrganizationJoinRequest["status"]
): string {
	return {
		pending: "Awaiting review",
		approved: "Approved",
		rejected: "Declined",
		cancelled: "Cancelled",
	}[status];
}

export function invitationOutcome(request: OrganizationJoinRequest): string {
	if (request.status === "rejected") {
		return "Declined";
	}
	if (request.status === "cancelled") {
		return "Cancelled";
	}
	if (request.status === "pending") {
		return "Awaiting review";
	}
	if (request.joinedAt) {
		return "Joined";
	}
	if (request.invitationSentAt) {
		return "Invitation sent";
	}
	return request.applicantUserId
		? "Approved · Joining incomplete"
		: "Approved · Invitation not sent";
}

function invitationAction(request: OrganizationJoinRequest): string {
	if (request.applicantUserId) {
		return request.status === "approved"
			? "Complete joining"
			: "Approve and add member";
	}
	return request.status === "approved"
		? "Retry invitation"
		: "Approve and send invitation";
}

export function formatInvitationDate(value: number): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(value);
}
