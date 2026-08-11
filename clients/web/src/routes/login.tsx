import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";
import { shouldPreferMagicLink } from "#/lib/auth-login-preference";
import { getCurrentRedirectTarget } from "#/lib/auth-redirect";

export const Route = createFileRoute("/login")({
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: LoginRoute,
});

function LoginRoute() {
	// Visitors sent here from an invitation are steered toward Magic Link, the
	// one path that clears both the recipient-match and email-verified gates in a
	// single step; expand it by default instead of hiding it behind "more
	// options" (which would surface the password form that leads to the gate).
	const preferMagicLink = shouldPreferMagicLink(getCurrentRedirectTarget());

	return (
		<AuthPageShell>
			<AuthCard preferMagicLink={preferMagicLink} view="login" />
		</AuthPageShell>
	);
}
