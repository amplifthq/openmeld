import {
	OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
	OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
	OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
	OPENMELD_HEADER_PROFILE_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
	OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
	OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION,
	OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
	OPENMELD_HEADER_SPACE_PASSWORD,
	OPENMELD_HEADER_USER_TIME_ZONE,
	OPENMELD_HEADER_USER_TIME_ZONE_SOURCE,
} from "@openmeld/gateway-contract";
import {
	AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER,
	gatewayErrorEnvelopeSchema,
	normalizeSpacePasswordText,
	SPACE_ACCESS_VERSION_HEADER,
} from "@openmeld/schemas";
import { SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM } from "#/lib/slack-oauth-start";
import {
	createExpiredProtectedSpaceAccessCookieHeader,
	resolveProtectedSpaceAccessFromCookieHeader,
} from "#/lib/spaces/protected-space-access.server";
import { WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM } from "#/lib/spaces/web-space-attachment-path";
import {
	applyOpenMeldGatewayClientAddress,
	type OpenMeldGatewayUpstream,
	resolveOpenMeldGatewayUpstream,
} from "./gateway-upstream";
import {
	executeObservedWebProxyRequest,
	type WebProxyCloudflareRuntimeEvidence,
	type WebProxyProtectedSpaceAccessStatus,
} from "./proxy-observability";

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const OPENMELD_PUBLIC_ROUTE_PREFIX = "/v1/";
const OPENMELD_SLACK_OAUTH_START_ROUTE = "/slack/oauth/start";
const OPENMELD_SLACK_IDENTITY_START_ROUTE = "/slack/identity/start";
const OPENMELD_SPACE_ROUTE_PATTERN = /^\/v1\/spaces\/([^/]+)(?:\/|$)/u;
const ALLOWED_PROXY_REQUEST_HEADERS = new Set([
	AGENT_EXECUTION_READINESS_RESPONSE_VERSION_HEADER,
	OPENMELD_HEADER_USER_TIME_ZONE,
	OPENMELD_HEADER_USER_TIME_ZONE_SOURCE,
	SPACE_ACCESS_VERSION_HEADER,
	"accept",
	"accept-language",
	"cache-control",
	"content-type",
	"cookie",
	"if-match",
	"if-modified-since",
	"if-none-match",
	"if-range",
	"if-unmodified-since",
	"origin",
	"pragma",
	"range",
	OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION.toLowerCase(),
	OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION.toLowerCase(),
	OPENMELD_HEADER_INBOX_SUMMARY_VERSION.toLowerCase(),
	OPENMELD_HEADER_SPACE_ADDRESSING_VERSION.toLowerCase(),
	OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION.toLowerCase(),
	OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION.toLowerCase(),
	OPENMELD_HEADER_PROFILE_ID.toLowerCase(),
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID.toLowerCase(),
	OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG.toLowerCase(),
	OPENMELD_HEADER_SPACE_PASSWORD.toLowerCase(),
]);

export function buildOpenMeldGatewayUpstreamUrl(input: {
	gatewayUrl: string;
	requestUrl: string;
}): URL {
	const incomingUrl = new URL(input.requestUrl);
	const upstreamUrl = new URL(input.gatewayUrl);
	if (
		incomingUrl.pathname !== "/v1" &&
		!incomingUrl.pathname.startsWith(OPENMELD_PUBLIC_ROUTE_PREFIX) &&
		incomingUrl.pathname !== OPENMELD_SLACK_OAUTH_START_ROUTE &&
		incomingUrl.pathname !== OPENMELD_SLACK_IDENTITY_START_ROUTE
	) {
		throw new Error(
			`OpenMeld proxy does not support route: ${incomingUrl.pathname}`
		);
	}

	upstreamUrl.pathname = incomingUrl.pathname;
	upstreamUrl.search = incomingUrl.search;
	upstreamUrl.searchParams.delete(
		WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM
	);
	if (
		incomingUrl.pathname === OPENMELD_SLACK_OAUTH_START_ROUTE ||
		incomingUrl.pathname === OPENMELD_SLACK_IDENTITY_START_ROUTE
	) {
		upstreamUrl.searchParams.delete(SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM);
	}
	return upstreamUrl;
}

