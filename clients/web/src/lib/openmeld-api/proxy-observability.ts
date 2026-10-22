import {
	ACCOUNT_ORGANIZATION_CONTEXT_PATH,
	ACCOUNT_SESSION_PATH,
	clientMessageIdSchema,
	gatewayErrorEnvelopeSchema,
} from "@openmeld/schemas";
import {
	emitWebCloudflareRuntimeEvidence,
	readWebCloudflareRequestEvidence,
	type WebCloudflareRuntimeEvidence,
} from "#/lib/observability/cloudflare-runtime-evidence";

const OPENMELD_HEADER_REQUEST_ID = "x-openmeld-request-id";
const WEB_PROXY_CORRELATION_BODY_MAX_BYTES = 16 * 1024;
export const WEB_PROXY_REQUEST_ID_HEADER = "x-web-proxy-request-id";

export type WebProxyKind = "openmeld_gateway" | "auth";
export type WebProxyStage =
	| "resolve_protected_space_access"
	| "build_upstream_url"
	| "forward_upstream"
	| "process_upstream_response";
export type WebProxyProtectedSpaceAccessStatus =
	| "not_applicable"
	| "missing"
	| "available"
	| "invalid";

type WebProxyDiagnosticsState = {
	clientMessageId: string | null;
	webProxyRequestId: string;
	sourceSignalId: string | null;
	startedAtMs: number;
	method: string;
	path: string;
	proxyKind: WebProxyKind;
	targetProfileId: string | null;
	upstreamUrl: string | null;
	upstreamRequestId: string | null;
	upstreamErrorCode: string | null;
	protectedSpaceAccessStatus: WebProxyProtectedSpaceAccessStatus;
	lastStage: WebProxyStage | null;
};

export type WebProxyCloudflareRuntimeEvidence = WebCloudflareRuntimeEvidence;

export type ObservedWebProxyContext = {
	webProxyRequestId: string;
	setUpstreamUrl: (upstreamUrl: string) => void;
	setUpstreamRequestId: (requestId: string | null) => void;
	setUpstreamErrorCode: (errorCode: string | null) => void;
	setProtectedSpaceAccessStatus: (
		status: WebProxyProtectedSpaceAccessStatus
	) => void;
	setLastStage: (stage: WebProxyStage) => void;
};

