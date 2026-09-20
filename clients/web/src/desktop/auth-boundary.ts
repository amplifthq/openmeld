import type { DesktopSession } from "@openmeld/schemas";
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
	let session: DesktopSession;
	try {
		session = await bridge.session();
	} catch {
		// Unknown is not signed out: retry through the loader-free entry without
		// clearing this account's data or initiating browser authentication.
		throw redirect({
			to: "/desktop-shell",
			search: { redirect: desktopReturnPath(href) },
			replace: true,
		});
	}
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
		throw new Error("To sign out, choose Sign out in the account menu.");
	}
	if (pathname === "/" || pathname === "/login") {
		throw redirect({ to: "/desktop-shell", replace: true });
	}
}
