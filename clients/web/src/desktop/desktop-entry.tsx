import type { DesktopPlatform, DesktopSession } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { OpenMeldLoadingScreen } from "@openmeld/ui/components/openmeld-loading-screen";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import {
	NoAvailableOrganizationError,
	resolveOptionalActiveOrganizationEntryPath,
} from "#/lib/organizations/organization-scope";
import {
	clearPrivateAccountStateAfterSessionRead,
	readKnownAccountIdBeforeSessionRevalidation,
	resetAccountScopedQueriesAfterAuthChange,
} from "#/query/auth-boundary";
import { forgetDesktopSession, readDesktopSession } from "./auth-boundary";
import { formatDesktopError } from "./desktop-error";
import { getDesktopPlatform } from "./platform";

const MAC_OS_PLATFORM_PATTERN = /mac/i;

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
	const [signedOut, setSignedOut] = useState(false);
	const [workspaceUnavailable, setWorkspaceUnavailable] = useState(false);
	const bridge = getDesktopPlatform();
	const [showKeychainNotice, setShowKeychainNotice] = useState(() =>
		Boolean(bridge && shouldShowMacOSKeychainNotice(undefined, navigator))
	);
	const primaryAction = useRef<() => void>(() => undefined);
	const keychainNotice = showKeychainNotice ? (
		<p className="max-w-sm text-muted-foreground text-xs leading-relaxed">
			Your computer may ask to access saved sign-in information. If a system
			prompt appears, respond to it to continue.
		</p>
	) : null;

	useEffect(() => {
		let disposed = false;
		if (!bridge) {
			setShowKeychainNotice(false);
			return;
		}
		bridge
			.platform()
			.then((platform) => {
				if (!disposed) {
					setShowKeychainNotice(
						shouldShowMacOSKeychainNotice(platform, navigator)
					);
				}
			})
			.catch(() => {
				if (!disposed) {
					setShowKeychainNotice(false);
				}
			});
		return () => {
			disposed = true;
		};
	}, [bridge]);

	useEffect(() => {
		if (!bridge) {
			setPendingOperation(null);
			return;
		}
		let disposed = false;
		let busy = false;
		let canSignIn = false;
		let noWorkspace = false;
		let revision = 0;
		let prepared = Promise.resolve();
		let sessionInvalidationRevision = 0;
		let handledSessionInvalidationRevision = 0;
		let confirmedAccountId: string | null | undefined =
			readKnownAccountIdBeforeSessionRevalidation(queryClient);
		let pendingInvalidationPreviousAccountId: string | null | undefined;
		const refresh = (sessionChanged = false) => {
			if (disposed || ((busy || noWorkspace) && !sessionChanged)) {
				return;
			}
			busy = true;
			canSignIn = false;
			setSignedOut(false);
			setPendingOperation("session");
			setError(null);
			noWorkspace = false;
			setWorkspaceUnavailable(false);
			if (sessionChanged) {
				forgetDesktopSession(queryClient);
				if (
					sessionInvalidationRevision === handledSessionInvalidationRevision
				) {
					pendingInvalidationPreviousAccountId = confirmedAccountId;
				}
				sessionInvalidationRevision += 1;
			}
			const refreshPreviousAccountId = confirmedAccountId;
			const current = ++revision;
			const active = () =>
				!disposed &&
				current === revision &&
				router.state.location.pathname === "/desktop-shell";
			prepared = prepared
				.then(async () => {
					if (!active()) {
						return null;
					}
					const invalidationRevision = sessionInvalidationRevision;
					const hasPendingSessionInvalidation =
						invalidationRevision > handledSessionInvalidationRevision;
					const result = await revalidateDesktopEntry({
						active,
						bridge,
						previousAccountId: hasPendingSessionInvalidation
							? pendingInvalidationPreviousAccountId
							: refreshPreviousAccountId,
						queryClient,
						sessionChanged: hasPendingSessionInvalidation,
					});
					return result
						? {
								...result,
								hasPendingSessionInvalidation,
								invalidationRevision,
							}
						: null;
				})
				.then(async (result) => {
					if (!(result && active())) {
						return;
					}
					confirmedAccountId = result.accountId;
					canSignIn = result.accountId === null;
					setSignedOut(canSignIn);
					// The session read has handled this invalidation even if workspace
					// resolution fails. A later retry must not clear same-account data again.
					if (result.hasPendingSessionInvalidation) {
						handledSessionInvalidationRevision = result.invalidationRevision;
						if (
							handledSessionInvalidationRevision === sessionInvalidationRevision
						) {
							pendingInvalidationPreviousAccountId = undefined;
						}
					}
					const path = await resolveDesktopEntry(result.session, returnPath);
					if (path && active()) {
						await router.navigate({ to: path, replace: true });
					}
				})
				.catch((failure: unknown) => {
					if (active()) {
						if (failure instanceof NoAvailableOrganizationError) {
							noWorkspace = true;
							setWorkspaceUnavailable(true);
							setError(failure.message);
							return;
						}
						setError(
							formatDesktopError(
								failure,
								"Could not open your workspace. Check your connection and try again."
							)
						);
					}
				})
				.finally(() => {
					if (active()) {
						busy = false;
						setPendingOperation(null);
					}
				});
		};
		primaryAction.current = () => {
			if (
				disposed ||
				busy ||
				router.state.location.pathname !== "/desktop-shell"
			) {
				return;
			}
			if (!canSignIn) {
				refresh();
				return;
			}
			busy = true;
			const current = ++revision;
			const active = () =>
				!disposed &&
				current === revision &&
				router.state.location.pathname === "/desktop-shell";
			setError(null);
			setPendingOperation("browser");
			bridge
				.signIn()
				.then(() => {
					if (active()) {
						setBrowserOpened(true);
					}
				})
				.catch((failure: unknown) => {
					if (active()) {
						setError(
							formatDesktopError(
								failure,
								"Could not open your browser. Try again."
							)
						);
					}
				})
				.finally(() => {
					if (active()) {
						busy = false;
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
			primaryAction.current = () => undefined;
			unsubscribe();
			window.removeEventListener("focus", onFocus);
		};
	}, [bridge, router, returnPath, queryClient]);

	if (pendingOperation === "session") {
		return (
			<OpenMeldLoadingScreen className="bg-[var(--app-canvas)]">
				{keychainNotice}
			</OpenMeldLoadingScreen>
		);
	}

	const copy = workspaceUnavailable
		? {
				title: "Workspace unavailable",
				description: "This account has no available workspace.",
				action: "Retry",
			}
		: desktopEntryCopy(
				Boolean(bridge),
				pendingOperation,
				browserOpened && !error,
				signedOut
			);
	return (
		<main className="flex min-h-svh items-center justify-center bg-[var(--app-canvas)] p-6">
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
				{bridge && !workspaceUnavailable && (
					<div className="space-y-2">
						<Button
							className="w-full"
							disabled={pending}
							onClick={() => primaryAction.current()}
						>
							{copy.action}
						</Button>
						{signedOut && keychainNotice}
					</div>
				)}
			</section>
		</main>
	);
}

export function shouldShowMacOSKeychainNotice(
	platform: DesktopPlatform | undefined,
	nativeNavigator: Pick<Navigator, "platform" | "userAgent">
) {
	const userAgentData = nativeNavigator as Pick<Navigator, "platform"> & {
		userAgentData?: { platform?: string };
	};
	const operatingSystem =
		userAgentData.userAgentData?.platform ||
		nativeNavigator.platform ||
		nativeNavigator.userAgent;
	return Boolean(
		(!platform || platform.installedTarget) &&
			MAC_OS_PLATFORM_PATTERN.test(operatingSystem)
	);
}

async function revalidateDesktopEntry(input: {
	active: () => boolean;
	bridge: NonNullable<ReturnType<typeof getDesktopPlatform>>;
	previousAccountId: string | null | undefined;
	queryClient: QueryClient;
	sessionChanged: boolean;
}): Promise<{ accountId: string | null; session: DesktopSession } | null> {
	if (!input.active()) {
		return null;
	}
	if (input.sessionChanged) {
		await resetAccountScopedQueriesAfterAuthChange(input.queryClient, {
			preserveComposerDrafts: true,
		});
	}
	if (!input.active()) {
		return null;
	}
	const session = await readDesktopSession({
		bridge: input.bridge,
		queryClient: input.queryClient,
		revalidate: true,
	});
	if (!input.active()) {
		return null;
	}
	const accountId = session.user?.id ?? null;
	await clearPrivateAccountStateAfterSessionRead(input.queryClient, {
		previousAccountId: input.previousAccountId,
		nextAccountId: accountId,
	});
	if (!input.active()) {
		return null;
	}
	return { accountId, session };
}

function desktopEntryCopy(
	available: boolean,
	pending: "browser" | null,
	browserOpened: boolean,
	signedOut: boolean
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
	if (!signedOut) {
		return {
			title: "Open your workspace",
			description: "Try loading your workspace again.",
			action: "Retry",
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
	session: DesktopSession,
	returnPath?: string
) {
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
			"Could not open your workspace. Check your connection and try again."
		);
	}
	return path;
}
