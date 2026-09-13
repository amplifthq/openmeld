import type { DesktopSession } from "@openmeld/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { getDesktopPlatform } from "./platform";
import "./desktop.css";

export function DesktopFrame({ children }: { children: ReactNode }) {
	const bridge = getDesktopPlatform();
	const router = useRouter();
	const queryClient = useQueryClient();
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
			sessionChanged: boolean
		) {
			if (!(session && active())) {
				return;
			}
			if (session.user) {
				if (sessionChanged) {
					await router.invalidate();
				}
				return;
			}
			if (!sessionChanged) {
				await resetAccountScopedQueriesAfterAuthChange(queryClient);
			}
			if (active()) {
				await router.navigate({ to: "/desktop-shell", replace: true });
			}
		}
		const refresh = (sessionChanged = false) => {
			if (pathname === "/desktop-shell") {
				return;
			}
			if (sessionChanged) {
				revision++;
				prepared = resetAccountScopedQueriesAfterAuthChange(queryClient);
			}
			const current = revision;
			const active = () => !disposed && current === revision;
			prepared
				.then(() => (active() ? bridge.session() : null))
				.then((session) => applySession(session, active, sessionChanged))
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
	}, [bridge, router, queryClient, pathname]);
	if (!bridge) {
		return children;
	}
	return (
		<div className="desktop-window">
			<div aria-hidden="true" className="desktop-titlebar" />
			<div className="desktop-content">{children}</div>
		</div>
	);
}
