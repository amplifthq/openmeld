import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { CheckEmailCard } from "#/components/auth/check-email-card";
import { guardAnonymousOnlyRoute } from "#/lib/auth-entry-guard";

const checkEmailSearchSchema = z.object({
	email: z.string().trim().email().optional(),
});

export const Route = createFileRoute("/check-email")({
	validateSearch: (search) => {
		const parsed = checkEmailSearchSchema.safeParse(search);
		if (!parsed.success) {
			return {};
		}

		return parsed.data;
	},
	beforeLoad: async ({ location }) => {
		await guardAnonymousOnlyRoute(location.href);
	},
	component: CheckEmailRoute,
});

function CheckEmailRoute() {
	const search = Route.useSearch();

	return (
		<AuthPageShell>
			<CheckEmailCard email={search.email ?? null} />
		</AuthPageShell>
	);
}
