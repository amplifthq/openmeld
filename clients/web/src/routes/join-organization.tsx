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
	acceptOrganizationJoinLink,
	listOrganizations,
	previewOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { requestOrganizationJoinRequests } from "#/lib/organizations/organization-join-requests";
import {
	buildOrganizationDefaultPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";

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
	const join = useMutation({
		mutationFn: () => acceptOrganizationJoinLink({ token: input.token ?? "" }),
		onSuccess: (result) =>
			window.location.assign(
				preview.data?.active && preview.data.spaceId
					? buildOrganizationSpacePath({
							orgSlug: result.organizationSlug,
							spaceId: preview.data.spaceId,
						})
					: buildOrganizationDefaultPath(result.organizationSlug)
			),
	});
	const organizations = useQuery({
		queryKey: ["join-link-organizations", session.data?.user.id],
		enabled: Boolean(session.data),
		queryFn: listOrganizations,
	});
	const activeLink = preview.data?.active ? preview.data : null;
	const direct = activeLink?.mode === "direct";
	const activeMutation = direct ? join : request;
	const submitLabel = direct
		? `Join ${activeLink.organizationName}`
		: "Request to join";
	const busyLabel = direct ? "Joining…" : "Submitting…";
	const signInLabel = direct ? "Sign in to join" : "Sign in to request to join";
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
					{signInLabel}
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
						We’ve notified the owners and admins. Once one approves, you can
						enter the organization from your request page.
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
			<JoinLinkAction
				direct={direct}
				disabled={activeMutation.isPending || organizations.isPending}
				error={activeMutation.error}
				label={activeMutation.isPending ? busyLabel : submitLabel}
				onSubmit={() => activeMutation.mutate()}
				spaceAccessDescription={spaceAccessDescription}
			/>
		);
	};
	return (
		<AuthPageShell>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>
						{activeLink
							? `${activeLink.mode === "direct" ? "Join" : "Request to join"} ${activeLink.organizationName}`
							: "Request an invitation"}
					</CardTitle>
					<CardDescription>
						{activeLink?.mode === "direct"
							? "You’re invited. Join when you’re ready."
							: "An owner or admin must approve your request to join."}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">{content()}</CardContent>
			</Card>
		</AuthPageShell>
	);
}

function JoinLinkAction(input: {
	direct: boolean;
	error: Error | null;
	disabled: boolean;
	label: string;
	onSubmit: () => void;
	spaceAccessDescription: string;
}) {
	return (
		<>
			<p className="text-muted-foreground text-sm">
				{input.direct
					? "You’ll join as an organization member."
					: "You’re requesting to join as an organization member."}
				{input.spaceAccessDescription}
			</p>
			{input.error ? (
				<p className="text-destructive text-sm" role="alert">
					{input.error.message}
				</p>
			) : null}
			<Button disabled={input.disabled} onClick={input.onSubmit}>
				{input.label}
			</Button>
		</>
	);
}
