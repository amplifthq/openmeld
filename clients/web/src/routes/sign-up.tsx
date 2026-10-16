import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/sign-up")({
	head: () =>
		buildPublicPageHead({
			title: "Create an account",
			description:
				"Create your OpenMeld account to work with people and agents.",
			robots: "noindex, follow",
			includeCanonical: false,
		}),
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: SignUpRoute,
});

function SignUpRoute() {
	return (
		<AuthPageShell>
			<AuthCard view="signUp" />
		</AuthPageShell>
	);
}
