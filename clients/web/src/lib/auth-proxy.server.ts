import { OPENMELD_HEADER_REQUEST_ID } from "@openmeld/gateway-contract";
import {
	ACCOUNT_ORGANIZATION_CONTEXT_PATH,
	ACCOUNT_SESSION_PATH,
} from "@openmeld/schemas";
import { getRequiredServerEnv } from "#/env";
import { executeObservedWebProxyRequest } from "#/lib/openmeld-api/proxy-observability";

const AUTH_API_PREFIX = "/api/auth";
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const VERIFICATION_REDIRECT_AUTH_PATHS = new Set([
	"/magic-link/verify",
	"/verify-email",
]);
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"content-length",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);
const DOWNSTREAM_AUTH_RESPONSE_HEADERS = new Set([
	"cache-control",
	"content-type",
	"location",
	"set-cookie",
	"x-request-id",
]);

export function resolveBetterAuthUpstreamPath(requestUrl: string): string {
	const incomingUrl = new URL(requestUrl);
	const authPath = incomingUrl.pathname.startsWith(AUTH_API_PREFIX)
		? incomingUrl.pathname.slice(AUTH_API_PREFIX.length)
		: "";
	return `${AUTH_API_PREFIX}${authPath}`;
}

function buildUpstreamUrl(input: {
	requestUrl: string;
	upstreamPath: string;
}): URL {
	const incomingUrl = new URL(input.requestUrl);
	const upstreamUrl = new URL(getRequiredServerEnv("BETTER_AUTH_URL"));
	upstreamUrl.pathname = input.upstreamPath;
	upstreamUrl.search = incomingUrl.search;

	return upstreamUrl;
}

export function buildUpstreamHeaders(
	requestHeaders: Headers,
	preserveOrigin = false
): Headers {
	const headers = new Headers(requestHeaders);
	for (const headerName of HOP_BY_HOP_HEADERS) {
		headers.delete(headerName);
	}

	if (!(preserveOrigin || headers.get("origin"))) {
		headers.set("origin", getRequiredServerEnv("WEB_APP_URL"));
	}

	return headers;
}

export async function proxyAuthOwnedRequest(input: {
	request: Request;
	upstreamPath: string;
	preserveUnauthorizedStatus?: boolean;
	preserveOrigin?: boolean;
}): Promise<Response> {
	const { readWebProxyCloudflareRuntimeEvidence } = await import(
		"#/lib/openmeld-api/proxy-cloudflare-runtime.server"
	);
	return await executeObservedWebProxyRequest({
		cloudflareRuntimeEvidence: readWebProxyCloudflareRuntimeEvidence(),
		request: input.request,
		proxyKind: "auth",
		execute: async (diagnostics) => {
			const method = input.request.method.toUpperCase();
			const headers = buildUpstreamHeaders(
				input.request.headers,
				input.preserveOrigin
			);
			if (
				input.upstreamPath === ACCOUNT_ORGANIZATION_CONTEXT_PATH ||
				input.upstreamPath === ACCOUNT_SESSION_PATH
			) {
				headers.set(
					"x-request-id",
					headers.get(OPENMELD_HEADER_REQUEST_ID) ??
						headers.get("x-request-id") ??
						diagnostics.webProxyRequestId
				);
			}
			diagnostics.setLastStage("build_upstream_url");
			const upstreamUrl = buildUpstreamUrl({
				requestUrl: input.request.url,
				upstreamPath: input.upstreamPath,
			});
			diagnostics.setUpstreamUrl(upstreamUrl.toString());

			const upstreamRequestInit: RequestInit = {
				headers,
				method,
				redirect: "manual",
			};

			if (!BODYLESS_METHODS.has(method)) {
				upstreamRequestInit.body = await readAuthProxyRequestBody(
					input.request
				);
			}

			diagnostics.setLastStage("forward_upstream");
			const upstreamResponse = await fetch(
				upstreamUrl.toString(),
				upstreamRequestInit
			);
			diagnostics.setUpstreamRequestId(
				upstreamResponse.headers.get("x-request-id")
			);

			diagnostics.setLastStage("process_upstream_response");
			return await buildBufferedAuthProxyResponse({
				method,
				preserveUnauthorizedStatus: input.preserveUnauthorizedStatus,
				requestUrl: input.request.url,
				upstreamResponse,
			});
		},
	});
}

async function readAuthProxyRequestBody(
	request: Request
): Promise<ArrayBuffer | null> {
	if (request.body === null) {
		return null;
	}

	return await request.arrayBuffer();
}

export async function buildBufferedAuthProxyResponse(input: {
	method: string;
	preserveUnauthorizedStatus?: boolean;
	requestUrl?: string;
	upstreamResponse: Response;
}): Promise<Response> {
	if (
		isRedirectStatus(input.upstreamResponse.status) &&
		isVerificationRedirectRequest(input.requestUrl)
	) {
		return buildVerificationRedirectResponse(input.upstreamResponse);
	}

	if (
		!(
			input.upstreamResponse.ok ||
			isRedirectStatus(input.upstreamResponse.status)
		)
	) {
		return await buildAuthProxyErrorResponse(input);
	}

	const body = await readAuthProxyResponseBody(input);
	return new Response(body, {
		headers: buildDownstreamAuthProxyHeaders(input.upstreamResponse.headers),
		status: input.upstreamResponse.status,
		statusText: input.upstreamResponse.statusText,
	});
}

