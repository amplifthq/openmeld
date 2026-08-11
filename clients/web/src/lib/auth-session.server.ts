import { getRequestHeaders } from "@tanstack/react-start/server";
import {
	type CurrentUserSessionExpectation,
	createDevSsrFetchFailure,
	type SessionCacheMode,
} from "./dev-ssr-fetch-diagnostics";

type SessionRecord = {
	id?: string;
	token?: string;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	expiresAt?: string | Date;
	ipAddress?: string | null;
	userAgent?: string | null;
	[key: string]: object | string | number | boolean | null | undefined;
};

type SessionUser = {
	id?: string;
	email?: string;
	name?: string;
	image?: string | null;
	emailVerified?: boolean;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	[key: string]: object | string | number | boolean | null | undefined;
};

type SessionEnvelope = {
	session: SessionRecord;
	user: SessionUser;
} | null;

type FetchSessionInput = {
	betterAuthUrl: string;
	currentUserSessionExpectation?: CurrentUserSessionExpectation;
	fetchImpl?: typeof fetch;
	requestHeaders?: Headers;
	routeFamily?: string;
	sessionCacheMode?: SessionCacheMode;
};

export async function fetchSessionFromGateway({
	betterAuthUrl,
	currentUserSessionExpectation = "optional",
	fetchImpl = fetch,
	requestHeaders = getRequestHeaders(),
	routeFamily = "unknown_route",
	sessionCacheMode,
}: FetchSessionInput): Promise<SessionEnvelope> {
	const upstreamHeaders = new Headers({
		accept: "application/json",
	});

	const cookie = requestHeaders.get("cookie");
	if (cookie) {
		upstreamHeaders.set("cookie", cookie);
	}

	const sessionEndpoint = new URL("/api/auth/get-session", betterAuthUrl);
	const resolvedSessionCacheMode =
		sessionCacheMode ??
		(currentUserSessionExpectation === "required" ? "bypass" : "allow");
	if (resolvedSessionCacheMode === "bypass") {
		sessionEndpoint.searchParams.set("disableCookieCache", "true");
	}
	const hasCookie = cookie !== null;
	let response: Response;
	try {
		response = await fetchImpl(sessionEndpoint, {
			method: "GET",
			headers: upstreamHeaders,
		});
	} catch (error) {
		throw createDevSsrFetchFailure({
			kind: "auth_session_runtime_fetch_failed",
			operation: "fetch auth session",
			targetUrl: sessionEndpoint,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message:
				"OpenMeld couldn't fetch the auth session before receiving an HTTP response.",
			cause: error,
		});
	}

	if (response.status === 401) {
		return null;
	}

	if (!response.ok) {
		throw createDevSsrFetchFailure({
			kind: "upstream_http_failure",
			operation: "fetch auth session",
			targetUrl: sessionEndpoint,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: `Failed to fetch auth session: ${response.status}`,
			status: response.status,
		});
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw createDevSsrFetchFailure({
			kind: "invalid_response_failure",
			operation: "parse auth session response",
			targetUrl: sessionEndpoint,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message: "Invalid auth session response: failed to parse JSON.",
			status: response.status,
			cause: error,
		});
	}

	if (!isSessionEnvelope(payload)) {
		throw createDevSsrFetchFailure({
			kind: "invalid_response_failure",
			operation: "validate auth session response",
			targetUrl: sessionEndpoint,
			routeFamily,
			hasCookie,
			currentUserSessionExpectation,
			message:
				"Invalid auth session response: expected session and user fields.",
			status: response.status,
		});
	}

	return payload;
}

export type { SessionEnvelope };

function isSessionEnvelope(value: unknown): value is SessionEnvelope {
	if (value === null) {
		return true;
	}

	if (!isRecord(value)) {
		return false;
	}

	return isRecord(value.session) && isRecord(value.user);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
