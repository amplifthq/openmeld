import {
	buildProfileDisplay,
	SPACE_STREAM_KEEPALIVE_PING,
	SPACE_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
	gatewayErrorEnvelopeSchema,
	normalizeSpacePasswordText,
} from "@openmeld/schemas";
import {
	applyOpenMeldGatewayClientAddress,
	type OpenMeldGatewayUpstream,
	resolveOpenMeldGatewayUpstream,
} from "#/lib/openmeld-api/gateway-upstream";
import {
	createExpiredProtectedSpaceAccessCookieHeader,
	resolveProtectedSpaceAccessFromCookieHeader,
	shouldClearProtectedSpaceAccessFromErrorBody,
} from "./protected-space-access.server";
import {
	readSelectedSpaceProfileFromRequest,
	type SelectedSpaceProfile,
} from "./selected-space-profile.server";

const OPENMELD_HEADER_PROFILE_ID = "x-openmeld-profile-id";
const OPENMELD_HEADER_SPACE_PASSWORD = "x-openmeld-space-password";
const OPENMELD_STREAM_ROUTE_PATTERN = /^\/v1\/spaces\/([^/]+)\/stream$/u;
const SPACE_STREAM_HELLO_CAPABILITIES = {
	agentReplyPlacement: true,
	agentWorkOutcomes: true,
	liveSignalHistory: true,
	spaceMessageAddressing: true,
	spaceImageGeometry: true,
} as const;