function isRedirectStatus(status: number): boolean {
	return status >= 300 && status < 400;
}

function isVerificationRedirectRequest(
	requestUrl: string | undefined
): boolean {
	if (!requestUrl) {
		return false;
	}

	try {
		const requestPath = new URL(requestUrl).pathname;
		if (!requestPath.startsWith(AUTH_API_PREFIX)) {
			return false;
		}

		return VERIFICATION_REDIRECT_AUTH_PATHS.has(
			requestPath.slice(AUTH_API_PREFIX.length)
		);
	} catch {
		return false;
	}
}

function buildVerificationRedirectResponse(
	upstreamResponse: Response
): Response {
	const redirectError = readRedirectAuthError(
		upstreamResponse.headers.get("location")
	);
	const headers = buildDownstreamAuthProxyHeaders(upstreamResponse.headers);
	headers.delete("location");
	headers.set("content-type", "application/json; charset=utf-8");

	if (redirectError) {
		return new Response(JSON.stringify(redirectError), {
			headers,
			status: 400,
			statusText: "Bad Request",
		});
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers,
		status: 200,
	});
}

function readRedirectAuthError(location: string | null): {
	code: string;
	description?: string;
	message: string;
} | null {
	if (!location) {
		return null;
	}

	try {
		const redirectUrl = new URL(location, "http://localhost");
		const code = redirectUrl.searchParams.get("error")?.trim();
		if (!code) {
			return null;
		}
		const description = redirectUrl.searchParams
			.get("error_description")
			?.trim();
		return {
			code,
			...(description ? { description } : {}),
			message: description ? `${code}: ${description}` : code,
		};
	} catch {
		return null;
	}
}

async function buildAuthProxyErrorResponse(input: {
	upstreamResponse: Response;
	preserveUnauthorizedStatus?: boolean;
}): Promise<Response> {
	const contentType = input.upstreamResponse.headers.get("content-type") ?? "";
	const upstreamBody = contentType.includes("application/json")
		? await input.upstreamResponse.text()
		: "";
	const body =
		upstreamBody.trim().length > 0
			? upstreamBody
			: JSON.stringify({
					code:
						input.upstreamResponse.status === 401
							? "AUTH_UNAUTHENTICATED"
							: "AUTH_UPSTREAM_ERROR",
					message:
						input.upstreamResponse.status === 401
							? "Sign in again to continue."
							: "Authentication request failed.",
				});

	const headers = buildDownstreamAuthProxyHeaders(
		input.upstreamResponse.headers
	);
	headers.set("content-type", "application/json; charset=utf-8");

	return new Response(body, {
		headers,
		status: input.preserveUnauthorizedStatus
			? input.upstreamResponse.status
			: resolveAuthProxyErrorStatus(input.upstreamResponse.status),
	});
}

function resolveAuthProxyErrorStatus(upstreamStatus: number): number {
	// Cloudflare Vite dev currently turns proxied Auth 401 responses into a
	// fetch-failed overlay. Auth forms use the structured error body, so keep
	// the user-facing error intact and normalize only the transport status.
	return upstreamStatus === 401 ? 400 : upstreamStatus;
}

export function buildDownstreamAuthProxyHeaders(
	upstreamHeaders: Headers
): Headers {
	const headers = new Headers();
	for (const [headerName, headerValue] of upstreamHeaders.entries()) {
		const normalizedHeaderName = headerName.toLowerCase();
		if (
			HOP_BY_HOP_HEADERS.has(normalizedHeaderName) ||
			!DOWNSTREAM_AUTH_RESPONSE_HEADERS.has(normalizedHeaderName) ||
			normalizedHeaderName === "set-cookie"
		) {
			continue;
		}
		headers.append(headerName, headerValue);
	}

	for (const cookieHeader of readSetCookieHeaders(upstreamHeaders)) {
		headers.append("set-cookie", cookieHeader);
	}

	return headers;
}

function readSetCookieHeaders(headers: Headers): string[] {
	const getSetCookie = (
		headers as Headers & {
			getSetCookie?: () => string[];
		}
	).getSetCookie;
	if (typeof getSetCookie === "function") {
		return getSetCookie
			.call(headers)
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
	}

	const getAll = (headers as Headers & { getAll?: (name: string) => string[] })
		.getAll;
	if (typeof getAll === "function") {
		return getAll.call(headers, "Set-Cookie");
	}
	const cookieHeader = headers.get("set-cookie")?.trim();
	return cookieHeader ? [cookieHeader] : [];
}

async function readAuthProxyResponseBody(input: {
	method: string;
	upstreamResponse: Response;
}): Promise<string | null> {
	if (
		input.method === "HEAD" ||
		input.upstreamResponse.status === 204 ||
		input.upstreamResponse.status === 304 ||
		input.upstreamResponse.body === null
	) {
		return null;
	}

	return await input.upstreamResponse.text();
}
