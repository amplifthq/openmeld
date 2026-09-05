import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";

export const Route = createFileRoute("/invitation-requests")({
	component: InvitationRequestsPage,
	validateSearch: (
		search: Record<string, unknown>
	): { requestId?: string } => ({
		requestId:
			typeof search.requestId === "string" ? search.requestId : undefined,
	}),
});
function InvitationRequestsPage() {
	const session = useAuthSession();
	const { requestId } = Route.useSearch();
	const href = useLocation({ select: (location) => location.href });
	const query = useQuery({
		queryKey: ["invitation-requests", session.data?.user.id, requestId],
		enabled: Boolean(session.data && requestId),
		retry: false,
		queryFn: () =>
			requestOrganizationJoinRequests({
				action: "get",
				requestId: requestId ?? "",
			}),
	});
	const mutation = useMutation({
		mutationFn: (action: "approve" | "reject") =>
			requestOrganizationJoinRequests({ action, requestId: requestId ?? "" }),
		onSettled: () => query.refetch(),
	});
	const request = query.data?.[0];
	const content = () => {
		if (session.isPending) {
			return <p>Loading request…</p>;
		}
		if (!session.data) {
			return (
				<Link
					className={buttonVariants()}
					search={{ redirect: href }}
					to="/login"
				>
					Sign in to view request
				</Link>
			);
		}
		if (!requestId) {
			return (
				<p>Open an invitation request from your Inbox or its shared link.</p>
			);
		}
		if (query.isPending) {
			return <p>Loading request…</p>;
		}
		if (query.error) {
			return <p role="alert">{query.error.message}</p>;
		}
		if (!request) {
			return null;
		}
		return (
			<RequestDetails
				onReview={(action) => mutation.mutate(action)}
				pending={mutation.isPending}
				request={request}
			/>
		);
	};
	return (
		<AuthPageShell>
			<Card className="w-full max-w-lg">
				<CardHeader>
					<CardTitle>Invitation request</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{content()}
					{mutation.error ? (
						<p className="text-destructive text-sm" role="alert">
							{mutation.error.message}
						</p>
					) : null}
					{mutation.isSuccess ? (
						<output className="block">
							{mutation.variables === "approve"
								? "Invitation sent."
								: "Request declined."}
						</output>
					) : null}
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}

function RequestDetails({
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
