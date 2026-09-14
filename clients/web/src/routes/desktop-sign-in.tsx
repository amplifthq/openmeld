import { electronProxyClient } from "@better-auth/electron/proxy";
import { Button } from "@openmeld/ui/components/button";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { createAuthClient } from "better-auth/client";
import { useState } from "react";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
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
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [pending, setPending] = useState(false);
	const validRequest = Boolean(
		query.state && query.code_challenge && query.code_challenge_method
	);
	async function continueInDesktop() {
		setPending(true);
		setFailed(false);
		setMessage(null);
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
		} catch {
			setFailed(true);
			setMessage(
				"Could not complete this sign-in. Return to Desktop and start signing in again."
			);
		} finally {
			setPending(false);
		}
	}
	return (
		<AuthPageShell>
			<section
				aria-busy={pending}
				className="w-full max-w-sm space-y-6 text-center"
			>
				<div className="mx-auto w-fit">
					<OpenMeldLogo colors={OPENMELD_LOGO_THEME_COLORS} scale={0.2} />
				</div>
				<div className="space-y-2">
					<h1 className="font-semibold text-xl">Continue to Desktop</h1>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Open your workspace in the OpenMeld Desktop app.
					</p>
				</div>
				<div className="space-y-1 border-y py-3">
					<p className="text-muted-foreground text-xs">Signed in as</p>
					<p className="break-words font-medium text-sm">{desktopEmail}</p>
				</div>
				{!validRequest || message ? (
					<p
						className={
							failed || !validRequest
								? "text-destructive text-sm"
								: "text-muted-foreground text-sm"
						}
						role={failed || !validRequest ? "alert" : "status"}
					>
						{validRequest
							? message
							: "This sign-in link is incomplete. Return to Desktop and start signing in again."}
					</p>
				) : null}
				<div className="space-y-3">
					<Button
						className="w-full"
						disabled={pending || !validRequest}
						onClick={continueInDesktop}
					>
						{pending ? "Opening Desktop…" : "Continue in Desktop"}
					</Button>
					<Link
						className="block py-2 text-center text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
						search={{
							intent: ADD_ACCOUNT_AUTH_INTENT,
							redirect: `/desktop-sign-in?${new URLSearchParams(query).toString()}`,
						}}
						to="/login"
					>
						Use another account
					</Link>
				</div>
			</section>
		</AuthPageShell>
	);
}