type AcceptableWebSocket = WebSocket & {
	accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

type SpaceLiveStreamFailureStage =
	| "resolve_protected_space_access"
	| "resolve_stream_profile"
	| "build_upstream_url"
	| "forward_upstream"
	| "process_upstream_response"
	| "process_upstream_message"
	| "send_hello";

type SpaceLiveStreamProtectedSpaceAccessStatus =
	| "not_applicable"
	| "missing"
	| "available"
	| "invalid";

type UpstreamSpaceLiveMessageDisposition = "forward" | "ignore" | "unsupported";

const createWebSocketPair = (): AcceptableWebSocketPair => {
	const WebSocketPairConstructor = (
		globalThis as typeof globalThis & {
			WebSocketPair: new () => AcceptableWebSocketPair;
		}
	).WebSocketPair;
	return new WebSocketPairConstructor();
};

export async function proxySpaceLiveStreamRequest(input: {
	request: Request;
	gatewayUrl: string;
	webAppUrl: string;
	authBaseUrl: string;
	spaceAccessCookieSecret?: string;
	fetchImpl?: typeof fetch;
	gatewayUpstream?: OpenMeldGatewayUpstream;
}): Promise<Response> {
	const requestId = createWebProxyRequestId();
	const diagnostics = createSpaceLiveStreamDiagnostics({
		requestId,
		requestUrl: input.request.url,
	});
	if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return createStreamErrorResponse({
			status: 400,
			code: "bad_request",
			message: "expected websocket",
			requestId,
		});
	}

	try {
		diagnostics.failureStage = "resolve_protected_space_access";
		const requestedProfileId = readRequestedStreamProfileId(input.request.url);
		if (requestedProfileId === null) {
			return createStreamErrorResponse({
				status: 400,
				code: "bad_request",
				message: "missing profileId",
				requestId,
			});
		}
		const protectedSpaceId = readProtectedSpaceIdFromPath(
			new URL(input.request.url).pathname
		);
		diagnostics.protectedSpaceAccessStatus =
			protectedSpaceId && input.spaceAccessCookieSecret
				? "missing"
				: "not_applicable";
		const protectedSpaceAccess =
			protectedSpaceId && input.spaceAccessCookieSecret
				? await resolveProtectedSpaceAccessFromCookieHeader({
						spaceId: protectedSpaceId,
						cookieHeader: input.request.headers.get("cookie"),
						secret: input.spaceAccessCookieSecret,
					})
				: null;
		if (protectedSpaceAccess) {
			diagnostics.protectedSpaceAccessStatus = protectedSpaceAccess.status;
		}

		diagnostics.failureStage = "resolve_stream_profile";
		const selectedProfile = await readSelectedSpaceProfileFromRequest({
			requestHeaders: input.request.headers,
			authBaseUrl: input.authBaseUrl,
			openMeldProfileId: requestedProfileId,
			fetchImpl: input.fetchImpl,
		});

		diagnostics.failureStage = "build_upstream_url";
		const upstreamUrl = buildSpaceStreamUpstreamUrl({
			gatewayUrl: input.gatewayUrl,
			requestUrl: input.request.url,
		});
		diagnostics.upstreamUrl = upstreamUrl;

		diagnostics.failureStage = "forward_upstream";
		const upstreamHeaders = buildSpaceStreamUpstreamHeaders({
			requestHeaders: input.request.headers,
			webAppUrl: input.webAppUrl,
			profileId: requestedProfileId,
			...(protectedSpaceAccess?.status === "available"
				? { spacePassword: protectedSpaceAccess.password }
				: {}),
		});
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
			method: "GET",
			headers: upstreamHeaders,
		});

		diagnostics.failureStage = "process_upstream_response";
		if (upstreamResponse.status !== 101) {
			if (
				protectedSpaceId &&
				(protectedSpaceAccess?.status === "invalid" ||
					(await shouldClearProtectedSpaceAccessFromStreamErrorResponse(
						upstreamResponse
					)))
			) {
				return await cloneStreamErrorResponseWithClearedProtectedSpaceCookie({
					spaceId: protectedSpaceId,
					upstreamResponse,
					webAppUrl: input.webAppUrl,
				});
			}

			return new Response(upstreamResponse.body, {
				headers: upstreamResponse.headers,
				status: upstreamResponse.status,
				statusText: upstreamResponse.statusText,
			});
		}

		const upstream = upstreamResponse.webSocket as AcceptableWebSocket | null;
		if (!upstream) {
			return createStreamErrorResponse({
				status: 502,
				code: "upstream_error",
				message: "upstream did not upgrade websocket",
				requestId,
			});
		}

		const [client, server] = createWebSocketPair();
		server.accept();
		upstream.accept();
		let isClosed = false;

		const closeOnce = (code: number, reason: string) => {
			if (isClosed) {
				return;
			}
			isClosed = true;
			try {
				server.close(code, reason);
			} catch {
				// Ignore close races while the browser socket is already shutting down.
			}
			try {
				upstream.close(code, reason);
			} catch {
				// Ignore close races while the upstream socket is already shutting down.
			}
		};

		upstream.addEventListener("message", (event) => {
			const disposition = resolveUpstreamSpaceLiveMessageDisposition(
				event.data
			);
			if (disposition === "ignore") {
				return;
			}
			if (disposition === "unsupported") {
				diagnostics.failureStage = "process_upstream_message";
				logSpaceLiveStreamProxyFailure({
					diagnostics,
					error: "unsupported upstream websocket frame",
				});
				closeOnce(1011, "unsupported_upstream_frame");
				return;
			}
			try {
				server.send(event.data);
			} catch {
				closeOnce(1011, "client_send_failed");
			}
		});
		upstream.addEventListener("close", (event) => {
			closeOnce(event.code || 1000, event.reason || "upstream_closed");
		});
		upstream.addEventListener("error", () => {
			closeOnce(1011, "upstream_error");
		});

		server.addEventListener("message", (event) => {
			if (event.data === SPACE_STREAM_KEEPALIVE_PING) {
				// Forward the transport keepalive PING upstream; any other
				// browser frame is unexpected and still tears the stream down.
				try {
					upstream.send(SPACE_STREAM_KEEPALIVE_PING);
				} catch {
					closeOnce(1011, "keepalive_forward_failed");
				}
				return;
			}
			closeOnce(1008, "browser_send_not_supported");
		});
		server.addEventListener("close", (event) => {
			closeOnce(event.code || 1000, event.reason || "client_closed");
		});
		server.addEventListener("error", () => {
			closeOnce(1011, "client_error");
		});

		try {
			diagnostics.failureStage = "send_hello";
			upstream.send(buildSpaceStreamHelloFrame(selectedProfile));
		} catch {
			logSpaceLiveStreamProxyFailure({
				diagnostics,
				error: "failed to send hello frame upstream",
			});
			closeOnce(1011, "hello_send_failed");
		}

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	} catch (error) {
		logSpaceLiveStreamProxyFailure({
			diagnostics,
			error,
		});
		return createStreamErrorResponse({
			status: 502,
			code: "upstream_error",
			message:
				"OpenMeld couldn't prepare the live stream for this space right now.",
			requestId,
		});
	}
}

export function buildSpaceStreamHelloFrame(
	profile: SelectedSpaceProfile
): string {
	return JSON.stringify({
		type: "hello",
		profile: buildProfileDisplay({
			openMeldProfileId: profile.openMeldProfileId,
			profileKind: profile.profileKind,
			profileName: profile.profileName,
			ownerUserId: profile.ownerUserId,
			...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
		}),
		capabilities: SPACE_STREAM_HELLO_CAPABILITIES,
	});
}

export function buildSpaceStreamUpstreamUrl(input: {
	gatewayUrl: string;
	requestUrl: string;
}): string {
	const requestUrl = new URL(input.requestUrl);
	const upstreamUrl = new URL(input.gatewayUrl);
	upstreamUrl.pathname = requestUrl.pathname;
	upstreamUrl.search = requestUrl.search;
	return upstreamUrl.toString();
}

