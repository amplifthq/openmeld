import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAuthSession } from "#/hooks/auth.hooks";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { requestSpaceInvitations } from "#/lib/organizations/space-invitations";

export function SpacePendingInvitations() {
	const session = useAuthSession();
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const query = useQuery({
		queryKey: ["space-invitations", session.data?.user.id, "pending"],
		queryFn: () => requestSpaceInvitations({ action: "pending" }),
		enabled: Boolean(session.data),
		retry: false,
	});
	const invitations =
		query.data?.filter(
			(invitation) => invitation.organizationId === organization?.id
		) ?? [];
	if (query.error) {
		return (
			<div
				className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
				role="alert"
			>
				<span>Couldn't load your invitations.</span>
				<Button onClick={() => query.refetch()} size="sm" variant="ghost">
					Try again
				</Button>
			</div>
		);
	}
	if (!invitations.length) {
		return null;
	}
	return (
		<section aria-label="Space invitations" className="grid gap-3 px-6 py-4">
			{invitations.map((invitation) => (
				<div
					className="flex items-center justify-between gap-4"
					key={invitation.id}
				>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="truncate font-medium text-sm">
								{invitation.spaceName}
							</span>
							<Badge variant="secondary">Invited</Badge>
						</div>
						<p className="text-muted-foreground text-xs">
							Invited by {invitation.inviterName}
						</p>
					</div>
					<Link
						className={buttonVariants({ variant: "outline", size: "sm" })}
						search={{ invitationId: invitation.id }}
						to="/accept-space-invitation"
					>
						Review invitation
					</Link>
				</div>
			))}
		</section>
	);
}
