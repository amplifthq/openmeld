import type { AuthClientError } from "./auth-client-types";

const AUTH_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
	EMAIL_NOT_VERIFIED: "Please verify your email before signing in.",
	INVALID_EMAIL_OR_PASSWORD: "Invalid email or password.",
	INVALID_PASSWORD: "Invalid password.",
	PASSWORD_TOO_LONG: "Password must be 128 characters or fewer.",
	PASSWORD_TOO_SHORT: "Password must be at least 8 characters.",
	PASSKEY_NOT_FOUND: "Passkey not found. Try another sign-in method.",
	RATE_LIMIT_EXCEEDED: "Too many requests. Please try again later.",
	SESSION_NOT_FRESH: "Sign in again to continue.",
	SESSION_IS_NOT_FRESH: "Sign in again to continue.",
	USER_ALREADY_EXISTS: "This email is already registered.",
	USER_NOT_FOUND: "User not found.",
};

const FRESH_SESSION_REQUIRED_MESSAGES = new Set([
	"session is not fresh",
	"session not fresh",
]);

function readErrorMessage(error: unknown): string | null {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}

	if (!error || typeof error !== "object") {
		return null;
	}

	const maybeMessage = (error as AuthClientError).message;
	if (typeof maybeMessage === "string" && maybeMessage.trim()) {
		return maybeMessage;
	}

	return null;
}

function readErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object") {
		return null;
	}

	const maybeCode = (error as AuthClientError).code;
	if (typeof maybeCode === "string" && maybeCode.trim()) {
		return maybeCode.trim().toUpperCase();
	}

	return null;
}

export function getAuthErrorCode(error: unknown): string | null {
	return readErrorCode(error);
}

export function isFreshSessionRequiredError(error: unknown): boolean {
	const code = readErrorCode(error);
	if (code === "SESSION_NOT_FRESH" || code === "SESSION_IS_NOT_FRESH") {
		return true;
	}

	const message = readErrorMessage(error);
	return message
		? FRESH_SESSION_REQUIRED_MESSAGES.has(message.trim().toLowerCase())
		: false;
}

export function getAuthErrorMessage(
	error: unknown,
	fallback = "Authentication request failed."
): string {
	if (isFreshSessionRequiredError(error)) {
		return "Sign in again to continue.";
	}

	const code = readErrorCode(error);
	if (code && AUTH_ERROR_MESSAGE_BY_CODE[code]) {
		return AUTH_ERROR_MESSAGE_BY_CODE[code];
	}

	const message = readErrorMessage(error);
	if (message) {
		return message;
	}

	return fallback;
}

export function isWebAuthnCancellationError(error: unknown): boolean {
	const message = readErrorMessage(error)?.toLowerCase();
	if (!message) {
		return false;
	}

	return (
		message.includes("timed out") ||
		message.includes("not allowed") ||
		message.includes("cancelled") ||
		message.includes("aborted")
	);
}
