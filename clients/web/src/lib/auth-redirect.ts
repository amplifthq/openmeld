import {
	DEFAULT_AUTHENTICATED_ENTRY_PATH,
	sanitizeAuthenticatedEntryTarget,
} from "./auth-entry-policy";
import {
	ADD_ACCOUNT_AUTH_INTENT,
	hasAddAccountAuthIntent,
} from "./auth-intent";

const DEFAULT_CALLBACK_PATH = "/callback";
type RedirectSearchInput =
	| Record<string, unknown>
	| URLSearchParams
	| string
	| null
	| undefined;

function normalizePath(path: string): string {
	if (!path.startsWith("/")) {
		return `/${path}`;
	}
	return path;
}

function resolveBrowserTrustedOrigins(): readonly string[] {
	if (typeof window === "undefined") {
		return [];
	}

	return [window.location.origin];
}

function readRedirectParam(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	return new URLSearchParams(window.location.search).get("redirect");
}

function readRedirectParamFromSearch(
	search: RedirectSearchInput
): string | null {
	if (!search) {
		return null;
	}

	if (typeof search === "string" || search instanceof URLSearchParams) {
		return new URLSearchParams(search).get("redirect");
	}

	const value = search.redirect;
	if (Array.isArray(value)) {
		return typeof value[0] === "string" ? value[0] : null;
	}

	return typeof value === "string" ? value : null;
}

function normalizeOptionalSearchValue(
	value: string | null | undefined
): string {
	if (typeof value !== "string") {
		return "";
	}

	return value.trim();
}

export function sanitizeRedirectTarget(
	input: string | null | undefined,
	fallback: string = DEFAULT_AUTHENTICATED_ENTRY_PATH
): string {
	return sanitizeAuthenticatedEntryTarget(input, {
		fallbackPath: fallback,
		trustedOrigins: resolveBrowserTrustedOrigins(),
	});
}

export function getCurrentRedirectTarget(): string | null {
	const rawRedirect = readRedirectParam();
	if (!rawRedirect) {
		return null;
	}

	return sanitizeRedirectTarget(rawRedirect);
}

export function withRedirectQuery(
	path: string,
	extraSearch?: Record<string, string | null | undefined>
): string {
	if (typeof window === "undefined") {
		return normalizePath(path);
	}

	return withRedirectQueryFromSearch(path, window.location.search, extraSearch);
}

export function withRedirectQueryFromSearch(
	path: string,
	locationSearch: RedirectSearchInput,
	extraSearch?: Record<string, string | null | undefined>
): string {
	const normalizedPath = normalizePath(path);

	const url = new URL(normalizedPath, "http://localhost");
	const rawRedirectTarget = readRedirectParamFromSearch(locationSearch);
	const redirectTarget = rawRedirectTarget
		? sanitizeRedirectTarget(rawRedirectTarget)
		: null;
	if (redirectTarget) {
		url.searchParams.set("redirect", redirectTarget);
	}
	for (const [key, value] of Object.entries(extraSearch ?? {})) {
		const normalizedValue = normalizeOptionalSearchValue(value);
		if (normalizedValue.length === 0) {
			continue;
		}

		url.searchParams.set(key, normalizedValue);
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

export function resolvePostAuthRedirect(
	defaultPath: string = DEFAULT_AUTHENTICATED_ENTRY_PATH
): string {
	const redirectTarget = getCurrentRedirectTarget();
	if (!redirectTarget) {
		return sanitizeRedirectTarget(null, defaultPath);
	}
	return sanitizeRedirectTarget(redirectTarget, defaultPath);
}

export function getFrontendCallbackURL(path = DEFAULT_CALLBACK_PATH): string {
	const sanitizedPath = sanitizeAuthenticatedEntryTarget(path, {
		fallbackPath: DEFAULT_CALLBACK_PATH,
		trustedOrigins: resolveBrowserTrustedOrigins(),
	});
	if (typeof window === "undefined") {
		return sanitizedPath;
	}
	return `${window.location.origin}${sanitizedPath}`;
}

export function getFrontendCallbackURLWithRedirect(
	path = DEFAULT_CALLBACK_PATH,
	redirectTarget = resolvePostAuthRedirect()
): string {
	const callbackURL = new URL(
		getFrontendCallbackURL(path),
		typeof window === "undefined" ? "http://localhost" : window.location.origin
	);
	callbackURL.searchParams.set(
		"redirect",
		sanitizeRedirectTarget(redirectTarget, redirectTarget)
	);
	if (
		typeof window !== "undefined" &&
		hasAddAccountAuthIntent(window.location.href)
	) {
		callbackURL.searchParams.set("intent", ADD_ACCOUNT_AUTH_INTENT);
	}
	return callbackURL.toString();
}
