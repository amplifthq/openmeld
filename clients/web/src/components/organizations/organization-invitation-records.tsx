import type { OrganizationJoinRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import {
	cancelOrganizationInvitation,
	listOrganizationInvitations,
	type OrganizationInvitation,
} from "#/lib/organizations/auth-organizations";
import { groupInvitationRecords } from "#/lib/organizations/invitation-records";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	useInvitationRequestMutation,
	useInvitationRequests,
} from "#/query/organizations/invitation-requests";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	formatInvitationDate,
	InvitationRequestActions,
	invitationOutcome,
	reviewDecisionLabel,
} from "./invitation-request-details";

export function OrganizationInvitationRecords({
	canReview,
	organizationId,
}: {
	organizationId: string;
	canReview: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	const list = useInvitationRequests();
	const invitations = useQuery({
		enabled: canReview,
		queryKey: organizationQueryKeys.invitations(organizationId),
		queryFn: () => listOrganizationInvitations({ organizationId }),
		refetchInterval: 30_000,
		retry: 1,
	});
	const groups = groupInvitationRecords(
		list.data?.pages.flat() ?? [],
		canReview ? (invitations.data ?? []) : []
	);
	const error = list.error ?? (canReview ? invitations.error : null);
	const loading = list.isPending || (canReview && invitations.isPending);
	let rowIndex = 0;
	return (
		<section aria-label="Invitation records" className="min-w-0 space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium text-sm">
					{canReview ? "Invitation records" : "Your requests"}
				</h2>
				{canReview ? (
					<Link
						className="text-muted-foreground text-xs underline-offset-4 hover:underline"
						params={{ orgSlug: currentOrganization.slug }}
						search={{ view: "needs-review" }}
						to="/o/$orgSlug/inbox"
					>
						Open reviews in Inbox
					</Link>
				) : null}
			</div>
			{loading ? (
				<p aria-busy="true" className="text-muted-foreground text-sm">
					Loading invitation records…
				</p>
			) : null}
			{error ? (
				<div className="text-destructive text-sm" role="alert">
					{error.message}{" "}
					<Button
						onClick={() => {
							list.refetch();
							if (canReview) {
								invitations.refetch();
							}
						}}
						size="sm"
						variant="ghost"
					>
						Try again
					</Button>
				</div>
			) : null}
			{loading || error || groups.length ? null : (
				<p className="py-4 text-muted-foreground text-sm">
					No invitation records yet.
				</p>
			)}
			{groups.length ? (
				<Table aria-label="Invitation records">
					<TableHeader>
						<TableRow>
							<TableHead>Recipient</TableHead>
							<TableHead>Decision</TableHead>
							<TableHead>{canReview ? "Reviewed by" : "Reviewed at"}</TableHead>
							<TableHead>Invitation status</TableHead>
							<TableHead>Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{groups.map((group) => {
							const rows: (OrganizationJoinRequest | null)[] = group.requests
								.length
								? group.requests
								: [null];
							return (
								<Fragment key={group.email}>
									{rows.map((request, index) => (
										<TableRow
											index={rowIndex++}
											key={request?.id ?? group.email}
										>
											{index === 0 ? (
												<TableCell
													className="max-w-56 whitespace-normal align-top"
													rowSpan={rows.length}
												>
													<span className="break-all font-medium">
														{group.email}
													</span>
												</TableCell>
											) : null}
											<RequestReviewCells
												canReview={canReview}
												request={request}
											/>
											{index === 0 ? (
												<TableCell
													className="whitespace-normal align-top text-muted-foreground"
													rowSpan={rows.length}
												>
													<div className="space-y-3">
														{group.invitations.map((invitation) => (
															<InvitationDelivery
																invitation={invitation}
																key={invitation.id}
															/>
														))}
														{group.invitations.length ? null : (
															<span>{recipientOutcome(group.requests)}</span>
														)}
													</div>
												</TableCell>
											) : null}
											<TableCell className="whitespace-normal align-top">
												<RecordActions
													canReview={canReview}
													disabled={
														list.isRefetchError || invitations.isRefetchError
													}
													invitations={index === 0 ? group.invitations : []}
													organizationId={organizationId}
													request={request}
												/>
											</TableCell>
										</TableRow>
									))}
								</Fragment>
							);
						})}
					</TableBody>
				</Table>
			) : null}
			{list.hasNextPage ? (
				<Button
					disabled={list.isFetchingNextPage}
					onClick={() => list.fetchNextPage()}
					size="sm"
					variant="outline"
				>
					{list.isFetchingNextPage ? "Loading…" : "Load more records"}
				</Button>
			) : null}
		</section>
	);
}

function recipientOutcome(requests: OrganizationJoinRequest[]) {
	const approved = requests.find((request) => request.status === "approved");
	return approved
		? invitationOutcome(approved).replace("Approved · ", "")
		: "—";
}

function awaitingAcceptance(invitation: OrganizationInvitation) {
	return (
		invitation.status === "pending" &&
		!(
			invitation.expiresAt &&
			new Date(invitation.expiresAt).getTime() <= Date.now()
		)
	);
}
function InvitationDelivery({
	invitation,
}: {
	invitation: OrganizationInvitation;
}) {
	const labels: Record<string, string> = {
		accepted: "Accepted",
		rejected: "Declined",
		canceled: "Canceled",
		cancelled: "Canceled",
		expired: "Expired",
	};
	let label =
		labels[invitation.status ?? ""] ??
		invitation.status ??
		"Status unavailable";
	if (invitation.status === "pending") {
		label = awaitingAcceptance(invitation) ? "Awaiting acceptance" : "Expired";
	}
	const details = [
		invitation.role,
		invitation.expiresAt
			? `Expires ${formatInvitationDate(new Date(invitation.expiresAt).getTime())}`
			: null,
	]
		.filter(Boolean)
		.join(" · ");
	return <span title={details}>{label}</span>;
}
function CancelInvitationAction({
	invitation,
	organizationId,
	disabled,
}: {
	invitation: OrganizationInvitation;
	organizationId: string;
	disabled: boolean;
}) {
	const client = useQueryClient();
	const mutation = useMutation({
		mutationFn: () =>
			cancelOrganizationInvitation({ invitationId: invitation.id }),
		onSettled: () =>
			client.invalidateQueries({
				queryKey: organizationQueryKeys.invitations(organizationId),
			}),
	});
	return (
		<div>
			<Button
				aria-label={`Cancel invitation for ${invitation.email}`}
				disabled={disabled || mutation.isPending}
				onClick={() => mutation.mutate()}
				size="sm"
				variant="outline"
			>
				{mutation.isPending ? "Canceling…" : "Cancel"}
			</Button>
			{mutation.error ? (
				<p className="mt-1 max-w-52 text-destructive text-xs" role="alert">
					{mutation.error.message}
				</p>
			) : null}
		</div>
	);
}
function RecordActions({
	request,
	invitations,
	organizationId,
	canReview,
	disabled,
}: {
	request: OrganizationJoinRequest | null;
	invitations: OrganizationInvitation[];
	organizationId: string;
	canReview: boolean;
	disabled: boolean;
}) {
	const pendingReview =
		canReview && request?.canReview && request.status === "pending";
	const cancellable = canReview ? invitations.filter(awaitingAcceptance) : [];
	if (!(pendingReview || cancellable.length)) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			{pendingReview ? (
				<InvitationTableActions disabled={disabled} request={request} />
			) : null}
			{cancellable.map((invitation) => (
				<CancelInvitationAction
					disabled={disabled}
					invitation={invitation}
					key={invitation.id}
					organizationId={organizationId}
				/>
			))}
		</div>
	);
}
function InvitationTableActions({
	request,
	disabled,
}: {
	request: OrganizationJoinRequest;
	disabled: boolean;
}) {
	const mutation = useInvitationRequestMutation(request.id);
	return (
		<div className="space-y-2">
			<InvitationRequestActions
				compact
				disabled={disabled}
				onReview={(action) => mutation.mutate(action)}
				pending={mutation.isPending}
				request={request}
			/>
			{mutation.error ? (
				<p
					className="max-w-52 whitespace-normal text-destructive text-xs"
					role="alert"
				>
					{mutation.error.message}
				</p>
			) : null}
		</div>
	);
}

