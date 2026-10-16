import { buildPublicPageHead } from "@openmeld/product-catalog/site";
import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/reset-password")({
	head: () =>
		buildPublicPageHead({
			title: "Choose a new password",
			description: "Set a new password for your OpenMeld account.",
			robots: "noindex, follow",
			includeCanonical: false,
		}),
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: ResetPasswordRoute,
});

function ResetPasswordRoute() {
	return (
		<AuthPageShell>
			<AuthCard view="resetPassword" />
		</AuthPageShell>
	);
}
