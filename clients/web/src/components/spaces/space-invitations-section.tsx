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
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	requestSpaceInvitations,
	SpaceInvitationRequestError,
} from "#/lib/organizations/space-invitations";

export function SpaceInvitationsSection({ spaceId }: { spaceId: string }) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
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
		enabled: Boolean(organization && !organization.isPersonal),
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
	if (
		!organization ||
		organization.isPersonal ||
		(query.error instanceof SpaceInvitationRequestError &&
			query.error.code === "space.invitation.forbidden")
	) {
		return null;
	}
	return (
		<Dialog
			onOpenChange={(open) => {
				if (open) {
					setSent(false);
					query.refetch();
				}
			}}
		>
			<DialogTrigger render={<Button size="xs" variant="outline" />}>
				<EnvelopeSimpleIcon aria-hidden="true" />
				Invite
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Invite by email</DialogTitle>
					<DialogDescription>
						Invite someone outside {organization.name}. They’ll join the
						organization as a member and this Space when they accept.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setSent(false);
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
						disabled={mutation.isPending || !email.trim()}
						type="submit"
						variant="outline"
					>
						Send invitation
					</Button>
				</form>
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
