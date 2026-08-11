import { isSessionExpiredError } from "#/lib/session-expired";

const MAX_NON_AUTH_QUERY_RETRIES = 2;
const MEMBERSHIP_REQUIRED_CODE = "organization.membership_required";
const INVALID_OWNER_RESPONSE_CODE = "gateway.invalid_response";

function isActiveOrganizationMismatch(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === MEMBERSHIP_REQUIRED_CODE
	);
}

function isInvalidOwnerResponse(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === INVALID_OWNER_RESPONSE_CODE
	);
}

export function shouldRetryQuery(
	failureCount: number,
	error: unknown
): boolean {
	if (isSessionExpiredError(error)) {
		return false;
	}

	// An active-organization mismatch will not resolve by retrying the same
	// request: the session's active organization is wrong until it is re-pointed.
	// Fail fast so the membership self-heal path can take over immediately.
	if (isActiveOrganizationMismatch(error)) {
		return false;
	}

	if (isInvalidOwnerResponse(error)) {
		return false;
	}

	return failureCount < MAX_NON_AUTH_QUERY_RETRIES;
}

export const baseQueryOptions = {
	gcTime: 5 * 60 * 1000,
	retry: shouldRetryQuery,
	staleTime: 30 * 1000,
} as const;

// Keep bounded display snapshots for frequently revisited app routes in memory.
// Freshness and authority remain query-specific; this only prevents a return
// visit from falling off the default five-minute garbage-collection cliff.
export const ROUTE_REVISIT_GC_TIME_MS = 30 * 60 * 1000;

// Persisted display snapshots may survive a browser restart for up to seven
// days. Their query-specific staleTime still forces current server reads; this
// longer gcTime only keeps restored data alive long enough to be useful.
export const PERSISTED_DISPLAY_QUERY_GC_TIME_MS = 7 * 24 * 60 * 60 * 1000;
