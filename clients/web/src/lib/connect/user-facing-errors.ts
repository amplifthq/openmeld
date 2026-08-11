const internalErrorPattern = /\b(D1_ERROR|SQLITE_ERROR|no such column)\b/iu;

export function formatUserFacingLoadError(
	error: unknown,
	fallbackMessage: string
): string {
	const message = extractErrorMessage(error);
	if (!message || internalErrorPattern.test(message)) {
		return fallbackMessage;
	}

	return message;
}

function extractErrorMessage(error: unknown): string | null {
	if (typeof error === "string") {
		return error.trim() || null;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message.trim() || null;
	}

	return null;
}
