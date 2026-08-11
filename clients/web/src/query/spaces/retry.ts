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
