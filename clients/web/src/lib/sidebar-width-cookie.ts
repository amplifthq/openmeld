import { createServerFn } from "@tanstack/react-start";

/**
 * Injected web persistence for the resizable Space sidebar (PROVE-ABSTRACTION
 * seam, see developing/clients/shell-and-settings.md §6). The shared
 * Sidebar primitive in `packages/ui` is PURELY presentational — it
 * never touches storage. This module is the Web filling: it persists the
 * controlled `width` + `tier` state (collapsed / compact / full) in first-party
 * cookies so the value survives reload and is readable on the SSR pass (no
 * first-paint flash). The outer rail remains global. Each inner-sidebar route
 * family owns an independent preference while the original global inner value
 * remains a read-only migration fallback. The Desktop track injects its own
 * electron-store equivalent against the same `onWidthChange` / tier-change
 * seam.
 *
 * The pure parse/serialize/read helpers are isomorphic and unit-testable; the
 * client write goes through `document.cookie`; the SSR read goes through a
 * `createServerFn` that reads the request cookie header (mirrors the
 * protected-space-access cookie pattern in this repo).
 */

const SIDEBAR_STATE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const SIDEBAR_STATE_COOKIE_NAMES = {
	// Legacy read-only fallback for inner sidebars created before route-family preferences.
	inner: "openmeld_sidebar_inner",
	outer: "openmeld_sidebar_outer",
} as const;
const INNER_SIDEBAR_STATE_COOKIE_NAMES = {
	"agent-activity": "openmeld_sidebar_inner_agent_activity",
	"center-agent": "openmeld_sidebar_inner_center_agent",
	"direct-messages": "openmeld_sidebar_inner_direct_messages",
	settings: "openmeld_sidebar_inner_settings",
	spaces: "openmeld_sidebar_inner_spaces",
} as const;

export type InnerSidebarPreferenceKey =
	keyof typeof INNER_SIDEBAR_STATE_COOKIE_NAMES;

/** Defaults mirror the compact unified shell widths and their min/max bands so
 * the cookie can never drive an out-of-range width into the engine. */
export const SIDEBAR_DEFAULT_WIDTH = "15rem";
export const SIDEBAR_MIN_WIDTH = "8rem";
export const SIDEBAR_MAX_WIDTH = "18rem";
export const OUTER_SIDEBAR_DEFAULT_WIDTH = "13.75rem";
export const OUTER_SIDEBAR_MIN_WIDTH = "9.3rem";
export const OUTER_SIDEBAR_MAX_WIDTH = "18rem";
// Fixed compact-tier width (standalone from OUTER_SIDEBAR_MIN_WIDTH/MAX): measured in Geist against every fixed rail label, floor set by "Center Agent" (~67px) plus padding.
export const OUTER_SIDEBAR_COMPACT_WIDTH = "6rem";

const PX_PER_REM = 16;
const TRAILING_ZERO_REM_PATTERN = /\.?0+$/;

export type SidebarScope = keyof typeof SIDEBAR_STATE_COOKIE_NAMES;

export type SidebarTier = "full" | "compact" | "collapsed";

export type SidebarPersistedState = {
	width: string;
	tier: SidebarTier;
};

export const SIDEBAR_DEFAULT_STATE: SidebarPersistedState = {
	width: SIDEBAR_DEFAULT_WIDTH,
	tier: "full",
};

export const OUTER_SIDEBAR_DEFAULT_STATE: SidebarPersistedState = {
	width: OUTER_SIDEBAR_DEFAULT_WIDTH,
	tier: "full",
};

export type AppSidebarPersistedStates = {
	inner: SidebarPersistedState;
	outer: SidebarPersistedState;
};

type AppSidebarPersistedStateCatalog = {
	inner: Record<InnerSidebarPreferenceKey, SidebarPersistedState>;
	legacyInner: SidebarPersistedState;
	outer: SidebarPersistedState;
};

export const APP_SIDEBAR_DEFAULT_STATES: AppSidebarPersistedStates = {
	inner: SIDEBAR_DEFAULT_STATE,
	outer: OUTER_SIDEBAR_DEFAULT_STATE,
};