export async function executeObservedWebProxyRequest(input: {
	cloudflareRuntimeEvidence?: WebProxyCloudflareRuntimeEvidence;
	request: Request;
	proxyKind: WebProxyKind;
	execute: (context: ObservedWebProxyContext) => Promise<Response>;
}): Promise<Response> {
	const requestUrl = new URL(input.request.url);
	const correlation = await readWebProxyCorrelation({
		request: input.request,
		requestUrl,
	});
	const diagnosticsState: WebProxyDiagnosticsState = {
		clientMessageId: correlation.clientMessageId,
		webProxyRequestId: createWebProxyRequestId(),
		sourceSignalId: correlation.sourceSignalId,
		startedAtMs: Date.now(),
		method: input.request.method.toUpperCase(),
		path: requestUrl.pathname,
		proxyKind: input.proxyKind,
		targetProfileId: correlation.targetProfileId,
		upstreamUrl: null,
		upstreamRequestId: null,
		upstreamErrorCode: null,
		protectedSpaceAccessStatus: "not_applicable",
		lastStage: null,
	};
	const requestEvidence = readWebCloudflareRequestEvidence(
		input.request.headers
	);
	const recordAccountReadStage = () => {
		if (
			diagnosticsState.path !== ACCOUNT_ORGANIZATION_CONTEXT_PATH &&
			diagnosticsState.path !== ACCOUNT_SESSION_PATH
		) {
			return;
		}
		emitWebCloudflareRuntimeEvidence(input.cloudflareRuntimeEvidence, {
			...requestEvidence,
			event: "web.openmeld.proxy_stage",
			runtimeKind: "http",
			status: "started",
			method: diagnosticsState.method,
			route: diagnosticsState.path,
			requestId:
				requestEvidence.requestId ?? diagnosticsState.webProxyRequestId,
			reasonCode: diagnosticsState.lastStage ?? "request_received",
			durationMs: Date.now() - diagnosticsState.startedAtMs,
		});
	};
	recordAccountReadStage();

	const diagnosticsContext: ObservedWebProxyContext = {
		webProxyRequestId: diagnosticsState.webProxyRequestId,
		setUpstreamUrl: (upstreamUrl) => {
			diagnosticsState.upstreamUrl = upstreamUrl;
		},
		setUpstreamRequestId: (requestId) => {
			diagnosticsState.upstreamRequestId = normalizeOptionalText(requestId);
		},
		setUpstreamErrorCode: (errorCode) => {
			diagnosticsState.upstreamErrorCode = normalizeOptionalText(errorCode);
		},
		setProtectedSpaceAccessStatus: (status) => {
			diagnosticsState.protectedSpaceAccessStatus = status;
		},
		setLastStage: (stage) => {
			diagnosticsState.lastStage = stage;
			recordAccountReadStage();
		},
	};

	try {
		const response = await input.execute(diagnosticsContext);
		const responseWithDiagnostics = withWebProxyRequestIdHeader(
			observeMediaResponseBody({
				cloudflareRuntimeEvidence: input.cloudflareRuntimeEvidence,
				diagnosticsState,
				requestEvidence,
				response,
			}),
			diagnosticsState.webProxyRequestId
		);
		logWebProxyRecord({
			cloudflareRuntimeEvidence: input.cloudflareRuntimeEvidence,
			diagnosticsState,
			status: responseWithDiagnostics.status,
			requestEvidence: readWebCloudflareRequestEvidence(input.request.headers),
			requestId:
				readWebCloudflareRequestEvidence(responseWithDiagnostics.headers)
					.requestId ??
				diagnosticsState.upstreamRequestId ??
				diagnosticsState.webProxyRequestId,
		});
		return responseWithDiagnostics;
	} catch (error) {
		const requestId =
			diagnosticsState.upstreamRequestId ?? diagnosticsState.webProxyRequestId;
		const failureResponse = withWebProxyRequestIdHeader(
			createProxyErrorResponse({
				status: 502,
				code: "upstream_unreachable",
				message: buildProxyFailureMessage(diagnosticsState.proxyKind),
				requestId,
			}),
			diagnosticsState.webProxyRequestId
		);
		logWebProxyRecord({
			cloudflareRuntimeEvidence: input.cloudflareRuntimeEvidence,
			diagnosticsState,
			status: failureResponse.status,
			requestEvidence: readWebCloudflareRequestEvidence(input.request.headers),
			requestId,
			error,
		});
		return failureResponse;
	}
}

function createWebProxyRequestId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	return `webproxy-${Date.now().toString(36)}`;
}

function withWebProxyRequestIdHeader(
	response: Response,
	webProxyRequestId: string
): Response {
	const headers = new Headers(response.headers);
	headers.set(WEB_PROXY_REQUEST_ID_HEADER, webProxyRequestId);
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

const WEB_PROXY_MEDIA_DOWNLOAD_ROUTE_PATTERN =
	/^\/v1\/spaces\/[^/]+\/(?:attachments\/[^/]+|files\/[^/]+\/content)$/u;

// The request record's duration stops at the response headers, so a slow
// media body is invisible there. This record closes when the last byte
// reaches the client or the client stops reading, which separates a slow
// downstream link from a slow upstream.
function observeMediaResponseBody(input: {
	cloudflareRuntimeEvidence?: WebProxyCloudflareRuntimeEvidence;
	diagnosticsState: WebProxyDiagnosticsState;
	requestEvidence: ReturnType<typeof readWebCloudflareRequestEvidence>;
	response: Response;
}): Response {
	const { diagnosticsState, response } = input;
	if (
		!(input.cloudflareRuntimeEvidence && response.body) ||
		diagnosticsState.method !== "GET" ||
		response.status < 200 ||
		response.status >= 300 ||
		!WEB_PROXY_MEDIA_DOWNLOAD_ROUTE_PATTERN.test(diagnosticsState.path)
	) {
		return response;
	}
	const bodyStartedAtMs = Date.now();
	let bytes = 0;
	let recorded = false;
	const record = (
		outcome: "body_completed" | "body_cancelled" | "body_failed",
		error?: unknown
	) => {
		if (recorded) {
			return;
		}
		recorded = true;
		emitWebCloudflareRuntimeEvidence(input.cloudflareRuntimeEvidence, {
			event: "web.openmeld.proxy_response_body",
			runtimeKind: "http",
			status: outcome === "body_completed" ? "succeeded" : "failed",
			operation: buildWebProxyOperation(diagnosticsState),
			route: diagnosticsState.path,
			method: diagnosticsState.method,
			statusCode: response.status,
			durationMs: Date.now() - bodyStartedAtMs,
			inputBytes: bytes,
			reasonCode: outcome,
			errorName: resolveErrorName(error),
			cfRayId: input.requestEvidence.cfRayId,
			requestId:
				diagnosticsState.upstreamRequestId ??
				diagnosticsState.webProxyRequestId,
			traceId: input.requestEvidence.traceId,
			spaceId: readSpaceIdFromPath(diagnosticsState.path),
		});
	};
	// A pull source, unlike pipeThrough, tells an upstream read failure apart
	// from the client cancelling its download.
	const reader = response.body.getReader();
	const body = new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				let result: ReadableStreamReadResult<Uint8Array>;
				try {
					result = await reader.read();
				} catch (error) {
					record("body_failed", error);
					controller.error(error);
					return;
				}
				if (result.done) {
					record("body_completed");
					controller.close();
					return;
				}
				bytes += result.value.byteLength;
				controller.enqueue(result.value);
			},
			async cancel(reason) {
				record("body_cancelled");
				await reader.cancel(reason);
			},
		},
		{ highWaterMark: 0 }
	);
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}

