import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { invalidateInboxFacts } from "#/query/organizations/inbox";
import { invitationRequestQueryKey } from "#/query/organizations/invitation-requests";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { RequestDetails } from "./invitation-request-details";

export function OrganizationInvitationRequests({
	organizationId,
	canReview,
}: {
	organizationId: string;
	canReview: boolean;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const search = useLocation({
		select: (location) => location.search as { requestId?: string },
	});
	const list = useQuery({
		queryKey: [
			...invitationRequestQueryKey,
			currentUserId,
			organizationId,
			"list",
		],
		queryFn: () =>
			requestOrganizationJoinRequests({ action: "list", organizationId }),
		refetchInterval: 30_000,
	});
	const requests = list.data ?? [];
	const pending = requests.filter(
		(request) =>
			request.status === "pending" ||
			(request.status === "approved" && !request.invitationSentAt)
	);
	const remaining = pending.filter(
		(request) => request.id !== search.requestId
	);
	let listContent: ReactNode = null;
	if (list.isPending) {
		listContent = <p>Loading requests…</p>;
	} else if (list.error) {
		listContent = <p role="alert">{list.error.message}</p>;
	} else if (pending.length === 0) {
		listContent = (
			<div className="grid min-h-36 place-content-center gap-1 rounded-md border border-border/70 border-dashed px-6 py-8 text-center">
				<p className="font-medium text-sm">
					{canReview ? "No requests to review" : "No pending requests"}
				</p>
				<p className="text-muted-foreground text-sm">
					Invitation requests that need approval will appear here.
				</p>
			</div>
		);
	} else if (remaining.length > 0) {
		listContent = (
			<ul className="divide-y rounded-md border">
				{remaining.map((request) => (
					<RequestRow
						key={request.id}
						orgSlug={currentOrganization.slug}
						request={request}
					/>
				))}
			</ul>
		);
	}
	return (
		<section aria-label="Invitation requests" className="space-y-3">
			<h2 className="font-medium">
				{canReview ? "Needs review" : "Your requests"}
			</h2>
			{search.requestId ? (
				<FocusedInvitationRequest
					key={`${currentUserId}:${search.requestId}`}
					organizationId={organizationId}
					requestId={search.requestId}
				/>
			) : null}
			{listContent}
			{requests.some(
				(request) =>
					request.status === "rejected" || request.status === "cancelled"
			) ? (
				<details>
					<summary className="cursor-pointer text-muted-foreground text-sm">
						Past requests
					</summary>
					<ul className="mt-2 divide-y rounded-md border">
						{requests
							.filter(
								(request) =>
									request.status === "rejected" ||
									request.status === "cancelled"
							)
							.map((request) => (
								<RequestRow
									key={request.id}
									orgSlug={currentOrganization.slug}
									request={request}
								/>
							))}
					</ul>
				</details>
			) : null}
		</section>
	);
}

function RequestRow({
	request,
	orgSlug,
}: {
	request: OrganizationJoinRequest;
	orgSlug: string;
}) {
	return (
		<li className="flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0">
				<p className="truncate font-medium text-sm">{request.email}</p>
				<p className="text-muted-foreground text-xs">
					{request.status}
					{request.spaceId ? " · Includes a Space" : ""}
				</p>
			</div>
			<Link
				className="text-sm underline underline-offset-4"
				params={{ orgSlug }}
				search={{ requestId: request.id }}
				to="/o/$orgSlug/settings/invitations"
			>
				{request.canReview ? "Review" : "View request"}
			</Link>
		</li>
	);
}

function FocusedInvitationRequest(input: {
	organizationId: string;
	requestId: string;
}) {
	const { currentUserId } = useAppOrganization();
	const client = useQueryClient();
	const ref = useRef<HTMLDivElement>(null);
	const query = useQuery({
		queryKey: [
			...invitationRequestQueryKey,
			currentUserId,
			input.organizationId,
			input.requestId,
		],
		queryFn: () =>
			requestOrganizationJoinRequests({
				action: "get",
				requestId: input.requestId,
			}),
		retry: false,
	});
	const mutation = useMutation({
		mutationFn: (action: "approve" | "reject") =>
			requestOrganizationJoinRequests({ action, requestId: input.requestId }),
		onSettled: () =>
			Promise.all([
				invalidateInboxFacts({
					organizationId: input.organizationId,
					queryClient: client,
				}),
				client.invalidateQueries({ queryKey: invitationRequestQueryKey }),
				client.invalidateQueries({
					queryKey: organizationQueryKeys.invitations(input.organizationId),
				}),
			]),
	});
	const request = query.data?.[0];
	useEffect(() => {
		if (query.isPending) {
			return;
		}
		ref.current?.scrollIntoView({ block: "center" });
		ref.current?.focus({ preventScroll: true });
	}, [query.isPending]);
	let content: ReactNode;
	if (query.isPending) {
		content = <p>Loading request…</p>;
	} else if (query.error) {
		content = <p role="alert">{query.error.message}</p>;
	} else if (!request) {
		content = <p>This request is no longer available.</p>;
	} else if (request.organizationId !== input.organizationId) {
		content = (
			<p role="alert">
				This request belongs to another organization. Open its original link to
				continue.
			</p>
		);
	} else {
		content = (
			<RequestDetails
				onReview={(action) => mutation.mutate(action)}
				pending={mutation.isPending}
				request={request}
			/>
		);
	}
	return (
		<div
			className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
			ref={ref}
			tabIndex={-1}
		>
			{content}
			{mutation.error ? (
				<p className="text-destructive text-sm" role="alert">
					{mutation.error.message}
				</p>
			) : null}
			{query.error ? (
				<Button onClick={() => query.refetch()} variant="outline">
					Retry
				</Button>
			) : null}
		</div>
	);
}