const clientSidebarStateMemory: Partial<AppSidebarPersistedStates> = {};
const clientInnerSidebarStateMemory: Partial<
	Record<InnerSidebarPreferenceKey, SidebarPersistedState>
> = {};

function resolveSidebarMetrics(scope: SidebarScope): {
	defaultWidth: string;
	maxWidth: string;
	minWidth: string;
} {
	if (scope === "outer") {
		return {
			defaultWidth: OUTER_SIDEBAR_DEFAULT_WIDTH,
			maxWidth: OUTER_SIDEBAR_MAX_WIDTH,
			minWidth: OUTER_SIDEBAR_MIN_WIDTH,
		};
	}

	return {
		defaultWidth: SIDEBAR_DEFAULT_WIDTH,
		maxWidth: SIDEBAR_MAX_WIDTH,
		minWidth: SIDEBAR_MIN_WIDTH,
	};
}

function toPx(width: string): number {
	const value = Number.parseFloat(width);
	if (Number.isNaN(value)) {
		return Number.NaN;
	}
	return width.trim().endsWith("rem") ? value * PX_PER_REM : value;
}

/**
 * Clamp a candidate width string to the [min, max] band, preserving the rem/px
 * unit of the candidate. A non-parseable candidate falls back to the default.
 */
export function clampSidebarWidth(
	candidate: string,
	scope: SidebarScope = "inner"
): string {
	const metrics = resolveSidebarMetrics(scope);
	const candidatePx = toPx(candidate);
	if (Number.isNaN(candidatePx)) {
		return metrics.defaultWidth;
	}
	const minPx = toPx(metrics.minWidth);
	const maxPx = toPx(metrics.maxWidth);
	const clampedPx = Math.max(minPx, Math.min(maxPx, candidatePx));
	if (clampedPx === candidatePx) {
		return candidate;
	}
	return candidate.trim().endsWith("rem")
		? `${(clampedPx / PX_PER_REM).toFixed(2).replace(TRAILING_ZERO_REM_PATTERN, "")}rem`
		: `${Math.round(clampedPx)}px`;
}

// Token alphabet for the persisted tier. "0"/"1" preserve the exact meaning
// they had when this field was a plain `collapsed` boolean, so a cookie
// written before the compact tier existed ("<width>|0" / "<width>|1") keeps
// parsing correctly under this parser with no version bump and no migration
// step. "2" (compact) is new vocabulary only ever written after this change.
const SIDEBAR_TIER_TOKEN: Record<SidebarTier, string> = {
	collapsed: "1",
	compact: "2",
	full: "0",
};
const SIDEBAR_TOKEN_TIER: Record<string, SidebarTier> = {
	"0": "full",
	"1": "collapsed",
	"2": "compact",
};

/**
 * Parse the persisted `width|tier` cookie value into clamped state. Any
 * malformed/absent value yields the default state — the sidebar must always
 * render, never throw on a stale cookie.
 */
export function parseSidebarStateCookieValue(
	raw: string | null | undefined,
	scope: SidebarScope = "inner"
): SidebarPersistedState {
	const metrics = resolveSidebarMetrics(scope);
	if (!raw) {
		return APP_SIDEBAR_DEFAULT_STATES[scope];
	}
	const [widthPart, tierPart] = raw.split("|");
	const width = widthPart?.trim()
		? clampSidebarWidth(widthPart.trim(), scope)
		: metrics.defaultWidth;
	return {
		tier: SIDEBAR_TOKEN_TIER[tierPart?.trim() ?? ""] ?? "full",
		width,
	};
}

/** Serialize state into the compact `width|tier` cookie value. */
export function serializeSidebarStateCookieValue(
	state: SidebarPersistedState,
	scope: SidebarScope = "inner"
): string {
	return `${clampSidebarWidth(state.width, scope)}|${SIDEBAR_TIER_TOKEN[state.tier]}`;
}

/** Read + parse the sidebar state from a raw `Cookie:` header (SSR-safe,
 * isomorphic — pure string work, no `document`). */
export function readSidebarStateFromCookieHeader(
	cookieHeader: string | null | undefined,
	scope: SidebarScope = "inner"
): SidebarPersistedState {
	return parseSidebarStateCookieValue(
		readCookieValueFromHeader(cookieHeader, SIDEBAR_STATE_COOKIE_NAMES[scope]),
		scope
	);
}