export function buildSpaceStreamUpstreamHeaders(input: {
	requestHeaders: Headers;
	webAppUrl: string;
	profileId: string;
	spacePassword?: string;
}): Headers {
	const headers = new Headers({
		upgrade: "websocket",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	if (!headers.get("origin")) {
		headers.set("origin", input.webAppUrl);
	}
	if (input.spacePassword) {
		const spacePassword = normalizeSpacePasswordText(input.spacePassword);
		if (spacePassword.length > 0) {
			headers.set(OPENMELD_HEADER_SPACE_PASSWORD, spacePassword);
		}
	}
	headers.set(OPENMELD_HEADER_PROFILE_ID, input.profileId);

	return headers;
}

export function resolveUpstreamSpaceLiveMessageDisposition(
	rawMessage: unknown
): UpstreamSpaceLiveMessageDisposition {
	if (typeof rawMessage !== "string") {
		return "unsupported";
	}
	if (rawMessage === SPACE_STREAM_KEEPALIVE_PONG) {
		// Forward the keepalive PONG end-to-end so the browser can prove the
		// whole chain (browser -> proxy -> core) is still alive. Swallowing it
		// here, or answering a local PONG from the proxy, would only prove the
		// browser-to-proxy leg: a half-open upstream socket would still look
		// healthy while no frames actually reach core. The browser uses the
		// forwarded PONG to refresh its inbound-liveness watchdog.
		return "forward";
	}

	// The Web proxy is a transparent transport for every Core text frame.
	// Semantic routing, including the hello readiness barrier, belongs to the
	// browser parser so no valid future frame type is silently lost here.
	return "forward";
}

async function shouldClearProtectedSpaceAccessFromStreamErrorResponse(
	upstreamResponse: Response
): Promise<boolean> {
	if (upstreamResponse.ok) {
		return false;
	}

	const contentType = upstreamResponse.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		return false;
	}

	return shouldClearProtectedSpaceAccessFromErrorBody(
		await upstreamResponse.clone().text()
	);
}

async function cloneStreamErrorResponseWithClearedProtectedSpaceCookie(input: {
	spaceId: string;
	upstreamResponse: Response;
	webAppUrl: string;
}): Promise<Response> {
	const headers = new Headers(input.upstreamResponse.headers);
	headers.append(
		"set-cookie",
		createExpiredProtectedSpaceAccessCookieHeader({
			spaceId: input.spaceId,
			webAppUrl: input.webAppUrl,
		})
	);

	const rawBody = await input.upstreamResponse.text();
	return new Response(rawBody, {
		headers,
		status: input.upstreamResponse.status,
		statusText: input.upstreamResponse.statusText,
	});
}

function createStreamErrorResponse(input: {
	status: number;
	code: "bad_request" | "upstream_error";
	message: string;
	requestId: string;
}): Response {
	const payload = gatewayErrorEnvelopeSchema.parse({
		ok: false,
		error: {
			code: input.code,
			message: input.message,
			requestId: input.requestId,
		},
	});
	const response = Response.json(payload, {
		status: input.status,
	});
	response.headers.set("x-openmeld-request-id", input.requestId);
	return response;
}

function createWebProxyRequestId(): string {
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `webproxy-${Date.now().toString(36)}`;
}

function createSpaceLiveStreamDiagnostics(input: {
	requestId: string;
	requestUrl: string;
}): {
	requestId: string;
	path: string;
	upstreamUrl: string | null;
	protectedSpaceAccessStatus: SpaceLiveStreamProtectedSpaceAccessStatus;
	failureStage: SpaceLiveStreamFailureStage | null;
} {
	const requestUrl = new URL(input.requestUrl);
	return {
		requestId: input.requestId,
		path: requestUrl.pathname,
		upstreamUrl: null,
		protectedSpaceAccessStatus: "not_applicable",
		failureStage: null,
	};
}

function logSpaceLiveStreamProxyFailure(input: {
	diagnostics: {
		requestId: string;
		path: string;
		upstreamUrl: string | null;
		protectedSpaceAccessStatus: SpaceLiveStreamProtectedSpaceAccessStatus;
		failureStage: SpaceLiveStreamFailureStage | null;
	};
	error: unknown;
}): void {
	console.error(
		JSON.stringify({
			event: "web.space_stream_proxy",
			requestId: input.diagnostics.requestId,
			path: input.diagnostics.path,
			upstreamUrl: input.diagnostics.upstreamUrl,
			protectedSpaceAccessStatus: input.diagnostics.protectedSpaceAccessStatus,
			failureStage: input.diagnostics.failureStage,
			error: toErrorMessage(input.error),
		})
	);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		return message.length > 0 ? message : "request failed";
	}
	const message = String(error ?? "").trim();
	return message.length > 0 ? message : "request failed";
}

function readProtectedSpaceIdFromPath(pathname: string): string | null {
	const match = OPENMELD_STREAM_ROUTE_PATTERN.exec(pathname);
	return match?.[1] ?? null;
}

function readRequestedStreamProfileId(requestUrl: string): string | null {
	const profileId = new URL(requestUrl).searchParams.get("profileId");
	const normalizedProfileId = String(profileId ?? "").trim();
	return normalizedProfileId.length > 0 ? normalizedProfileId : null;
}
