import type { DesktopSession } from "@openmeld/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useHydrated, useLocation, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	clearPrivateAccountStateAfterSessionRead,
	readKnownAccountIdBeforeSessionRevalidation,
	resetAccountScopedQueriesAfterAuthChange,
} from "#/query/auth-boundary";
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
	const queryClient = useQueryClient();
	const confirmedAccountIdRef = useRef<string | null | undefined>(undefined);
	const pathname = useLocation({ select: (location) => location.pathname });
	useEffect(() => {
		if (!bridge) {
			return;
		}
		let disposed = false;
		let revision = 0;
		let prepared = Promise.resolve();
		async function applySession(
			session: DesktopSession | null,
			active: () => boolean,
			sessionChanged: boolean,
			previousAccountId: string | null | undefined
		) {
			if (!(session && active())) {
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
		const refresh = (sessionChanged = false) => {
			if (sessionChanged) {
				navigation?.reset();
			}
			if (pathname === "/desktop-shell") {
				return;
			}
			const previousAccountId =
				confirmedAccountIdRef.current === undefined
					? readKnownAccountIdBeforeSessionRevalidation(queryClient)
					: confirmedAccountIdRef.current;
			const current = ++revision;
			const active = () => !disposed && current === revision;
			prepared = prepared
				.then(async () => {
					if (!active()) {
						return;
					}
					if (sessionChanged) {
						await resetAccountScopedQueriesAfterAuthChange(queryClient, {
							preserveComposerDrafts: true,
						});
					}
					if (!active()) {
						return;
					}
					await applySession(
						await bridge.session(),
						active,
						sessionChanged,
						previousAccountId
					);
				})
				.catch((error: unknown) => {
					if (active()) {
						console.error("Could not refresh Desktop sign-in.", error);
					}
				});
		};
		const onFocus = () => refresh();
		const unsubscribe = bridge.onSessionChanged(() => refresh(true));
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
			<div className="desktop-window">
				<div className="desktop-titlebar" ref={setTarget} />
				<div className="desktop-content">{children}</div>
			</div>
		</DesktopTitlebarContext.Provider>
	);
}