export function readAppSidebarStatesFromCookieHeader(
	cookieHeader: string | null | undefined,
	innerPreferenceKey?: InnerSidebarPreferenceKey
): AppSidebarPersistedStates {
	return {
		inner: innerPreferenceKey
			? readInnerSidebarStateFromCookieHeader(cookieHeader, innerPreferenceKey)
			: readSidebarStateFromCookieHeader(cookieHeader, "inner"),
		outer: readSidebarStateFromCookieHeader(cookieHeader, "outer"),
	};
}

function readInnerSidebarStateFromCookieHeader(
	cookieHeader: string | null | undefined,
	preferenceKey: InnerSidebarPreferenceKey
): SidebarPersistedState {
	const rawValue = readCookieValueFromHeader(
		cookieHeader,
		INNER_SIDEBAR_STATE_COOKIE_NAMES[preferenceKey]
	);
	return rawValue === null
		? readSidebarStateFromCookieHeader(cookieHeader, "inner")
		: parseSidebarStateCookieValue(rawValue, "inner");
}

export function readAppSidebarStatesFromClientCookie(
	innerPreferenceKey?: InnerSidebarPreferenceKey
): AppSidebarPersistedStates {
	if (typeof document === "undefined") {
		return APP_SIDEBAR_DEFAULT_STATES;
	}
	return readAppSidebarStatesFromCookieHeader(
		document.cookie,
		innerPreferenceKey
	);
}

function readAppSidebarStateCatalogFromCookieHeader(
	cookieHeader: string | null | undefined
): AppSidebarPersistedStateCatalog {
	return {
		inner: {
			"agent-activity": readInnerSidebarStateFromCookieHeader(
				cookieHeader,
				"agent-activity"
			),
			"center-agent": readInnerSidebarStateFromCookieHeader(
				cookieHeader,
				"center-agent"
			),
			"direct-messages": readInnerSidebarStateFromCookieHeader(
				cookieHeader,
				"direct-messages"
			),
			settings: readInnerSidebarStateFromCookieHeader(cookieHeader, "settings"),
			spaces: readInnerSidebarStateFromCookieHeader(cookieHeader, "spaces"),
		},
		legacyInner: readSidebarStateFromCookieHeader(cookieHeader, "inner"),
		outer: readSidebarStateFromCookieHeader(cookieHeader, "outer"),
	};
}

function readSidebarStateFromClientCookie(
	scope: SidebarScope
): SidebarPersistedState | null {
	if (typeof document === "undefined") {
		return null;
	}
	const rawValue = readCookieValueFromHeader(
		document.cookie,
		SIDEBAR_STATE_COOKIE_NAMES[scope]
	);
	return rawValue === null
		? null
		: parseSidebarStateCookieValue(rawValue, scope);
}

function readInnerSidebarStateFromClientCookie(
	preferenceKey: InnerSidebarPreferenceKey
): SidebarPersistedState | null {
	if (typeof document === "undefined") {
		return null;
	}
	const scopedValue = readCookieValueFromHeader(
		document.cookie,
		INNER_SIDEBAR_STATE_COOKIE_NAMES[preferenceKey]
	);
	if (scopedValue !== null) {
		return parseSidebarStateCookieValue(scopedValue, "inner");
	}
	return readSidebarStateFromClientCookie("inner");
}

function readCookieValueFromHeader(
	cookieHeader: string | null | undefined,
	cookieName: string
): string | null {
	if (!cookieHeader) {
		return null;
	}
	for (const part of cookieHeader.split(";")) {
		const separatorIndex = part.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}
		const name = part.slice(0, separatorIndex).trim();
		if (name !== cookieName) {
			continue;
		}
		return decodeURIComponent(part.slice(separatorIndex + 1).trim());
	}
	return null;
}

/**
 * Persist sidebar state from the client (best-effort). Written on every resize
 * / collapse through the Sidebar controlled seam. Not HttpOnly — it
 * is a non-sensitive layout preference the client both reads and writes.
 */
export function writeOuterSidebarStateCookie(
	state: SidebarPersistedState
): void {
	if (typeof document === "undefined") {
		return;
	}
	rememberClientSidebarState("outer", state);
	writeClientSidebarStateCookie(
		SIDEBAR_STATE_COOKIE_NAMES.outer,
		state,
		"outer"
	);
}

