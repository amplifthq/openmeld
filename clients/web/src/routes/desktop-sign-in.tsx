import { electronProxyClient } from "@better-auth/electron/proxy";
import { DESKTOP_AUTH_SCHEME } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createAuthClient } from "better-auth/client";
import { useState } from "react";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { getSession } from "#/lib/auth-session";

export const Route = createFileRoute("/desktop-sign-in")({
	validateSearch: (search: Record<string, unknown>) => ({
		client_id: typeof search.client_id === "string" ? search.client_id : "",
		state: typeof search.state === "string" ? search.state : "",
		code_challenge:
			typeof search.code_challenge === "string" ? search.code_challenge : "",
	}),
	beforeLoad: async ({ location }) => {
		const session = await getSession();
		if (!session) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
	},
	component: DesktopSignIn,
});

function DesktopSignIn() {
	const query = Route.useSearch();
	const [message, setMessage] = useState(
		"Continue with this account in OpenMeld Desktop."
	);
	const [pending, setPending] = useState(false);
	async function continueInDesktop() {
		setPending(true);
		try {
			const client = createAuthClient({
				baseURL: window.location.origin,
				plugins: [electronProxyClient({ protocol: DESKTOP_AUTH_SCHEME })],
			});
			const result = await client.electron.transferUser({
				fetchOptions: { query },
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Could not sign in to Desktop."
				);
			}
			client.ensureElectronRedirect();
			setMessage("Return to OpenMeld Desktop to continue.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Could not sign in to Desktop."
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<AuthPageShell>
			<section className="space-y-4">
				<h1 className="font-semibold text-xl">Sign in to Desktop</h1>
				<output>{message}</output>
				<Button
					disabled={pending || !query.state || !query.code_challenge}
					onClick={continueInDesktop}
				>
					Continue in Desktop
				</Button>
			</section>
		</AuthPageShell>
	);
}
