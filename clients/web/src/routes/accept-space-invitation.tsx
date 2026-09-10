import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession, useSignOut } from "#/hooks/auth.hooks";
import {
	requestSpaceInvitations,
	SpaceInvitationRequestError,
} from "#/lib/organizations/space-invitations";

export const Route = createFileRoute("/accept-space-invitation")({
	validateSearch: z.object({ invitationId: z.string().optional() }),
	component: SpaceInvitationPage,
});

function InvitationShell({ children }: { children: ReactNode }) {
	return (
		<AuthPageShell>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Space invitation</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">{children}</CardContent>
			</Card>
		</AuthPageShell>
	);
}

function SpaceInvitationPage() {
	const { invitationId } = Route.useSearch();
	const session = useAuthSession();
	if (!invitationId) {
		return (
			<InvitationShell>
				This invitation link is incomplete. Ask the sender for a new one.
			</InvitationShell>
		);
	}
	if (session.isPending) {
		return <InvitationShell>Loading your account…</InvitationShell>;
	}
	if (!session.data) {
		const redirect = `/accept-space-invitation?${new URLSearchParams({ invitationId })}`;
		return (
			<InvitationShell>
				<p className="text-sm">
					Sign in with the email address that received this invitation.
				</p>
				<Link className={buttonVariants()} search={{ redirect }} to="/login">
					Sign in to continue
				</Link>
			</InvitationShell>
		);
	}
	if (!(session.data.user.id && session.data.user.email)) {
		return (
			<InvitationShell>
				Your account details could not be loaded. Refresh this page to try
				again.
			</InvitationShell>
		);
	}
	return (
		<InvitationShell>
			<AccountInvitation
				email={session.data.user.email}
				invitationId={invitationId}
				userId={session.data.user.id}
			/>
		</InvitationShell>
	);
}

function AccountInvitation({
	invitationId,
	userId,
	email,
}: {
	invitationId: string;
	userId: string;
	email: string;
}) {
	const signOut = useSignOut();
	const redirect = `/accept-space-invitation?${new URLSearchParams({ invitationId })}`;
	const query = useQuery({
		queryKey: ["space-invitation", userId, invitationId],
		queryFn: () => requestSpaceInvitations({ action: "preview", invitationId }),
		retry: false,
	});
	const accept = useMutation({
		mutationFn: () =>
			requestSpaceInvitations({ action: "accept", invitationId }),
		onSuccess: (invitations) => {
			const target = invitations[0];
			if (target?.status === "accepted") {
				window.location.assign(`/spaces/${encodeURIComponent(target.spaceId)}`);
			}
		},
	});
	const error = accept.error ?? query.error;
	const invitation = query.data?.[0];
	return (
		<>
			<p className="text-muted-foreground text-sm">Signed in as {email}</p>
			{error && (
				<p className="text-destructive text-sm" role="alert">
					{error.message}
				</p>
			)}
			{error instanceof SpaceInvitationRequestError &&
				error.code === "space.invitation.email_verification_required" && (
					<Link
						className={buttonVariants({ variant: "outline" })}
						search={{ redirect }}
						to="/login"
					>
						Verify with a magic link
					</Link>
				)}
			{query.isPending && <p className="text-sm">Loading invitation…</p>}
			{invitation && (
				<InvitationDecision
					invitation={invitation}
					onAccept={() => accept.mutate()}
					pending={accept.isPending}
				/>
			)}
			{query.isError && (
				<Button onClick={() => query.refetch()} variant="outline">
					Try again
				</Button>
			)}
			<Button
				disabled={signOut.isPending}
				onClick={() =>
					signOut
						.mutateAsync()
						.then(() =>
							window.location.assign(
								`/login?${new URLSearchParams({ redirect })}`
							)
						)
				}
				variant="ghost"
			>
				Use a different account
			</Button>
		</>
	);
}

function InvitationDecision({
	invitation,
	pending,
	onAccept,
}: {
	invitation: import("@openmeld/schemas").SpaceInvitation;
	pending: boolean;
	onAccept: () => void;
}) {
	if (invitation.status === "expired" || invitation.status === "revoked") {
		return (
			<p className="text-sm">
				This invitation has expired or was revoked. Ask {invitation.inviterName}{" "}
				for a new invitation.
			</p>
		);
	}
	if (invitation.status === "accepted") {
		return (
			<a
				className={buttonVariants()}
				href={`/spaces/${encodeURIComponent(invitation.spaceId)}`}
			>
				Open Space
			</a>
		);
	}
	return (
		<>
			<p className="text-sm">
				{invitation.inviterName} invited you to{" "}
				<strong>{invitation.spaceName}</strong> in {invitation.organizationName}
				.
			</p>
			<p className="text-muted-foreground text-sm">
				{invitation.audience === "guest"
					? "You’ll join only this Space as a guest. You won’t become an organization member or gain access to other Spaces."
					: "You’ll join this Space. If you’re not already in the organization, you’ll join it as a member too."}
			</p>
			<Button disabled={pending} onClick={onAccept}>
				{pending ? "Joining…" : "Accept and open Space"}
			</Button>
		</>
	);
}
