import { DEFAULT_AUTHENTICATED_ENTRY_PATH } from "./auth-entry-policy";
import { sanitizeRedirectTarget } from "./auth-redirect";
import { readResponseBody } from "./http-response";

export const SESSION_EXPIRED_MESSAGE =
	"Your session expired. Sign in again to continue.";
export const SESSION_EXPIRED_CTA_LABEL = "Sign in again";

const SESSION_EXPIRED_CODE = "auth.unauthenticated";
const SESSION_EXPIRED_TEXT = "authentication required";
const NON_SESSION_AUTH_CODES = new Set([
	"space.password_invalid",
	"space.password_required",
]);

export type SessionExpiredState = {
	ctaLabel: typeof SESSION_EXPIRED_CTA_LABEL;
	href: string;
	message: typeof SESSION_EXPIRED_MESSAGE;
};

export class SessionExpiredError extends Error {
	readonly code = SESSION_EXPIRED_CODE;
	readonly requestId: string | null;
	readonly status = 401;
	readonly statusText: string | null;
	readonly upstreamCode: string | null;

	constructor(input?: {
		cause?: unknown;
		requestId?: string | null;
		statusText?: string | null;
		upstreamCode?: string | null;
	}) {
		super(SESSION_EXPIRED_MESSAGE);
		this.name = "SessionExpiredError";
		this.cause = input?.cause;
		this.requestId = normalizeOptionalText(input?.requestId);
		this.statusText = normalizeOptionalText(input?.statusText);
		this.upstreamCode = normalizeOptionalText(input?.upstreamCode);
	}
}

export function isSessionExpiredError(error: unknown): boolean {
	if (error instanceof SessionExpiredError) {
		return true;
	}

	const status = readStatus(error);
	const code = readTextField(error, "code");
	const upstreamCode = readTextField(error, "upstreamCode");
	const message = readErrorMessage(error);

	if (
		(code && NON_SESSION_AUTH_CODES.has(code)) ||
		(upstreamCode && NON_SESSION_AUTH_CODES.has(upstreamCode))
	) {
		return false;
	}

	return (
		code === SESSION_EXPIRED_CODE ||
		upstreamCode === SESSION_EXPIRED_CODE ||
		normalizeComparableText(message) ===
			normalizeComparableText(SESSION_EXPIRED_MESSAGE) ||
		normalizeComparableText(message) === SESSION_EXPIRED_TEXT ||
		status === 401
	);
}

export function toSessionExpiredState(
	error: unknown,
	currentUrl?: string | null
): SessionExpiredState | null {
	if (!isSessionExpiredError(error)) {
		return null;
	}

	return {
		ctaLabel: SESSION_EXPIRED_CTA_LABEL,
		href: buildLoginRedirectUrl(currentUrl),
		message: SESSION_EXPIRED_MESSAGE,
	};
}

export function buildLoginRedirectUrl(currentUrl?: string | null): string {
	const redirectTarget = sanitizeRedirectTarget(
		currentUrl ?? readCurrentBrowserPath(),
		DEFAULT_AUTHENTICATED_ENTRY_PATH
	);
	const search = new URLSearchParams({ redirect: redirectTarget });
	return `/login?${search.toString()}`;
}

export async function readSessionExpiredErrorFromResponse(
	response: Response
): Promise<SessionExpiredError | null> {
	if (response.status !== 401) {
		return null;
	}

	const body = await readResponseBody(response);
	const payload = body.ok ? body.value : null;
	const errorPayload = readErrorPayload(payload);
	return new SessionExpiredError({
		cause: payload,
		requestId: readTextField(errorPayload, "requestId"),
		statusText: response.statusText,
		upstreamCode: readTextField(errorPayload, "upstreamCode"),
	});
}

function readCurrentBrowserPath(): string {
	if (typeof window === "undefined") {
		return DEFAULT_AUTHENTICATED_ENTRY_PATH;
	}

	return `${window.location.pathname}${window.location.search}`;
}

function readErrorMessage(error: unknown): string | null {
	if (error instanceof Error) {
		return normalizeOptionalText(error.message);
	}

	if (typeof error === "string") {
		return normalizeOptionalText(error);
	}

	return readTextField(error, "message");
}

function readStatus(error: unknown): number | null {
	if (!error || typeof error !== "object" || !("status" in error)) {
		return null;
	}

	const status = (error as { status?: unknown }).status;
	return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function readTextField(
	value: unknown,
	fieldName: "code" | "message" | "requestId" | "upstreamCode"
): string | null {
	if (!value || typeof value !== "object" || !(fieldName in value)) {
		return null;
	}

	return normalizeOptionalText(
		(value as Record<typeof fieldName, unknown>)[fieldName]
	);
}

function normalizeOptionalText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function normalizeComparableText(value: string | null): string | null {
	return value?.trim().toLowerCase() ?? null;
}

function readErrorPayload(payload: unknown): unknown {
	if (!payload || typeof payload !== "object") {
		return payload;
	}

	if ("error" in payload) {
		return (payload as { error?: unknown }).error;
	}

	return payload;
}
