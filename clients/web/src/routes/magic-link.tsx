import { createFileRoute } from "@tanstack/react-router";
import { AuthCard } from "#/components/auth/auth-card";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

export const Route = createFileRoute("/magic-link")({
	validateSearch: (
		search: Record<string, unknown>
	): { token?: string; error?: string } => {
		const nextSearch: { token?: string; error?: string } = {};
		if (typeof search.token === "string") {
			nextSearch.token = search.token;
		}

		if (typeof search.error === "string") {
			nextSearch.error = search.error;
		}

		return nextSearch;
	},
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: MagicLinkRoute,
});

function MagicLinkRoute() {
	const search = Route.useSearch();
	const hasToken = Boolean(search.token || search.error);

	return (
		<AuthPageShell>
			<AuthCard hasToken={hasToken} view="magicLink" />
		</AuthPageShell>
	);
}
