import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";
import { ADD_ACCOUNT_AUTH_INTENT } from "#/lib/auth-intent";
import { shouldPreferMagicLink } from "#/lib/auth-login-preference";
import { getCurrentRedirectTarget } from "#/lib/auth-redirect";
import { classifySignInError } from "#/lib/auth-sign-in-error";

export const Route = createFileRoute("/login")({
	head: () =>
		buildPublicPageHead({
			title: "Sign in",
			description: "Sign in to your OpenMeld account.",
			robots: "noindex, follow",
			includeCanonical: false,
		}),
	validateSearch: (
		search: Record<string, unknown>
	): {
		error?: string;
		intent?: typeof ADD_ACCOUNT_AUTH_INTENT;
		redirect?: string;
	} => ({
		...(typeof search.error === "string" ? { error: search.error } : {}),
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

	// Better Auth sends every unrecoverable sign-in failure here (see
	// `onAPIError.errorURL`), including a canceled or abandoned OAuth attempt.
	// An abandoned attempt lands on this ordinary, calm sign-in page with no
	// banner; a real failure still gets one visible message instead of Better
	// Auth's raw developer error page.
	useEffect(() => {
		const signInError = classifySignInError(search.error);
		if (signInError.kind === "failed") {
			toast.error(signInError.message);
		}
	}, [search.error]);

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
