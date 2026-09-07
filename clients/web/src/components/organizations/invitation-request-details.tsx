import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
export function RequestDetails({
	request,
	pending,
	onReview,
}: {
	request: OrganizationJoinRequest;
	pending: boolean;
	onReview: (action: "approve" | "reject") => void;
}) {
	return (
		<>
			<p className="font-medium">{request.email}</p>
			<p className="text-muted-foreground text-sm">
				Invitation to {request.organizationName}
				{request.spaceName ? ` and ${request.spaceName}` : ""}, sponsored by{" "}
				{request.requestedByName}. The recipient will join as an organization
				member, not a guest.
			</p>
			<p>Status: {request.status}</p>
			{request.status === "approved" ? (
				<p className="text-muted-foreground text-sm">
					{request.invitationSentAt
						? "Invitation sent. The recipient must accept it before joining."
						: "Approved. The invitation still needs to be sent."}
				</p>
			) : null}
			{request.canReview &&
			(request.status === "pending" || request.status === "approved") ? (
				<div className="flex flex-wrap gap-2">
					<Button disabled={pending} onClick={() => onReview("approve")}>
						{request.status === "approved"
							? "Send invitation again"
							: "Approve and send invitation"}
					</Button>
					{request.status === "pending" ? (
						<Button
							disabled={pending}
							onClick={() => onReview("reject")}
							variant="outline"
						>
							Decline
						</Button>
					) : null}
				</div>
			) : null}
		</>
	);
}
