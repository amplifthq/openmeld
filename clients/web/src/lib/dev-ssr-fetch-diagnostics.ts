export type DevSsrFetchFailureKind =
	| "auth_session_runtime_fetch_failed"
	| "openmeld_boundary_runtime_fetch_failed"
	| "upstream_http_failure"
	| "invalid_response_failure";

export type CurrentUserSessionExpectation = "optional" | "required";
export type SessionCacheMode = "allow" | "bypass";

type DevSsrFetchFailureInput = {
	kind: DevSsrFetchFailureKind;
	operation: string;
	targetUrl: string | URL;
	routeFamily: string;
	hasCookie: boolean;
	currentUserSessionExpectation: CurrentUserSessionExpectation;
	message: string;
	status?: number;
	cause?: unknown;
};

type DevSsrFetchFailureRecord = {
	event: "web.dev_ssr_fetch";
	kind: DevSsrFetchFailureKind;
	operation: string;
	targetOrigin: string;
	targetPath: string;
	routeFamily: string;
	hasCookie: boolean;
	currentUserSessionExpectation: CurrentUserSessionExpectation;
	status: number | null;
	message: string;
	causeMessage: string | null;
	causeStack: string | null;
};

export function createDevSsrFetchFailure(
	input: DevSsrFetchFailureInput
): Error {
	logDevSsrFetchFailure(input);
	const cause = normalizeErrorCause(input.cause);
	return cause === undefined
		? new Error(input.message)
		: new Error(input.message, { cause });
}

function logDevSsrFetchFailure(input: DevSsrFetchFailureInput): void {
	if (!import.meta.env.DEV) {
		return;
	}

	const targetUrl = toTargetUrl(input.targetUrl);
	const cause = normalizeErrorCause(input.cause);
	const record: DevSsrFetchFailureRecord = {
		event: "web.dev_ssr_fetch",
		kind: input.kind,
		operation: input.operation,
		targetOrigin: targetUrl.origin,
		targetPath: `${targetUrl.pathname}${targetUrl.search}`,
		routeFamily: input.routeFamily,
		hasCookie: input.hasCookie,
		currentUserSessionExpectation: input.currentUserSessionExpectation,
		status: input.status ?? null,
		message: input.message,
		causeMessage: cause?.message ?? null,
		causeStack: cause?.stack ?? null,
	};
	console.error(JSON.stringify(record));
}

function toTargetUrl(value: string | URL): URL {
	return value instanceof URL ? value : new URL(value);
}

function normalizeErrorCause(error: unknown): Error | undefined {
	if (error instanceof Error) {
		return error;
	}

	if (error === undefined) {
		return undefined;
	}

	const message = String(error).trim();
	if (message.length === 0) {
		return undefined;
	}

	return new Error(message);
}
