import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession, useSignOut } from "#/hooks/auth.hooks";
import { getAuthErrorCode } from "#/lib/auth-errors";
import {
	acceptOrganizationInvitation,
	listOrganizations,
} from "#/lib/organizations/auth-organizations";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";

const acceptInvitationSearchSchema = z.object({
	hint: z.string().trim().min(1).optional(),
	invitationId: z.string().trim().min(1).optional(),
	org: z.string().trim().min(1).optional(),
	orgSlug: z.string().trim().min(1).optional(),
});

type AcceptInvitationSearch = z.infer<typeof acceptInvitationSearchSchema>;

// Error codes surfaced by Better Auth's organization acceptInvitation route.
// Kept local because the web client has no shared constant for them. The
// transport layer now preserves error.code (see OrganizationRequestError), so
// we branch on these stable codes rather than matching localized message text.
const NOT_RECIPIENT_CODE = "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION";
const EMAIL_NOT_VERIFIED_CODE =
	"EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION";
const INVITATION_NOT_FOUND_CODE = "INVITATION_NOT_FOUND";

export const Route = createFileRoute("/accept-invitation")({
	component: AcceptInvitationRoute,
	validateSearch: (search) => {
		const parsed = acceptInvitationSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
});

function AcceptInvitationRoute() {
	const search = Route.useSearch();
	return <AcceptInvitationPage {...search} />;
}

function buildAcceptInvitationPath(search: AcceptInvitationSearch): string {
	const params = new URLSearchParams();
	if (search.invitationId) {
		params.set("invitationId", search.invitationId);
	}
	if (search.hint) {
		params.set("hint", search.hint);
	}
	if (search.org) {
		params.set("org", search.org);
	}
	if (search.orgSlug) {
		params.set("orgSlug", search.orgSlug);
	}
	const query = params.toString();
	return query ? `/accept-invitation?${query}` : "/accept-invitation";
}

type BodyProps = {
	acceptPath: string;
	acceptSuccess: boolean;
	alreadyMember: boolean;
	currentEmail: string | null;
	errorCode: string | null;
	genericMessage: string | null;
	invitationId?: string;
	invitedLabel: string;
	isSignedIn: boolean;
	membershipPending: boolean;
	openOrganizationFailed: boolean;
	onRetry: () => void;
	onRetryOpenOrganization: () => void;
	onSwitchAccount: () => void;
	orgLabel: string;
	orgSlug?: string;
	sessionPending: boolean;
	signOutPending: boolean;
};

function InvitationNotFoundBranch(props: {
	alreadyMember: boolean;
	membershipPending: boolean;
	orgLabel: string;
	orgSlug?: string;
}) {
	if (props.membershipPending && props.orgSlug) {
		return (
			<p className="text-muted-foreground text-sm">
				Checking your membership...
			</p>
		);
	}
	if (props.alreadyMember && props.orgSlug) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					You are already a member of {props.orgLabel}.
				</p>
				<Link
					className={buttonVariants()}
					to={buildOrganizationDefaultPath(props.orgSlug)}
				>
					Go to {props.orgLabel}
				</Link>
			</div>
		);
	}
	return (
		<p className="text-destructive text-sm">
			This invitation is no longer valid. It may have expired or been revoked.
			Ask an organization admin to send a new one.
		</p>
	);
}

// Renders exactly one state; the branches are mutually exclusive so an ordered
// set of early returns keeps each case flat and easy to follow.
function AcceptInvitationBody(props: BodyProps) {
	if (!props.invitationId) {
		return (
			<p className="text-destructive text-sm">
				This invitation link is missing an invitation id.
			</p>
		);
	}
	if (props.sessionPending) {
		return (
			<p className="text-muted-foreground text-sm">
				Checking your sign-in status.
			</p>
		);
	}
	if (!props.isSignedIn) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					This invitation was sent to {props.invitedLabel}. Sign in with that
					email address (a magic link is the quickest way) and you will join{" "}
					{props.orgLabel} automatically.
				</p>
				<Link
					className={buttonVariants()}
					search={{ redirect: props.acceptPath }}
					to="/login"
				>
					Sign in to accept
				</Link>
			</div>
		);
	}
	if (props.errorCode === NOT_RECIPIENT_CODE) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					You are signed in as {props.currentEmail ?? "another account"}, but
					this invitation was sent to {props.invitedLabel}. Sign out and
					continue with the invited email to accept.
				</p>
				<Button
					disabled={props.signOutPending}
					onClick={props.onSwitchAccount}
					type="button"
				>
					{props.signOutPending
						? "Signing out..."
						: `Sign out and use ${props.invitedLabel}`}
				</Button>
			</div>
		);
	}
	if (props.errorCode === EMAIL_NOT_VERIFIED_CODE) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Your email address is not verified yet. The simplest fix is to sign in
					again with a magic link, which verifies your email and accepts the
					invitation in one step.
				</p>
				<Link
					className={buttonVariants()}
					search={{ redirect: props.acceptPath }}
					to="/login"
				>
					Continue with a magic link
				</Link>
			</div>
		);
	}
	if (props.errorCode === INVITATION_NOT_FOUND_CODE) {
		return (
			<InvitationNotFoundBranch
				alreadyMember={props.alreadyMember}
				membershipPending={props.membershipPending}
				orgLabel={props.orgLabel}
				orgSlug={props.orgSlug}
			/>
		);
	}
	if (props.genericMessage) {
		return (
			<div className="space-y-3">
				<p className="text-destructive text-sm">{props.genericMessage}</p>
				<Button onClick={props.onRetry} type="button">
					Try again
				</Button>
			</div>
		);
	}
	if (props.openOrganizationFailed) {
		return (
			<div className="space-y-3">
				<p className="text-destructive text-sm">
					Your invitation was accepted, but OpenMeld could not open{" "}
					{props.orgLabel}. Your membership is safe.
				</p>
				<Button onClick={props.onRetryOpenOrganization} type="button">
					Open {props.orgLabel} again
				</Button>
			</div>
		);
	}
	if (props.acceptSuccess) {
		return (
			<p className="text-muted-foreground text-sm">
				You are in. Taking you to {props.orgLabel}...
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-sm">Joining {props.orgLabel}...</p>
	);
}

