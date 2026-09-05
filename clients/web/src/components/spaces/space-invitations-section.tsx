import type { SpaceInvitationRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { InvitationRequestLink } from "#/components/organizations/invitation-request-link";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	requestSpaceInvitations,
	SpaceInvitationRequestError,
} from "#/lib/organizations/space-invitations";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";

export function SpaceInvitationsSection({ spaceId }: { spaceId: string }) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: Boolean(organization && !organization.isPersonal),
			organizationId: organization?.id ?? "",
			userId: scope?.currentUserId ?? "",
		})
	);
	const canInvite = canManageOrganizationArea(role.data, {
		invitation: ["create"],
	});
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const client = useQueryClient();
	const queryKey = [
		"space-invitations",
		scope?.currentUserId,
		organization?.id,
		spaceId,
	];
	const query = useQuery({
		queryKey,
		queryFn: () =>
			requestSpaceInvitations({
				action: "list",
				organizationId: organization?.id ?? "",
				spaceId,
			}),
		enabled: Boolean(organization && !organization.isPersonal && canInvite),
		retry: false,
	});
	const mutation = useMutation({
		mutationFn: (request: SpaceInvitationRequest) =>
			requestSpaceInvitations(request),
		onSuccess: (_result, request) => {
			setSent(request.action === "create" || request.action === "resend");
			if (request.action === "create" || request.action === "resend") {
				setEmail("");
			}
		},
		onSettled: () => client.invalidateQueries({ queryKey }),
	});
	const proposal = useMutation({
		mutationFn: () =>
			requestOrganizationJoinRequests({
				action: "create",
				organizationId: organization?.id ?? "",
				spaceId,
				email,
			}),
		onSuccess: () => setEmail(""),
	});
	if (!organization || organization.isPersonal) {
		return null;
	}
	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) {
					setSent(false);
					proposal.reset();
					if (canInvite) {
						query.refetch();
					}
				}
			}}
		>
			<DialogTrigger render={<Button size="xs" variant="outline" />}>
				<EnvelopeSimpleIcon aria-hidden="true" />
				Invite
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Invite people</DialogTitle>
					<DialogDescription>
						{canInvite
							? `Invite someone to ${organization.name} and this Space. They’ll join as an organization member when they accept.`
							: "An organization owner or admin must approve your invitation before it is sent."}
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setSent(false);
						if (!canInvite) {
							proposal.mutate();
							return;
						}
						mutation.mutate({
							action: "create",
							organizationId: organization.id,
							spaceId,
							email,
						});
					}}
				>
					<label
						className="font-medium text-sm"
						htmlFor={`space-invitation-email-${spaceId}`}
					>
						Email address
					</label>
					<Input
						id={`space-invitation-email-${spaceId}`}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="name@example.com"
						required
						type="email"
						value={email}
					/>
					<Button
						className="self-end"
						disabled={
							mutation.isPending ||
							proposal.isPending ||
							role.isPending ||
							role.isError ||
							!email.trim()
						}
						type="submit"
						variant="outline"
					>
						{canInvite ? "Send invitation" : "Request invitation"}
					</Button>
				</form>
				{proposal.data?.[0] ? (
					<output className="block text-sm">
						Request submitted.{" "}
						<a
							className="underline"
							href={`/invitation-requests?requestId=${encodeURIComponent(proposal.data[0].id)}`}
						>
							View request
						</a>
					</output>
				) : null}
				{proposal.error ? (
					<p className="text-destructive text-sm" role="alert">
						{proposal.error.message}
					</p>
				) : null}
				{role.error ? (
					<p className="text-destructive text-sm" role="alert">
						Could not check your invitation permissions. Close this dialog and
						try again.
					</p>
				) : null}
				<InvitationRequestLink
					canManage={canInvite}
					organizationId={organization.id}
					spaceId={spaceId}
				/>
				{sent && (
					<output className="block text-sm">
						Invitation sent. They’ll appear in this Space after accepting.
					</output>
				)}
				{(mutation.error || query.error) && (
					<p className="text-destructive text-sm" role="alert">
						{(mutation.error ?? query.error)?.message}
					</p>
				)}
				{mutation.error instanceof SpaceInvitationRequestError &&
					mutation.error.code === "space.invitation.revoke_incomplete" && (
						<Button
							disabled={mutation.isPending}
							onClick={() => {
								if (mutation.variables?.action === "revoke") {
									mutation.mutate(mutation.variables);
								}
							}}
							variant="outline"
						>
							Retry revoking invitation
						</Button>
					)}
				{Boolean(query.data?.length) && (
					<div className="space-y-2">
						<p className="font-medium text-muted-foreground text-xs">
							Pending invitations
						</p>
						{query.data?.map((invitation) => (
							<div
								className="flex items-center gap-2 text-sm"
								key={invitation.id}
							>
								<div className="min-w-0 flex-1">
									<p className="truncate">{invitation.email}</p>
									<p className="text-muted-foreground text-xs">
										{invitationStatusLabel(invitation.status)}
									</p>
								</div>
								<Button
									disabled={mutation.isPending}
									onClick={() =>
										mutation.mutate({
											action: "resend",
											invitationId: invitation.id,
										})
									}
									size="sm"
									variant="ghost"
								>
									Resend
								</Button>
								<Button
									disabled={mutation.isPending}
									onClick={() =>
										mutation.mutate({
											action: "revoke",
											invitationId: invitation.id,
										})
									}
									size="sm"
									variant="ghost"
								>
									Revoke
								</Button>
							</div>
						))}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function invitationStatusLabel(status: string): string {
	if (status === "expired") {
		return "Expired";
	}
	if (status === "accepting") {
		return "Joining — they can retry the invitation";
	}
	return "Waiting for acceptance";
}