function logWebProxyRecord(input: {
	cloudflareRuntimeEvidence?: WebProxyCloudflareRuntimeEvidence;
	diagnosticsState: WebProxyDiagnosticsState;
	status: number;
	requestEvidence: ReturnType<typeof readWebCloudflareRequestEvidence>;
	requestId: string | null;
	error?: unknown;
}): void {
	emitWebCloudflareRuntimeEvidence(input.cloudflareRuntimeEvidence, {
		event: "web.openmeld.proxy_request",
		runtimeKind: "http",
		status:
			input.error !== undefined || input.status >= 500 ? "failed" : "succeeded",
		operation: buildWebProxyOperation(input.diagnosticsState),
		route: input.diagnosticsState.path,
		method: input.diagnosticsState.method,
		statusCode: input.status,
		durationMs: Date.now() - input.diagnosticsState.startedAtMs,
		reasonCode: resolveWebProxyReasonCode(input),
		errorName: resolveErrorName(input.error),
		cfRayId: input.requestEvidence.cfRayId,
		requestId: input.requestId,
		traceId: input.requestEvidence.traceId,
		spaceId: readSpaceIdFromPath(input.diagnosticsState.path),
		clientMessageId: input.diagnosticsState.clientMessageId,
		sourceSignalId: input.diagnosticsState.sourceSignalId,
		targetProfileId: input.diagnosticsState.targetProfileId,
	});
}

