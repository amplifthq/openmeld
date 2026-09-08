import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { RequestDetails } from "#/components/organizations/invitation-request-details";
import { useAuthSession } from "#/hooks/auth.hooks";
import { listOrganizations } from "#/lib/organizations/auth-organizations";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import {
	buildOrganizationDefaultPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";

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
		refetchInterval: (query) =>
			query.state.data?.[0]?.status === "pending" ||
			(query.state.data?.[0]?.status === "approved" &&
				!query.state.data?.[0]?.joinedAt &&
				!query.state.data?.[0]?.invitationSentAt)
				? 5000
				: false,
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
	const navigate = useNavigate();
	const memberships = useQuery({
		queryKey: [
			"invitation-request-organizations",
			session.data?.user.id,
			request?.joinedAt,
		],
		enabled: Boolean(session.data),
		queryFn: listOrganizations,
	});
	const organization = memberships.data?.find(
		(item) => item.id === request?.organizationId
	);
	useEffect(() => {
		if (organization && requestId) {
			if (
				request?.applicantUserId === session.data?.user.id &&
				request?.joinedAt
			) {
				window.location.assign(
					request.spaceId
						? buildOrganizationSpacePath({
								orgSlug: organization.slug,
								spaceId: request.spaceId,
							})
						: buildOrganizationDefaultPath(organization.slug)
				);
				return;
			}
			navigate({
				to: "/o/$orgSlug/settings/invitations",
				params: { orgSlug: organization.slug },
				search: { requestId },
				replace: true,
			});
		}
	}, [
		navigate,
		organization,
		requestId,
		request?.applicantUserId,
		request?.joinedAt,
		request?.spaceId,
		session.data?.user.id,
	]);
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
		if (query.isPending || memberships.isPending || organization) {
			return <p>Loading request…</p>;
		}
		if (query.error) {
			return <p role="alert">{query.error.message}</p>;
		}
		if (memberships.error) {
			return <p role="alert">{memberships.error.message}</p>;
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
								? "Request approved."
								: "Request declined."}
						</output>
					) : null}
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}
