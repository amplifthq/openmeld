import type { DesktopSession } from "@openmeld/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useHydrated, useLocation, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	clearPrivateAccountStateAfterSessionRead,
	readKnownAccountIdBeforeSessionRevalidation,
	resetAccountScopedQueriesAfterAuthChange,
} from "#/query/auth-boundary";
import { isDesktopAppHref } from "../../../desktop/src/shared/navigation";
import {
	forgetDesktopSession,
	readDesktopSession,
	registerDesktopEntryRedirect,
} from "./auth-boundary";
import { desktopUsesMacControls } from "./chrome-platform";
import { createDesktopNavigation } from "./navigation";
import { getDesktopPlatform } from "./platform";
import { DesktopTitlebarContext } from "./titlebar-context";
import { DesktopUpdater } from "./updater";
import "./desktop.css";

export function DesktopFrame({ children }: { children: ReactNode }) {
	const hydrated = useHydrated();
	const bridge = getDesktopPlatform();
	const router = useRouter();
	const navigation = useMemo(
		() => (bridge ? createDesktopNavigation(router.history) : null),
		[bridge, router]
	);
	const [target, setTarget] = useState<HTMLDivElement | null>(null);
	const titlebar = useMemo(
		() => (navigation ? { target, navigation } : null),
		[target, navigation]
	);
	useEffect(() => navigation?.connect(), [navigation]);
	useEffect(() => {
		if (!bridge) {
			return;
		}
		return registerDesktopEntryRedirect((search) =>
			router.navigate({ to: "/desktop-shell", search, replace: true })
		);
	}, [bridge, router]);
	useEffect(() => {
		if (!bridge) {
			return;
		}
		return bridge.onNavigationRequest((href) => {
			if (document.body.inert || !isDesktopAppHref(href)) {
				return;
			}
			router.history.push(href);
		});
	}, [bridge, router]);
	const queryClient = useQueryClient();
	const confirmedAccountIdRef = useRef<string | null | undefined>(undefined);
	const pathname = useLocation({ select: (location) => location.pathname });
	useEffect(() => {
		if (!bridge) {
			return;
		}
		if (pathname === "/desktop-shell") {
			// DesktopEntry owns identity revalidation on the shell. Retire the
			// previous workspace baseline so its completed handoff is not replayed.
			confirmedAccountIdRef.current = undefined;
		}
		const desktopBridge = bridge;
		let disposed = false;
		let revision = 0;
		let prepared = Promise.resolve();
		let sessionInvalidationRevision = 0;
		let handledSessionInvalidationRevision = 0;
		let pendingInvalidationPreviousAccountId: string | null | undefined;
		async function applySession(
			session: DesktopSession,
			active: () => boolean,
			sessionChanged: boolean,
			previousAccountId: string | null | undefined
		) {
			if (!active()) {
				return;
			}
			const nextAccountId = session.user?.id ?? null;
			await clearPrivateAccountStateAfterSessionRead(queryClient, {
				previousAccountId,
				nextAccountId,
			});
			if (!active()) {
				return;
			}
			confirmedAccountIdRef.current = nextAccountId;
			if (session.user) {
				navigation?.identify(session.user.id);
				if (sessionChanged) {
					await router.invalidate();
				}
				return;
			}
			if (active()) {
				await router.navigate({ to: "/desktop-shell", replace: true });
			}
		}
		async function revalidateSession(
			active: () => boolean,
			refreshPreviousAccountId: string | null | undefined,
			force: boolean
		) {
			if (!active()) {
				return;
			}
			const invalidationRevision = sessionInvalidationRevision;
			const hasPendingSessionInvalidation =
				invalidationRevision > handledSessionInvalidationRevision;
			const previousAccountId = hasPendingSessionInvalidation
				? pendingInvalidationPreviousAccountId
				: refreshPreviousAccountId;
			if (hasPendingSessionInvalidation) {
				await resetAccountScopedQueriesAfterAuthChange(queryClient, {
					preserveComposerDrafts: true,
				});
			}
			if (!active()) {
				return;
			}
			await applySession(
				await readDesktopSession({
					bridge: desktopBridge,
					queryClient,
					revalidate: force || hasPendingSessionInvalidation,
				}),
				active,
				hasPendingSessionInvalidation,
				previousAccountId
			);
			if (!(active() && hasPendingSessionInvalidation)) {
				return;
			}
			handledSessionInvalidationRevision = invalidationRevision;
			if (handledSessionInvalidationRevision === sessionInvalidationRevision) {
				pendingInvalidationPreviousAccountId = undefined;
			}
		}
		const refresh = (sessionChanged = false, force = false) => {
			if (sessionChanged) {
				forgetDesktopSession(queryClient);
				if (
					sessionInvalidationRevision === handledSessionInvalidationRevision
				) {
					pendingInvalidationPreviousAccountId =
						confirmedAccountIdRef.current === undefined
							? readKnownAccountIdBeforeSessionRevalidation(queryClient)
							: confirmedAccountIdRef.current;
				}
				sessionInvalidationRevision += 1;
				navigation?.reset();
			}
			if (pathname === "/desktop-shell") {
				return;
			}
			const refreshPreviousAccountId =
				confirmedAccountIdRef.current === undefined
					? readKnownAccountIdBeforeSessionRevalidation(queryClient)
					: confirmedAccountIdRef.current;
			const current = ++revision;
			const active = () => !disposed && current === revision;
			prepared = prepared
				.then(() => revalidateSession(active, refreshPreviousAccountId, force))
				.catch((error: unknown) => {
					if (active()) {
						console.error("Could not refresh Desktop sign-in.", error);
					}
				});
		};
		const onFocus = () => refresh(false, true);
		const unsubscribe = desktopBridge.onSessionChanged(() => refresh(true));
		window.addEventListener("focus", onFocus);
		return () => {
			disposed = true;
			unsubscribe();
			window.removeEventListener("focus", onFocus);
		};
	}, [bridge, router, queryClient, pathname, navigation]);
	// The prerendered shell has no native bridge. Match that document during
	// hydration so React preserves the shared Appearance bootstrap attributes.
	if (!(bridge && hydrated)) {
		return children;
	}
	return (
		<DesktopTitlebarContext.Provider value={titlebar}>
			<DesktopUpdater />
			<div
				className="desktop-window"
				data-window-controls={desktopUsesMacControls() ? "mac" : "overlay"}
			>
				<div className="desktop-titlebar" ref={setTarget} />
				<div className="desktop-content">{children}</div>
			</div>
		</DesktopTitlebarContext.Provider>
	);
}
