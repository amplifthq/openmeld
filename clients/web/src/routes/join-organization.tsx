import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	listOrganizations,
	previewOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";

export const Route = createFileRoute("/join-organization")({
	component: JoinOrganizationRoute,
	validateSearch: (search: Record<string, unknown>): { token?: string } => ({
		token: typeof search.token === "string" ? search.token : undefined,
	}),
});
function JoinOrganizationRoute() {
	const { token } = Route.useSearch();
	const locationHref = useLocation({ select: (location) => location.href });
	return (
		<JoinOrganizationPage locationHref={locationHref} token={token ?? null} />
	);
}
export function JoinOrganizationPage(input: {
	token: string | null;
	locationHref: string;
}) {
	const session = useAuthSession();
	const preview = useQuery({
		queryKey: ["organization-join-link", "preview", input.token],
		enabled: Boolean(input.token),
		retry: false,
		queryFn: () => previewOrganizationJoinLink({ token: input.token ?? "" }),
	});
	const request = useMutation({
		mutationFn: () =>
			requestOrganizationJoinRequests({ token: input.token ?? "" }),
	});
	const organizations = useQuery({
		queryKey: ["join-link-organizations", session.data?.user.id],
		enabled: Boolean(session.data),
		queryFn: listOrganizations,
	});
	const activeLink = preview.data?.active ? preview.data : null;
	const existing =
		activeLink && !activeLink.spaceId
			? organizations.data?.find(
					(organization) => organization.slug === activeLink.organizationSlug
				)
			: undefined;
	const submitted = request.data?.[0];
	const spaceAccessDescription = activeLink?.spaceId
		? " The invitation also includes access to the Space shared by the sender."
		: "";
	const content = () => {
		if (!input.token) {
			return (
				<p>This invite link is incomplete. Ask the sender for a new link.</p>
			);
		}
		if (preview.isPending || session.isPending) {
			return <p>Checking this invitation…</p>;
		}
		if (preview.error) {
			return <p role="alert">{preview.error.message}</p>;
		}
		if (!activeLink) {
			return (
				<p>
					This invite link is no longer active. Ask the sender for a new link.
				</p>
			);
		}
		if (!session.data) {
			return (
				<Link
					className={buttonVariants()}
					search={{ redirect: input.locationHref }}
					to="/login"
				>
					Sign in to request an invitation
				</Link>
			);
		}
		if (existing) {
			return (
				<>
					<p>You already belong to {existing.name}.</p>
					<Link
						className={buttonVariants()}
						to={buildOrganizationDefaultPath(existing.slug)}
					>
						Open organization
					</Link>
				</>
			);
		}
		if (submitted) {
			return (
				<>
					<p>
						Your request was submitted. After approval, you’ll receive an
						invitation by email.
					</p>
					<a
						className={buttonVariants({ variant: "outline" })}
						href={`/invitation-requests?requestId=${encodeURIComponent(submitted.id)}`}
					>
						View request
					</a>
				</>
			);
		}
		return (
			<>
				<p className="text-muted-foreground text-sm">
					You’re requesting to join as an organization member, not a guest.
					{spaceAccessDescription}
				</p>
				{request.error ? (
					<p className="text-destructive text-sm" role="alert">
						{request.error.message}
					</p>
				) : null}
				<Button
					disabled={request.isPending || organizations.isPending}
					onClick={() => request.mutate()}
				>
					{request.isPending ? "Submitting…" : "Request invitation"}
				</Button>
			</>
		);
	};
	return (
		<AuthPageShell>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>
						{activeLink
							? `Request to join ${activeLink.organizationName}`
							: "Request an invitation"}
					</CardTitle>
					<CardDescription>
						An organization owner or admin must approve your request before you
						can join.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">{content()}</CardContent>
			</Card>
		</AuthPageShell>
	);
}