export function AcceptInvitationPage(search: AcceptInvitationSearch) {
	const { invitationId, hint, org, orgSlug } = search;
	const sessionQuery = useAuthSession();
	const navigate = useNavigate();
	const signOut = useSignOut();

	const openOrganizationMutation = useMutation({
		mutationFn: (organization: { slug: string }) =>
			navigate({
				to: buildOrganizationDefaultPath(organization.slug),
			}),
	});

	const acceptMutation = useMutation({
		mutationFn: async () => {
			if (!invitationId) {
				throw new Error("Invitation link is missing an invitation id.");
			}
			const acceptedInvitation = await acceptOrganizationInvitation({
				invitationId,
			});
			const organizations = await listOrganizations();
			const acceptedOrganization = organizations.find(
				(organization) =>
					organization.id === acceptedInvitation.organizationId &&
					organization.isPersonal !== true
			);
			if (!acceptedOrganization) {
				throw new Error(
					"OpenMeld accepted this invitation, but could not find the organization in your account. Refresh this page and try again."
				);
			}
			return acceptedOrganization;
		},
		onSuccess: (organization) => {
			openOrganizationMutation.mutate(organization);
		},
	});

	// The invitation is bound to the current session server-side, so once the
	// visitor is signed in we optimistically attempt acceptance and branch on the
	// returned error code instead of making them click a button.
	const isSignedIn = Boolean(sessionQuery.data);
	const autoAcceptStarted = useRef(false);
	const { mutate: attemptAccept } = acceptMutation;
	useEffect(() => {
		if (!(invitationId && isSignedIn) || autoAcceptStarted.current) {
			return;
		}
		autoAcceptStarted.current = true;
		attemptAccept();
	}, [invitationId, isSignedIn, attemptAccept]);

	const errorCode = acceptMutation.isError
		? getAuthErrorCode(acceptMutation.error)
		: null;

	// If the invitation is gone, the visitor may simply already be a member.
	const membershipQuery = useQuery({
		enabled: errorCode === INVITATION_NOT_FOUND_CODE && Boolean(orgSlug),
		queryFn: listOrganizations,
		queryKey: ["accept-invitation", "membership", orgSlug],
	});
	const alreadyMember = Boolean(
		orgSlug &&
			membershipQuery.data?.some(
				(organization) =>
					organization.slug === orgSlug && organization.isPersonal !== true
			)
	);

	const isKnownErrorCode =
		errorCode === NOT_RECIPIENT_CODE ||
		errorCode === EMAIL_NOT_VERIFIED_CODE ||
		errorCode === INVITATION_NOT_FOUND_CODE;
	const genericMessage =
		acceptMutation.isError && !isKnownErrorCode
			? (acceptMutation.error?.message ?? "Something went wrong. Try again.")
			: null;

	const handleSwitchAccount = () => {
		const acceptPath = buildAcceptInvitationPath(search);
		signOut
			.mutateAsync()
			.then(() => navigate({ search: { redirect: acceptPath }, to: "/login" }))
			.catch(() => undefined);
	};

	return (
		<AuthPageShell>
			<Card>
				<CardHeader>
					<CardTitle>Accept invitation</CardTitle>
					<CardDescription>
						Join {org ?? "the organization"} on OpenMeld with the email address
						that received this invitation.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<AcceptInvitationBody
						acceptPath={buildAcceptInvitationPath(search)}
						acceptSuccess={acceptMutation.isSuccess}
						alreadyMember={alreadyMember}
						currentEmail={sessionQuery.data?.user?.email ?? null}
						errorCode={errorCode}
						genericMessage={genericMessage}
						invitationId={invitationId}
						invitedLabel={hint ?? "the invited email address"}
						isSignedIn={isSignedIn}
						membershipPending={membershipQuery.isPending}
						onRetry={() => acceptMutation.mutate()}
						onRetryOpenOrganization={() => {
							if (acceptMutation.data) {
								openOrganizationMutation.mutate(acceptMutation.data);
							}
						}}
						onSwitchAccount={handleSwitchAccount}
						openOrganizationFailed={openOrganizationMutation.isError}
						orgLabel={org ?? "the organization"}
						orgSlug={orgSlug}
						sessionPending={sessionQuery.isPending}
						signOutPending={signOut.isPending}
					/>
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}
