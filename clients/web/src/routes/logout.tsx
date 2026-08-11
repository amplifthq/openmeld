import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";

export const Route = createFileRoute("/logout")({
	component: LogoutRoute,
});

function LogoutRoute() {
	return (
		<AuthPageShell>
			<AuthCard view="logout" />
		</AuthPageShell>
	);
}
