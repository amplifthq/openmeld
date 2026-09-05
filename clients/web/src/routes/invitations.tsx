import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import { requestSpaceInvitations } from "#/lib/organizations/space-invitations";

export const Route = createFileRoute("/invitations")({
	component: InvitationsPage,
});

function InvitationsPage() {
	const session = useAuthSession();
	const query = useQuery({
		queryKey: ["space-invitations", session.data?.user.id, "pending"],
		queryFn: () => requestSpaceInvitations({ action: "pending" }),
		enabled: Boolean(session.data),
		retry: false,
	});
	return (
		<AuthPageShell>
			<Card className="w-full max-w-lg">
				<CardHeader>
					<CardTitle>Invitations</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{session.isPending && <p>Loading your account…</p>}
					{!session.isPending && session.data && (
						<>
							<p className="text-muted-foreground text-sm">
								Invitations for {session.data.user.email}
							</p>
							{query.isPending && <p>Loading invitations…</p>}
							{query.error && (
								<p className="text-destructive text-sm" role="alert">
									{query.error.message}
								</p>
							)}
							{query.data?.length === 0 && (
								<p className="text-sm">
									You have no pending Space invitations.
								</p>
							)}
							{query.data?.map((invitation) => (
								<div
									className="flex items-center justify-between gap-4 border-t pt-3"
									key={invitation.id}
								>
									<div className="min-w-0">
										<p className="truncate font-medium text-sm">
											{invitation.spaceName}
										</p>
										<p className="text-muted-foreground text-xs">
											{invitation.organizationName} · Invited by{" "}
											{invitation.inviterName}
										</p>
									</div>
									<Link
										className={buttonVariants({
											variant: "outline",
											size: "sm",
										})}
										search={{ invitationId: invitation.id }}
										to="/accept-space-invitation"
									>
										Review
									</Link>
								</div>
							))}
						</>
					)}
					{!(session.isPending || session.data) && (
						<Link
							className={buttonVariants()}
							search={{ redirect: "/invitations" }}
							to="/login"
						>
							Sign in to view invitations
						</Link>
					)}
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}