function createProxyErrorResponse(input: {
	status: number;
	code: "upstream_unreachable";
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
	response.headers.set(OPENMELD_HEADER_REQUEST_ID, input.requestId);
	return response;
}

function buildProxyFailureMessage(proxyKind: WebProxyKind): string {
	if (proxyKind === "auth") {
		return "OpenMeld couldn't reach the auth upstream for this request.";
	}
	return "OpenMeld couldn't reach the gateway upstream for this request.";
}

function normalizeOptionalText(value: unknown): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

async function readWebProxyCorrelation(input: {
	request: Request;
	requestUrl: URL;
}): Promise<{
	clientMessageId: string | null;
	sourceSignalId: string | null;
	targetProfileId: string | null;
}> {
	const queryCorrelation = {
		clientMessageId: normalizeOptionalClientMessageId(
			input.requestUrl.searchParams.get("clientMessageId")
		),
		sourceSignalId: normalizeOptionalText(
			input.requestUrl.searchParams.get("sourceSignalId")
		),
		targetProfileId: normalizeOptionalText(
			input.requestUrl.searchParams.get("targetProfileId")
		),
	};
	if (input.request.body === null || !isJsonRequest(input.request)) {
		return queryCorrelation;
	}
	if (hasCompleteWebProxyCorrelation(queryCorrelation)) {
		return queryCorrelation;
	}

	const body = await readBoundedJsonObject(input.request);
	return {
		clientMessageId:
			queryCorrelation.clientMessageId ??
			normalizeOptionalClientMessageId(
				readNestedValue(body, ["meta", "clientMessageId"])
			) ??
			normalizeOptionalClientMessageId(
				readNestedValue(body, ["clientMessageId"])
			),
		sourceSignalId:
			queryCorrelation.sourceSignalId ??
			normalizeOptionalText(readNestedValue(body, ["sourceSignalId"])),
		targetProfileId:
			queryCorrelation.targetProfileId ??
			normalizeOptionalText(
				readNestedValue(body, ["messageEnvelope", "activationTargets", 0])
			),
	};
}

function hasCompleteWebProxyCorrelation(value: {
	clientMessageId: string | null;
	sourceSignalId: string | null;
	targetProfileId: string | null;
}): boolean {
	return (
		value.clientMessageId !== null &&
		value.sourceSignalId !== null &&
		value.targetProfileId !== null
	);
}

async function readBoundedJsonObject(request: Request): Promise<unknown> {
	try {
		if (!canReadJsonBodyWithinDeclaredBound(request)) {
			return null;
		}
		const bodyText = await readBoundedRequestBodyText(request);
		if (bodyText === null) {
			return null;
		}
		const body = JSON.parse(bodyText) as unknown;
		return body && typeof body === "object" ? body : null;
	} catch {
		return null;
	}
}

function canReadJsonBodyWithinDeclaredBound(request: Request): boolean {
	const contentLength = request.headers.get("content-length")?.trim();
	if (!contentLength) {
		return true;
	}
	const parsed = Number(contentLength);
	return (
		Number.isSafeInteger(parsed) &&
		parsed >= 0 &&
		parsed <= WEB_PROXY_CORRELATION_BODY_MAX_BYTES
	);
}

async function readBoundedRequestBodyText(
	request: Request
): Promise<string | null> {
	const body = request.clone().body;
	if (!body) {
		return null;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (!value) {
				continue;
			}
			byteLength += value.byteLength;
			if (byteLength > WEB_PROXY_CORRELATION_BODY_MAX_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	if (byteLength === 0) {
		return null;
	}

	const bodyBytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bodyBytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bodyBytes);
}

function readNestedValue(source: unknown, path: readonly (number | string)[]) {
	let current = source;
	for (const key of path) {
		if (current === null || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[key as string];
	}
	return current;
}

function isJsonRequest(request: Request): boolean {
	return (request.headers.get("content-type") ?? "")
		.toLowerCase()
		.includes("application/json");
}

function normalizeOptionalClientMessageId(value: unknown): string | null {
	const parsed = clientMessageIdSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function readSpaceIdFromPath(path: string): string | null {
	const parts = path.split("/").filter(Boolean);
	const spacesIndex = parts.indexOf("spaces");
	if (spacesIndex < 0) {
		return null;
	}
	return normalizeOptionalText(parts[spacesIndex + 1]);
}

function buildWebProxyOperation(
	diagnosticsState: WebProxyDiagnosticsState
): string {
	return `${diagnosticsState.proxyKind}.${diagnosticsState.lastStage ?? "unknown"}`;
}

function resolveWebProxyReasonCode(input: {
	diagnosticsState: WebProxyDiagnosticsState;
	error?: unknown;
	status: number;
}): string | null {
	if (input.error !== undefined) {
		return "web_proxy.upstream_unreachable";
	}
	if (
		isProtectedSpaceChallengeStatus(input.status) &&
		input.diagnosticsState.upstreamErrorCode === "space.password_required" &&
		input.diagnosticsState.protectedSpaceAccessStatus === "missing"
	) {
		return "web_proxy.protected_space_access_missing";
	}
	if (
		isProtectedSpaceChallengeStatus(input.status) &&
		(input.diagnosticsState.upstreamErrorCode === "space.password_invalid" ||
			input.diagnosticsState.protectedSpaceAccessStatus === "invalid")
	) {
		return "web_proxy.protected_space_access_invalid";
	}
	return input.status >= 400 ? `http_${input.status}` : null;
}

function isProtectedSpaceChallengeStatus(status: number): boolean {
	return status === 401 || status === 403;
}

function resolveErrorName(error: unknown): string | null {
	if (error instanceof Error) {
		return normalizeOptionalText(error.name) ?? "Error";
	}
	return error === undefined ? null : typeof error;
}
