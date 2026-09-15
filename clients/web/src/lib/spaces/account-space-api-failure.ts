import {
	OpenMeldApiClientHttpError,
	OpenMeldApiClientInvalidResponseError,
} from "@openmeld/api-client";

// Keep the existing Web operation copy while retaining the HTTP client's
// status, code and request id for session recovery and diagnostics.
export function rethrowAccountSpaceApiFailure(
	error: unknown,
	operation: string,
	invalidMessage: string
): never {
	if (error instanceof OpenMeldApiClientHttpError) {
		error.message = `Failed to ${operation}: ${error.status}`;
	} else if (error instanceof OpenMeldApiClientInvalidResponseError) {
		error.message = invalidMessage;
	}
	throw error;
}