export function writeInnerSidebarStateCookie(
	preferenceKey: InnerSidebarPreferenceKey,
	state: SidebarPersistedState
): void {
	if (typeof document === "undefined") {
		return;
	}
	clientInnerSidebarStateMemory[preferenceKey] = {
		tier: state.tier,
		width: clampSidebarWidth(state.width, "inner"),
	};
	writeClientSidebarStateCookie(
		INNER_SIDEBAR_STATE_COOKIE_NAMES[preferenceKey],
		state,
		"inner"
	);
}

function writeClientSidebarStateCookie(
	cookieName: string,
	state: SidebarPersistedState,
	scope: SidebarScope
): void {
	const value = encodeURIComponent(
		serializeSidebarStateCookieValue(state, scope)
	);
	const secure = window.location.protocol === "https:" ? "; Secure" : "";
	// This layout preference must be CLIENT-writable and SSR-readable, so a
	// first-party (non-HttpOnly) cookie is the correct store. The async Cookie
	// Store API is not universally available and would force this synchronous
	// resize/collapse write to be fire-and-forget. The value is non-sensitive.
	// biome-ignore lint/suspicious/noDocumentCookie: client-writable, SSR-readable layout preference; see comment above.
	document.cookie = `${cookieName}=${value}; Path=/; Max-Age=${SIDEBAR_STATE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function rememberClientSidebarState(
	scope: SidebarScope,
	state: SidebarPersistedState
): void {
	if (typeof window === "undefined") {
		return;
	}
	clientSidebarStateMemory[scope] = {
		tier: state.tier,
		width: clampSidebarWidth(state.width, scope),
	};
}

export function resolveClientSidebarInitialState(
	scope: SidebarScope,
	initialState: SidebarPersistedState | undefined
): SidebarPersistedState {
	if (typeof window === "undefined") {
		return initialState ?? APP_SIDEBAR_DEFAULT_STATES[scope];
	}

	return (
		clientSidebarStateMemory[scope] ??
		readSidebarStateFromClientCookie(scope) ??
		initialState ??
		APP_SIDEBAR_DEFAULT_STATES[scope]
	);
}

export function resolveClientInnerSidebarInitialState(
	preferenceKey: InnerSidebarPreferenceKey,
	initialState: SidebarPersistedState | undefined
): SidebarPersistedState {
	if (typeof window === "undefined") {
		return initialState ?? SIDEBAR_DEFAULT_STATE;
	}

	return (
		clientInnerSidebarStateMemory[preferenceKey] ??
		readInnerSidebarStateFromClientCookie(preferenceKey) ??
		initialState ??
		SIDEBAR_DEFAULT_STATE
	);
}

/**
 * SSR read of the persisted sidebar state from the incoming request cookie. The
 * route loader awaits this so the shell mounts with the persisted width on the
 * server-rendered HTML — no first-paint flash from a client-only default.
 */
export const getSidebarState = createServerFn({ method: "GET" }).handler(
	async (): Promise<SidebarPersistedState> => {
		const { getRequestHeaders } = await import("@tanstack/react-start/server");
		const cookieHeader = getRequestHeaders().get("cookie");
		return readSidebarStateFromCookieHeader(cookieHeader);
	}
);

export const getAppSidebarStates = createServerFn({ method: "GET" }).handler(
	async (): Promise<AppSidebarPersistedStateCatalog> => {
		const { getRequestHeaders } = await import("@tanstack/react-start/server");
		const cookieHeader = getRequestHeaders().get("cookie");
		return readAppSidebarStateCatalogFromCookieHeader(cookieHeader);
	}
);

export async function getAppSidebarStatesForRoute(
	innerPreferenceKey?: InnerSidebarPreferenceKey
): Promise<AppSidebarPersistedStates> {
	if (typeof document !== "undefined") {
		return readAppSidebarStatesFromClientCookie(innerPreferenceKey);
	}
	const catalog = await getAppSidebarStates();
	return {
		inner: innerPreferenceKey
			? catalog.inner[innerPreferenceKey]
			: catalog.legacyInner,
		outer: catalog.outer,
	};
}
