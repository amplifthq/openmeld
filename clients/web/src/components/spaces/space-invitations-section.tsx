import type { SpaceInvitationRequest } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { InvitationRequestLink } from "#/components/organizations/invitation-request-link";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	requestSpaceInvitations,
	SpaceInvitationRequestError,
} from "#/lib/organizations/space-invitations";
import { invitationRequestQueryKey } from "#/query/organizations/invitation-requests";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";

function canSendInvitation(
	audience: "organization" | "guest",
	role: Parameters<typeof canManageOrganizationArea>[0]
) {
	return (
		audience === "guest" ||
		canManageOrganizationArea(role, { invitation: ["create"] })
	);
}

function describeInvitationAudience(
	audience: "organization" | "guest",
	canInvite: boolean,
	organizationName: string
): string {
	if (audience === "guest") {
		return "Guests sign in to access only this Space.";
	}
	if (canInvite) {
		return `New teammates will join ${organizationName} and this Space.`;
	}
	return "An organization owner or admin must approve invitations for new teammates.";
}

export function SpaceInvitationsSection({
	spaceId,
	triggerLabel = "Invite",
}: {
	spaceId: string;
	triggerLabel?: string;
}) {
	const organization = useOptionalAppOrganization()?.currentOrganization;
	if (!organization || organization.isPersonal) {
		return null;
	}
	return (
		<Dialog>
			<DialogTrigger render={<Button size="xs" variant="outline" />}>
				<EnvelopeSimpleIcon aria-hidden="true" />
				{triggerLabel}
			</DialogTrigger>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Invite teammates</DialogTitle>
					<DialogDescription className="sr-only">
						Invite someone to your organization and this Space.
					</DialogDescription>
				</DialogHeader>
				<SpaceInvitationForm spaceId={spaceId} />
			</DialogContent>
		</Dialog>
	);
}

export function SpaceInvitationForm({
	spaceId,
	audience = "organization",
}: {
	spaceId: string;
	audience?: "organization" | "guest";
}) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const role = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: Boolean(organization && !organization.isPersonal),
			organizationId: organization?.id ?? "",
			userId: scope?.currentUserId ?? "",
		})
	);
	const canInvite = canSendInvitation(audience, role.data);
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const client = useQueryClient();
	const queryKey = [
		"space-invitations",
		scope?.currentUserId,
		organization?.id,
		spaceId,
		audience,
	];
	const query = useQuery({
		queryKey,
		queryFn: () =>
			requestSpaceInvitations({
				action: "list",
				organizationId: organization?.id ?? "",
				spaceId,
				audience,
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
		onSuccess: () => {
			setEmail("");
			return client.invalidateQueries({ queryKey: invitationRequestQueryKey });
		},
	});
	if (!organization || organization.isPersonal) {
		return null;
	}
	if (role.isPending) {
		return (
			<output className="block text-muted-foreground text-xs">
				Checking invitation permissions…
			</output>
		);
	}
	if (role.isError) {
		return (
			<div className="flex items-center justify-between gap-2 text-xs">
				<p role="alert">Couldn't check invitation permissions.</p>
				<Button onClick={() => role.refetch()} size="sm" variant="ghost">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="grid gap-2">
			<p className="text-muted-foreground text-xs/relaxed">
				{describeInvitationAudience(audience, canInvite, organization.name)}
			</p>
			<form
				className="flex flex-wrap items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (
						role.isPending ||
						role.isError ||
						mutation.isPending ||
						proposal.isPending
					) {
						return;
					}
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
						audience,
					});
				}}
			>
				<label
					className="sr-only"
					htmlFor={`space-invitation-email-${spaceId}-${audience}`}
				>
					Email address
				</label>
				<Input
					className="min-w-40 flex-1"
					id={`space-invitation-email-${spaceId}-${audience}`}
					onChange={(event) => setEmail(event.target.value)}
					placeholder="name@example.com"
					required
					type="email"
					value={email}
				/>
				<Button
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
					<Link
						className="underline"
						params={{ orgSlug: organization.slug }}
						search={{ requestId: proposal.data[0].id }}
						to="/o/$orgSlug/settings/invitations"
					>
						View request
					</Link>
				</output>
			) : null}
			{proposal.error ? (
				<p className="text-destructive text-sm" role="alert">
					{proposal.error.message}
				</p>
			) : null}
			{role.isSuccess && audience === "organization" ? (
				<InvitationRequestLink
					canManage={canInvite}
					className="mt-2"
					organizationId={organization.id}
					spaceId={spaceId}
				/>
			) : null}
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
				<Accordion>
					<AccordionItem value="pending-invitations">
						<AccordionTrigger
							chevronClassName="motion-reduce:transition-none"
							className="py-1 text-muted-foreground text-xs"
						>
							Pending invitations ({query.data?.length})
						</AccordionTrigger>
						<AccordionContent className="motion-reduce:transition-none">
							<div className="pt-3">
								<div className="max-h-48 space-y-2 overflow-y-auto">
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
							</div>
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}
		</div>
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
