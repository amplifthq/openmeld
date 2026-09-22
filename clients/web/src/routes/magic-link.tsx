import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";
import { ADD_ACCOUNT_AUTH_INTENT } from "#/lib/auth-intent";
import { isSocialOAuthCallbackError } from "#/lib/auth-sign-in-error";

export const Route = createFileRoute("/magic-link")({
	validateSearch: (
		search: Record<string, unknown>
	): {
		token?: string;
		error?: string;
		intent?: typeof ADD_ACCOUNT_AUTH_INTENT;
		redirect?: string;
	} => {
		const nextSearch: {
			token?: string;
			error?: string;
			intent?: typeof ADD_ACCOUNT_AUTH_INTENT;
			redirect?: string;
		} = {};
		if (typeof search.token === "string") {
			nextSearch.token = search.token;
		}

		if (typeof search.error === "string") {
			nextSearch.error = search.error;
		}
		if (search.intent === ADD_ACCOUNT_AUTH_INTENT) {
			nextSearch.intent = ADD_ACCOUNT_AUTH_INTENT;
		}
		if (typeof search.redirect === "string") {
			nextSearch.redirect = search.redirect;
		}

		return nextSearch;
	},
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: MagicLinkRoute,
});

export function magicLinkRouteShowsVerification(search: {
	error?: string;
	token?: string;
}): boolean {
	if (search.token) {
		return true;
	}
	// A social OAuth `error` belongs to `/login`. Treating it as a magic-link
	// verification failure shows "Verification Failed" for a canceled provider
	// sign-in. A magic-link verification error still starts verification.
	return Boolean(search.error) && !isSocialOAuthCallbackError(search.error);
}

function MagicLinkRoute() {
	const search = Route.useSearch();
	const hasToken = magicLinkRouteShowsVerification(search);

	return (
		<AuthPageShell>
			<AuthCard
				addingAccount={search.intent === ADD_ACCOUNT_AUTH_INTENT}
				hasToken={hasToken}
				view="magicLink"
			/>
		</AuthPageShell>
	);
}
