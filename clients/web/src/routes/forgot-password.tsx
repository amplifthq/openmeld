import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/forgot-password")({
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: ForgotPasswordRoute,
});

function ForgotPasswordRoute() {
	return (
		<AuthPageShell>
			<AuthCard view="forgotPassword" />
		</AuthPageShell>
	);
}
