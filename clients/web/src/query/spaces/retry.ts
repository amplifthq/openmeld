import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { isProtectedSpaceFailure } from "#/lib/spaces/errors";
import { baseQueryOptions } from "#/query/query-config";

export function shouldRetrySpaceQuery(
	failureCount: number,
	error: unknown
): boolean {
	if (isProtectedSpaceFailure(toStructuredApiClientFailure(error))) {
		return false;
	}

	return baseQueryOptions.retry(failureCount, error);
}

export class MissingHistoryAnchorError extends Error {}

export function shouldRetrySpaceHistoryQuery(
	failureCount: number,
	error: unknown
): boolean {
	const { status } = toStructuredApiClientFailure(error);
	if (
		error instanceof MissingHistoryAnchorError ||
		(status !== null &&
			status >= 400 &&
			status < 500 &&
			status !== 408 &&
			status !== 429)
	) {
		return false;
	}
	return shouldRetrySpaceQuery(failureCount, error);
}
