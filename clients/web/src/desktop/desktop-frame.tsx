import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { getDesktopPlatform } from "./platform";
import "./desktop.css";

export function DesktopFrame({ children }: { children: ReactNode }) {
	const bridge = getDesktopPlatform();
	const router = useRouter();
	const queryClient = useQueryClient();
	useEffect(() => {
		if (!bridge) {
			return;
		}
		const refresh = () => {
			bridge
				.session()
				.then(async (session) => {
					if (
						!session.user &&
						router.state.location.pathname !== "/desktop-shell"
					) {
						await resetAccountScopedQueriesAfterAuthChange(queryClient);
						await router.navigate({ to: "/desktop-shell", replace: true });
					}
				})
				.catch((error: unknown) => {
					console.error("Could not refresh Desktop sign-in.", error);
				});
		};
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [bridge, router, queryClient]);
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
