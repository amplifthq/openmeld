import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/reset-password")({
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
