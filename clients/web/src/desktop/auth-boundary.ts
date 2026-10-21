import type { DesktopSession } from "@openmeld/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { getDesktopPlatform } from "./platform";

const DESKTOP_SESSION_NAVIGATION_STALE_MS = 30_000;
const desktopSessionQueryKey = ["desktop", "native-session"] as const;

export function forgetDesktopSession(queryClient: QueryClient): void {
	queryClient.removeQueries({ exact: true, queryKey: desktopSessionQueryKey });
}

export function readDesktopSession(input: {
	bridge: NonNullable<ReturnType<typeof getDesktopPlatform>>;
	queryClient: QueryClient;
	revalidate?: boolean;
}): Promise<DesktopSession> {
	return input.queryClient.fetchQuery({
		// Keep the last confirmed session so a later navigation can revalidate it
		// in the background instead of blocking on the native bridge. Session
		// changes remove it through forgetDesktopSession.
		gcTime: Number.POSITIVE_INFINITY,
		queryFn: () => input.bridge.session(),
		queryKey: desktopSessionQueryKey,
		retry: false,
		staleTime: input.revalidate ? 0 : DESKTOP_SESSION_NAVIGATION_STALE_MS,
	});
}

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

export type DesktopEntryRedirect = (search: {
	redirect: string | undefined;
}) => unknown;

let desktopEntryRedirect: DesktopEntryRedirect | null = null;

/**
 * The mounted Desktop frame owns router navigation for a background
 * revalidation that finds the session gone. Until it registers, a stale
 * session blocks navigation on the native answer as before.
 */
export function registerDesktopEntryRedirect(
	redirectToEntry: DesktopEntryRedirect
): () => void {
	desktopEntryRedirect = redirectToEntry;
	return () => {
		if (desktopEntryRedirect === redirectToEntry) {
			desktopEntryRedirect = null;
		}
	};
}

function readCachedSignedInDesktopSession(queryClient: QueryClient): {
	session: DesktopSession & { user: NonNullable<DesktopSession["user"]> };
	stale: boolean;
} | null {
	const state = queryClient.getQueryState<DesktopSession>(
		desktopSessionQueryKey
	);
	const user = state?.data?.user;
	if (!(state?.data && user) || state.isInvalidated) {
		return null;
	}
	return {
		session: { ...state.data, user },
		stale:
			Date.now() - state.dataUpdatedAt >= DESKTOP_SESSION_NAVIGATION_STALE_MS,
	};
}

function revalidateDesktopSessionInBackground(input: {
	bridge: NonNullable<ReturnType<typeof getDesktopPlatform>>;
	queryClient: QueryClient;
	confirmedAccountId: string;
	href: string;
	redirectToEntry: DesktopEntryRedirect;
}): void {
	readDesktopSession({
		bridge: input.bridge,
		queryClient: input.queryClient,
		revalidate: true,
	})
		.then(async (session) => {
			if (session.user?.id === input.confirmedAccountId) {
				return;
			}
			await resetAccountScopedQueriesAfterAuthChange(input.queryClient);
			await input.redirectToEntry({ redirect: desktopReturnPath(input.href) });
		})
		.catch((error: unknown) =>
			console.warn("[openmeld.desktop.session_revalidation_failed]", {
				error: error instanceof Error ? error.message : String(error),
			})
		);
}

export async function beforeDesktopLoad(
	pathname: string,
	href: string,
	queryClient?: QueryClient
) {
	const redirectToEntry = desktopEntryRedirect;
	const bridge = getDesktopPlatform();
	if (!bridge || pathname === "/desktop-shell") {
		return;
	}
	// Stale-while-revalidate: a signed-in session older than the navigation
	// stale window does not block the next navigation. It is revalidated in the
	// background, and only a signed-out or different-account answer clears
	// account data and returns to the Desktop entry. Without a confirmed
	// signed-in session the navigation still waits for the native answer.
	const cached =
		queryClient && redirectToEntry
			? readCachedSignedInDesktopSession(queryClient)
			: null;
	if (cached?.stale && queryClient && redirectToEntry) {
		revalidateDesktopSessionInBackground({
			bridge,
			queryClient,
			confirmedAccountId: cached.session.user.id,
			href,
			redirectToEntry,
		});
	}
	let session: DesktopSession;
	try {
		if (cached) {
			session = cached.session;
		} else if (queryClient) {
			session = await readDesktopSession({ bridge, queryClient });
		} else {
			session = await bridge.session();
		}
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