function RequestReviewCells({
	request,
	canReview,
}: {
	request: OrganizationJoinRequest | null;
	canReview: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	return (
		<>
			<TableCell className="max-w-64 whitespace-normal align-top">
				{request ? (
					<>
						<span>
							{request.status === "pending"
								? "Pending"
								: reviewDecisionLabel(request.status)}
						</span>
						<Link
							className="mt-1 block text-muted-foreground text-xs underline-offset-4 hover:underline"
							params={{ orgSlug: currentOrganization.slug }}
							search={{ requestId: request.id }}
							to="/o/$orgSlug/inbox"
						>
							Requested by {request.requestedByName ?? "Former member"}
						</Link>
						{request.spaceName ? (
							<p className="mt-1 text-muted-foreground text-xs">
								Includes {request.spaceName}
							</p>
						) : null}
					</>
				) : (
					"—"
				)}
			</TableCell>
			<TableCell className="whitespace-normal align-top text-muted-foreground">
				{canReview && request?.reviewedByUserId ? (
					<p>{request.reviewedByName ?? "Former member"}</p>
				) : null}
				{request?.reviewedAt ? (
					<time
						className="mt-1 block text-xs"
						dateTime={new Date(request.reviewedAt).toISOString()}
						title={formatInvitationDate(request.reviewedAt)}
					>
						{new Intl.DateTimeFormat("en", {
							month: "short",
							day: "numeric",
							year: "numeric",
						}).format(request.reviewedAt)}
					</time>
				) : (
					"—"
				)}
			</TableCell>
		</>
	);
}
