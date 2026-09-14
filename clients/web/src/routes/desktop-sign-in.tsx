import { electronProxyClient } from "@better-auth/electron/proxy";
import { Button } from "@openmeld/ui/components/button";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createAuthClient } from "better-auth/client";
import { useState } from "react";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { env, getRequiredServerEnv } from "#/env";
import { ADD_ACCOUNT_AUTH_INTENT } from "#/lib/auth-intent";
import { getSession } from "#/lib/auth-session";
import { resolveDesktopBrowserIdentity } from "#/lib/desktop-browser-auth";

const readDesktopBrowserIdentity = createServerFn({ method: "GET" })
	.validator((value: unknown) => z.string().parse(value))
	.handler(({ data }) =>
		resolveDesktopBrowserIdentity({
			webOrigin: getRequiredServerEnv("WEB_APP_URL"),
			developmentTarget: env.AUTH_DESKTOP_DEVELOPMENT_TARGET,
			clientId: data,
		})
	);

export const Route = createFileRoute("/desktop-sign-in")({
	validateSearch: (search: Record<string, unknown>) => ({
		client_id: typeof search.client_id === "string" ? search.client_id : "",
		state: typeof search.state === "string" ? search.state : "",
		code_challenge:
			typeof search.code_challenge === "string" ? search.code_challenge : "",
		code_challenge_method:
			search.code_challenge_method === "S256" ? "S256" : "",
	}),
	beforeLoad: async ({ location, search }) => {
		const identity = await readDesktopBrowserIdentity({
			data: search.client_id,
		});
		const session = await getSession();
		if (!session) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		return { desktopIdentity: identity, desktopEmail: session.user.email };
	},
	component: DesktopSignIn,
});

function DesktopSignIn() {
	const query = Route.useSearch();
	const { desktopIdentity, desktopEmail } = Route.useRouteContext();
	const [message, setMessage] = useState(
		`Continue as ${desktopEmail} in OpenMeld Desktop.`
	);
	const [pending, setPending] = useState(false);
	async function continueInDesktop() {
		setPending(true);
		try {
			const client = createAuthClient({
				baseURL: window.location.origin,
				plugins: [
					electronProxyClient({
						protocol: desktopIdentity.authScheme,
						clientID: desktopIdentity.clientId,
					}),
				],
			});
			const result = await client.electron.transferUser({
				fetchOptions: { query },
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Could not sign in to Desktop."
				);
			}
			if (!client.electron.getAuthorizationCode()) {
				throw new Error(
					"The browser could not finish this sign-in. Try again."
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
					disabled={
						pending ||
						!query.state ||
						!query.code_challenge ||
						!query.code_challenge_method
					}
					onClick={continueInDesktop}
				>
					Continue in Desktop
				</Button>
				<Link
					className="block text-sm underline"
					search={{
						intent: ADD_ACCOUNT_AUTH_INTENT,
						redirect: `/desktop-sign-in?${new URLSearchParams(query).toString()}`,
					}}
					to="/login"
				>
					Use another account
				</Link>
			</section>
		</AuthPageShell>
	);
}
