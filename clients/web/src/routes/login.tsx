import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";
import { ADD_ACCOUNT_AUTH_INTENT } from "#/lib/auth-intent";
import { shouldPreferMagicLink } from "#/lib/auth-login-preference";
import { getCurrentRedirectTarget } from "#/lib/auth-redirect";

export const Route = createFileRoute("/login")({
	validateSearch: (
		search: Record<string, unknown>
	): { intent?: typeof ADD_ACCOUNT_AUTH_INTENT; redirect?: string } => ({
		...(search.intent === ADD_ACCOUNT_AUTH_INTENT
			? { intent: ADD_ACCOUNT_AUTH_INTENT }
			: {}),
		...(typeof search.redirect === "string"
			? { redirect: search.redirect }
			: {}),
	}),
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: LoginRoute,
});

function LoginRoute() {
	const search = Route.useSearch();
	// Visitors sent here from an invitation are steered toward Magic Link, the
	// one path that clears both the recipient-match and email-verified gates in a
	// single step; expand it by default instead of hiding it behind "more
	// options" (which would surface the password form that leads to the gate).
	const preferMagicLink = shouldPreferMagicLink(getCurrentRedirectTarget());

	return (
		<AuthPageShell>
			<AuthCard
				addingAccount={search.intent === ADD_ACCOUNT_AUTH_INTENT}
				preferMagicLink={preferMagicLink}
				view="login"
			/>
		</AuthPageShell>
	);
}
