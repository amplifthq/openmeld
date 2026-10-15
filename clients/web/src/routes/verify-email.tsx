import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/verify-email")({
	head: () =>
		buildPublicPageHead({
			title: "Verify your email",
			description: "Verify your email address for your OpenMeld account.",
			robots: "noindex, follow",
			includeCanonical: false,
		}),
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: VerifyEmailRoute,
});

function VerifyEmailRoute() {
	return (
		<AuthPageShell>
			<AuthCard view="verifyEmail" />
		</AuthPageShell>
	);
}
