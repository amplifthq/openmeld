import { Button } from "@openmeld/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import { resolveOptionalActiveOrganizationEntryPath } from "#/lib/organizations/organization-scope";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { getDesktopPlatform } from "./platform";

export function DesktopEntry() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { redirect: returnPath } = useSearch({ from: "/desktop-shell" });
	const [pending, setPending] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const bridge = getDesktopPlatform();

	useEffect(() => {
		if (!bridge) {
			setPending(false);
			return;
		}
		let disposed = false;
		let revision = 0;
		let prepared = Promise.resolve();
		const refresh = (sessionChanged = false) => {
			if (sessionChanged) {
				revision++;
				prepared = resetAccountScopedQueriesAfterAuthChange(queryClient);
			}
			const current = revision;
			const active = () =>
				!disposed &&
				current === revision &&
				router.state.location.pathname === "/desktop-shell";
			prepared
				.then(() => (active() ? resolveDesktopEntry(bridge, returnPath) : null))
				.then(async (path) => {
					if (path && active()) {
						await router.navigate({ to: path, replace: true });
					}
				})
				.catch((failure: unknown) => {
					if (active()) {
						setError(
							failure instanceof Error
								? failure.message
								: "Could not check your sign-in. Try again."
						);
					}
				})
				.finally(() => {
					if (active()) {
						setPending(false);
					}
				});
		};
		refresh();
		const onFocus = () => refresh();
		const unsubscribe = bridge.onSessionChanged(() => refresh(true));
		window.addEventListener("focus", onFocus);
		return () => {
			disposed = true;
			unsubscribe();
			window.removeEventListener("focus", onFocus);
		};
	}, [bridge, router, returnPath, queryClient]);

	return (
		<main className="flex min-h-svh items-center justify-center bg-background p-6">
			<section className="w-full max-w-sm space-y-5">
				<OpenMeldLogo scale={0.2} />
				<div className="space-y-2">
					<h1 className="font-medium text-xl">OpenMeld Desktop</h1>
					<p className="text-muted-foreground text-sm">
						{bridge
							? "Sign in with your browser to open your workspace."
							: "Open the Desktop app to sign in."}
					</p>
				</div>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				{bridge && (
					<Button
						disabled={pending}
						onClick={async () => {
							setError(null);
							setPending(true);
							try {
								await bridge.signIn();
							} catch (failure) {
								setError(
									failure instanceof Error
										? failure.message
										: "Could not open your browser. Try again."
								);
							} finally {
								setPending(false);
							}
						}}
					>
						{pending ? "Checking sign-in…" : "Sign in with browser"}
					</Button>
				)}
			</section>
		</main>
	);
}

async function resolveDesktopEntry(
	bridge: NonNullable<ReturnType<typeof getDesktopPlatform>>,
	returnPath?: string
) {
	const session = await bridge.session();
	if (!session.user) {
		return null;
	}
	if (returnPath) {
		return returnPath;
	}
	const path = await resolveOptionalActiveOrganizationEntryPath({
		data: { routeFamily: "/desktop-shell" },
	});
	if (!path) {
		throw new Error(
			"Your workspace could not be opened. Try signing in again."
		);
	}
	return path;
}