export function buildOpenMeldGatewayUpstreamHeaders(input: {
	requestHeaders: Headers;
	webAppUrl: string;
	spacePassword?: string;
}): Headers {
	const headers = new Headers();

	for (const [headerName, headerValue] of input.requestHeaders.entries()) {
		const normalizedHeaderName = headerName.toLowerCase();
		const isSpacePasswordHeader =
			normalizedHeaderName === OPENMELD_HEADER_SPACE_PASSWORD.toLowerCase();
		if (!ALLOWED_PROXY_REQUEST_HEADERS.has(normalizedHeaderName)) {
			continue;
		}

		if (isSpacePasswordHeader) {
			const spacePassword = normalizeSpacePasswordText(headerValue);
			if (spacePassword.length > 0) {
				headers.set(normalizedHeaderName, spacePassword);
			}
			continue;
		}

		headers.set(normalizedHeaderName, headerValue);
	}

	// Cloudflare derives CF-Connecting-IP from x-real-ip on same-zone
	// subrequests. Web and Gateway must stay in the same Cloudflare zone.
	// Use only the edge-provided IP, never a caller's forwarding headers.
	const clientIp = input.requestHeaders.get("cf-connecting-ip");
	if (clientIp) {
		headers.set("x-real-ip", clientIp);
	}

	if (!headers.get("origin")) {
		headers.set("origin", input.webAppUrl);
	}
	if (input.spacePassword && !headers.get(OPENMELD_HEADER_SPACE_PASSWORD)) {
		const spacePassword = normalizeSpacePasswordText(input.spacePassword);
		if (spacePassword.length > 0) {
			headers.set(OPENMELD_HEADER_SPACE_PASSWORD, spacePassword);
		}
	}

	return headers;
}

export async function proxyOpenMeldGatewayRequest(input: {
	request: Request;
	gatewayUrl: string;
	webAppUrl: string;
	spaceAccessCookieSecret?: string;
	cloudflareRuntimeEvidence?: WebProxyCloudflareRuntimeEvidence;
	fetchImpl?: typeof fetch;
	gatewayUpstream?: OpenMeldGatewayUpstream;
}): Promise<Response> {
	return await executeObservedWebProxyRequest({
		cloudflareRuntimeEvidence: input.cloudflareRuntimeEvidence,
		request: input.request,
		proxyKind: "openmeld_gateway",
		execute: async (diagnostics) => {
			const method = input.request.method.toUpperCase();
			const requestUrl = new URL(input.request.url);
			const attachmentOrganizationSlug = readWebAttachmentOrganizationSlug(
				input.request
			);
			const slackOAuthOrganizationSlug = readWebSlackOAuthOrganizationSlug(
				input.request
			);
			const protectedSpaceId = readProtectedSpaceIdFromPath(
				requestUrl.pathname
			);
			const protectedSpaceAccessStatus = resolveProtectedSpaceAccessStatus({
				protectedSpaceId,
				spaceAccessCookieSecret: input.spaceAccessCookieSecret,
			});
			diagnostics.setProtectedSpaceAccessStatus(protectedSpaceAccessStatus);

			diagnostics.setLastStage("resolve_protected_space_access");
			const protectedSpaceAccess =
				protectedSpaceAccessStatus === "not_applicable"
					? null
					: await resolveProtectedSpaceAccessFromCookieHeader({
							spaceId: protectedSpaceId as string,
							cookieHeader: input.request.headers.get("cookie"),
							secret: input.spaceAccessCookieSecret as string,
						});
			if (protectedSpaceAccess) {
				diagnostics.setProtectedSpaceAccessStatus(protectedSpaceAccess.status);
			}

			diagnostics.setLastStage("build_upstream_url");
			const upstreamUrl = buildOpenMeldGatewayUpstreamUrl({
				gatewayUrl: input.gatewayUrl,
				requestUrl: input.request.url,
			}).toString();
			diagnostics.setUpstreamUrl(upstreamUrl);

			diagnostics.setLastStage("forward_upstream");
			const upstreamHeaders = buildOpenMeldGatewayUpstreamHeaders({
				requestHeaders: input.request.headers,
				webAppUrl: input.webAppUrl,
				...(protectedSpaceAccess?.status === "available"
					? { spacePassword: protectedSpaceAccess.password }
					: {}),
			});
			if (attachmentOrganizationSlug) {
				upstreamHeaders.set(
					OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
					attachmentOrganizationSlug
				);
			}
			if (slackOAuthOrganizationSlug) {
				upstreamHeaders.set(
					OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
					slackOAuthOrganizationSlug
				);
			}
			const gatewayUpstream = await resolveOpenMeldGatewayUpstream({
				upstream: input.gatewayUpstream,
				fetchImpl: input.fetchImpl,
			});
			applyOpenMeldGatewayClientAddress({
				upstream: gatewayUpstream,
				requestHeaders: input.request.headers,
				upstreamHeaders,
			});
			const upstreamResponse = await gatewayUpstream.fetch(upstreamUrl, {
				method,
				headers: upstreamHeaders,
				...(BODYLESS_METHODS.has(method) ? {} : { body: input.request.body }),
				redirect: "manual",
				signal: input.request.signal,
			});
			diagnostics.setUpstreamRequestId(
				upstreamResponse.headers.get("x-openmeld-request-id")
			);

			diagnostics.setLastStage("process_upstream_response");
			const upstreamErrorCode =
				await readGatewayErrorCodeFromUpstreamResponse(upstreamResponse);
			diagnostics.setUpstreamErrorCode(upstreamErrorCode);
			const shouldClearProtectedSpaceCookie =
				protectedSpaceId &&
				(protectedSpaceAccess?.status === "invalid" ||
					shouldClearProtectedSpaceAccessFromErrorCode(upstreamErrorCode));
			if (shouldClearProtectedSpaceCookie) {
				return await cloneResponseWithClearedProtectedSpaceCookie({
					spaceId: protectedSpaceId,
					upstreamResponse,
					method,
					webAppUrl: input.webAppUrl,
				});
			}

			return new Response(upstreamResponse.body, {
				headers: buildOpenMeldGatewayDownstreamHeaders({
					method,
					upstreamResponse,
				}),
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
			});
		},
	});
}

