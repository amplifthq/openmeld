import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { getDesktopPlatform } from "./platform";

// Runs in the root beforeLoad, before shared child loaders. Cloud endpoints
// still authorize every request; this guard only owns the client's entry path.
export function desktopReturnPath(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		!value.startsWith("/o/") ||
		value.includes("\\")
	) {
		return undefined;
	}
	const url = new URL(value, "https://desktop.invalid");
	return url.origin === "https://desktop.invalid" &&
		url.pathname.startsWith("/o/")
		? `${url.pathname}${url.search}${url.hash}`
		: undefined;
}

export async function beforeDesktopLoad(
	pathname: string,
	href: string,
	queryClient?: QueryClient
) {
	const bridge = getDesktopPlatform();
	if (!bridge || pathname === "/desktop-shell") {
		return;
	}
	const session = await bridge.session();
	if (!session.user) {
		if (queryClient) {
			await resetAccountScopedQueriesAfterAuthChange(queryClient);
		}
		throw redirect({
			to: "/desktop-shell",
			search: { redirect: desktopReturnPath(href) },
			replace: true,
		});
	}
	if (pathname === "/logout") {
		throw new Error(
			"To sign out, choose Sign out of Desktop in the account menu."
		);
	}
	if (pathname === "/" || pathname === "/login") {
		throw redirect({ to: "/desktop-shell", replace: true });
	}
}
