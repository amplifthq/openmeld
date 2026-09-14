import { Button } from "@openmeld/ui/components/button";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import { resolveOptionalActiveOrganizationEntryPath } from "#/lib/organizations/organization-scope";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { formatDesktopError } from "./desktop-error";
import { getDesktopPlatform } from "./platform";

export function DesktopEntry() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { redirect: returnPath } = useSearch({ from: "/desktop-shell" });
	const [pendingOperation, setPendingOperation] = useState<
		"session" | "browser" | null
	>("session");
	const pending = pendingOperation !== null;
	const [error, setError] = useState<string | null>(null);
	const [browserOpened, setBrowserOpened] = useState(false);
	const bridge = getDesktopPlatform();

	useEffect(() => {
		if (!bridge) {
			setPendingOperation(null);
			return;
		}
		let disposed = false;
		let revision = 0;
		let prepared = Promise.resolve();
		const refresh = (sessionChanged = false) => {
			if (sessionChanged) {
				setPendingOperation("session");
				setError(null);
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
							formatDesktopError(
								failure,
								"Could not open your workspace. Try signing in again."
							)
						);
					}
				})
				.finally(() => {
					if (active()) {
						setPendingOperation(null);
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

	const copy = desktopEntryCopy(
		Boolean(bridge),
		pendingOperation,
		browserOpened && !error
	);
	return (
		<main className="flex min-h-svh items-center justify-center bg-background p-6">
			<section
				aria-busy={pending}
				className="w-full max-w-sm space-y-6 text-center"
			>
				<div className="mx-auto w-fit">
					<OpenMeldLogo colors={OPENMELD_LOGO_THEME_COLORS} scale={0.2} />
				</div>
				<div className="space-y-2">
					<h1 className="font-semibold text-xl">{copy.title}</h1>
					<output className="block text-muted-foreground text-sm leading-relaxed">
						{copy.description}
					</output>
				</div>
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
				{bridge && (
					<Button
						className="w-full"
						disabled={pending}
						onClick={async () => {
							setError(null);
							setPendingOperation("browser");
							try {
								await bridge.signIn();
								setBrowserOpened(true);
							} catch (failure) {
								setError(
									formatDesktopError(
										failure,
										"Could not open your browser. Try again."
									)
								);
							} finally {
								setPendingOperation(null);
							}
						}}
					>
						{copy.action}
					</Button>
				)}
			</section>
		</main>
	);
}

function desktopEntryCopy(
	available: boolean,
	pending: "session" | "browser" | null,
	browserOpened: boolean
) {
	if (!available) {
		return {
			title: "Sign in to Desktop",
			description: "Open the Desktop app to sign in.",
			action: "Sign in with browser",
		};
	}
	if (pending === "browser") {
		return {
			title: "Opening your browser",
			description:
				"Continue signing in with your OpenMeld account in the browser.",
			action: "Opening browser…",
		};
	}
	if (pending === "session") {
		return {
			title: "Opening your workspace",
			description: "Checking your sign-in…",
			action: "Please wait…",
		};
	}
	if (browserOpened) {
		return {
			title: "Continue in your browser",
			description:
				"Finish signing in, then choose Continue in Desktop. Your workspace will open here.",
			action: "Open browser again",
		};
	}
	return {
		title: "Sign in to Desktop",
		description:
			"Use your OpenMeld account to access the same workspaces and agents.",
		action: "Sign in with browser",
	};
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