const SPACE_MEDIA_DOWNLOAD_ROUTE_PATTERN =
	/^\/v1\/spaces\/[^/]+\/(?:attachments\/[^/]+|files\/[^/]+\/content)$/u;

function readWebAttachmentOrganizationSlug(request: Request): string | null {
	if (!(request.method === "GET" || request.method === "HEAD")) {
		return null;
	}
	const requestUrl = new URL(request.url);
	if (!SPACE_MEDIA_DOWNLOAD_ROUTE_PATTERN.test(requestUrl.pathname)) {
		return null;
	}
	const organizationSlug = requestUrl.searchParams
		.get(WEB_SPACE_ATTACHMENT_ORGANIZATION_SLUG_SEARCH_PARAM)
		?.trim();
	return organizationSlug || null;
}

function readWebSlackOAuthOrganizationSlug(request: Request): string | null {
	if (request.method !== "GET") {
		return null;
	}
	const requestUrl = new URL(request.url);
	if (
		requestUrl.pathname !== OPENMELD_SLACK_OAUTH_START_ROUTE &&
		requestUrl.pathname !== OPENMELD_SLACK_IDENTITY_START_ROUTE
	) {
		return null;
	}
	const organizationSlug = requestUrl.searchParams
		.get(SLACK_OAUTH_ORGANIZATION_SLUG_SEARCH_PARAM)
		?.trim();
	return organizationSlug || null;
}

function resolveProtectedSpaceAccessStatus(input: {
	protectedSpaceId: string | null;
	spaceAccessCookieSecret?: string;
}): WebProxyProtectedSpaceAccessStatus {
	if (!(input.protectedSpaceId && input.spaceAccessCookieSecret)) {
		return "not_applicable";
	}
	return "missing";
}

async function readGatewayErrorCodeFromUpstreamResponse(
	upstreamResponse: Response
): Promise<string | null> {
	if (upstreamResponse.ok) {
		return null;
	}

	const contentType = upstreamResponse.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		return null;
	}

	try {
		const parsed = gatewayErrorEnvelopeSchema.safeParse(
			JSON.parse(await upstreamResponse.clone().text())
		);
		return parsed.success ? parsed.data.error.code : null;
	} catch {
		return null;
	}
}

function shouldClearProtectedSpaceAccessFromErrorCode(
	errorCode: string | null
): boolean {
	return (
		errorCode === "space.password_required" ||
		errorCode === "space.password_invalid"
	);
}

function cloneResponseWithClearedProtectedSpaceCookie(input: {
	method: string;
	spaceId: string;
	upstreamResponse: Response;
	webAppUrl: string;
}): Response {
	const headers = buildOpenMeldGatewayDownstreamHeaders({
		method: input.method,
		upstreamResponse: input.upstreamResponse,
	});
	headers.append(
		"set-cookie",
		createExpiredProtectedSpaceAccessCookieHeader({
			spaceId: input.spaceId,
			webAppUrl: input.webAppUrl,
		})
	);

	return new Response(input.upstreamResponse.body, {
		headers,
		status: input.upstreamResponse.status,
		statusText: input.upstreamResponse.statusText,
	});
}

function buildOpenMeldGatewayDownstreamHeaders(input: {
	method: string;
	upstreamResponse: Response;
}): Headers {
	const headers = new Headers(input.upstreamResponse.headers);
	if (
		!headers.get("content-type") &&
		input.method !== "HEAD" &&
		input.upstreamResponse.status !== 204 &&
		input.upstreamResponse.status !== 304
	) {
		headers.set("content-type", "application/json; charset=utf-8");
	}
	return headers;
}

function readProtectedSpaceIdFromPath(pathname: string): string | null {
	const match = OPENMELD_SPACE_ROUTE_PATTERN.exec(pathname);
	return match?.[1] ?? null;
}
