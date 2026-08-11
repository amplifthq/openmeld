// Authenticated entry now resolves through an auth-domain route first. The
// logged-in guard then opens the active organization under /o/{orgSlug}.
export const DEFAULT_AUTHENTICATED_ENTRY_PATH = "/login";

const INTERNAL_URL_BASE = "https://openmeld.ai";

function normalizeInternalPath(path: string): string {
	if (!path.startsWith("/")) {
		return `/${path}`;
	}
	return path;
}

function asSafeInternalPath(path: string): string | null {
	if (!path.startsWith("/") || path.startsWith("//")) {
		return null;
	}
	if (path === "/app" || path.startsWith("/app/")) {
		return null;
	}
	return path;
}

function buildTrustedOrigins(origins: readonly string[]): Set<string> {
	const trustedOrigins = new Set<string>([INTERNAL_URL_BASE]);

	for (const origin of origins) {
		if (origin.trim().length === 0) {
			continue;
		}

		try {
			trustedOrigins.add(new URL(origin, INTERNAL_URL_BASE).origin);
		} catch {
			// Ignore malformed trusted-origin inputs and keep the boundary fail-closed.
		}
	}

	return trustedOrigins;
}

export function sanitizeAuthenticatedEntryTarget(
	input: string | null | undefined,
	options?: {
		fallbackPath?: string;
		trustedOrigins?: readonly string[];
	}
): string {
	const fallbackPath = normalizeInternalPath(
		options?.fallbackPath ?? DEFAULT_AUTHENTICATED_ENTRY_PATH
	);
	const rawInput = String(input ?? "").trim();

	if (rawInput.length === 0) {
		return fallbackPath;
	}

	const safeRelativePath = asSafeInternalPath(rawInput);
	if (safeRelativePath) {
		return safeRelativePath;
	}

	try {
		const candidate = new URL(rawInput);
		const trustedOrigins = buildTrustedOrigins(options?.trustedOrigins ?? []);

		if (!trustedOrigins.has(candidate.origin)) {
			return fallbackPath;
		}

		const normalizedPath = `${candidate.pathname}${candidate.search}${candidate.hash}`;
		return asSafeInternalPath(normalizedPath) ?? fallbackPath;
	} catch {
		return fallbackPath;
	}
}

export function resolveAuthenticatedEntryTarget(input: {
	requestedRedirect: string | null | undefined;
	fallbackPath?: string;
	trustedOrigins?: readonly string[];
}): string {
	return sanitizeAuthenticatedEntryTarget(input.requestedRedirect, {
		fallbackPath: input.fallbackPath,
		trustedOrigins: input.trustedOrigins,
	});
}
