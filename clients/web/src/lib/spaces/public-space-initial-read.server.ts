import { parseEnvelope } from "@openmeld/protocol";
import {
	getSpaceEntryResolutionResponseSchema,
	listSpaceThreadSignalsResponseSchema,
	spaceBootstrapResponseSchema,
	spaceHistoryNavigationSchema,
} from "@openmeld/schemas";
import type {
	GetSpaceEntryResolutionResponse,
	GetSpaceStatusResponse,
	ListSpaceThreadSignalsResponse,
	SignalEnvelope,
	SpaceHistoryNavigation,
	SpaceThread,
	SpaceThreadPreview,
} from "@openmeld/schemas/types";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { proxyOpenMeldGatewayRequest } from "#/lib/openmeld-api/proxy";
import { readJsonFromWebOpenMeldBoundary } from "#/lib/openmeld-api/server-read";

const PUBLIC_SIGNAL_LIMIT = 80;
const PUBLIC_ROUTE_FAMILY = "/spaces/:spaceId";

export type PublicSpaceInitialData = {
	entryResolution: GetSpaceEntryResolutionResponse;
	content?: {
		status: GetSpaceStatusResponse;
		signals: readonly SignalEnvelope[];
		nextCursor: string | null;
		threads: readonly SpaceThread[];
		threadPreviews: readonly SpaceThreadPreview[];
	};
	historyNavigation?: SpaceHistoryNavigation;
	threadSignals?: ListSpaceThreadSignalsResponse;
};

export async function readPublicSpaceInitialData(input: {
	spaceId: string;
	signalId?: string;
	threadRootSignalId?: string;
	gatewayUrl: string;
	webAppUrl: string;
	requestHeaders: Headers;
	proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
}): Promise<PublicSpaceInitialData> {
	const base = `/v1/spaces/${encodeURIComponent(input.spaceId)}`;
	const entrySearch = new URLSearchParams();
	if (input.signalId) {
		entrySearch.set("signalId", input.signalId);
	}
	if (input.threadRootSignalId) {
		entrySearch.set("threadRootSignalId", input.threadRootSignalId);
	}
	const entryResolution = await readBoundary({
		input,
		path: `${base}/entry-resolution?${entrySearch}`,
		operation: "resolve public Space entry",
		schema: getSpaceEntryResolutionResponseSchema,
		invalidMessage: "Invalid public Space entry response",
	});
	if (entryResolution.view.state !== "allowed") {
		return { entryResolution };
	}

	const anchorSignalId =
		entryResolution.target.threadRootSignalId ??
		entryResolution.target.signalId;
	const bootstrapSearch = new URLSearchParams({
		includeAgentReadiness: "false",
	});
	if (anchorSignalId) {
		bootstrapSearch.set("aroundSignalId", anchorSignalId);
		bootstrapSearch.set("beforeCount", "30");
		bootstrapSearch.set("afterCount", "30");
	} else {
		bootstrapSearch.set("limit", String(PUBLIC_SIGNAL_LIMIT));
		bootstrapSearch.set("recent", "1");
	}

	const [bootstrap, historyNavigation] = await Promise.all([
		readBoundary({
			input,
			path: `${base}/bootstrap?${bootstrapSearch}`,
			operation: "load public Space content",
			schema: spaceBootstrapResponseSchema,
			invalidMessage: "Invalid public Space content response",
		}),
		readBoundary({
			input,
			path: `${base}/history-navigation`,
			operation: "load public Space history navigation",
			schema: spaceHistoryNavigationSchema,
			invalidMessage: "Invalid public Space history navigation response",
		}),
	]);

	const threadRootSignalId = entryResolution.target.threadRootSignalId;
	const selectedThread = threadRootSignalId
		? bootstrap.threads.threads.find(
				(thread) => thread.rootSignalId === threadRootSignalId
			)
		: undefined;
	const threadSignals = selectedThread
		? await readBoundary({
				input,
				path: `${base}/threads/${encodeURIComponent(selectedThread.threadId)}/signals?includeWakeContinuation=conversation`,
				operation: "load public Space thread",
				schema: listSpaceThreadSignalsResponseSchema,
				invalidMessage: "Invalid public Space thread response",
			})
		: undefined;

	return {
		entryResolution,
		content: {
			status: bootstrap.status,
			signals: bootstrap.history.signals.flatMap((item) => {
				const envelope = parseEnvelope(item);
				return envelope ? [envelope] : [];
			}),
			nextCursor: bootstrap.history.nextCursor,
			threads: bootstrap.threads.threads,
			threadPreviews: bootstrap.threads.previews,
		},
		historyNavigation,
		...(threadSignals ? { threadSignals } : {}),
	};
}

export async function readPublicSpaceInitialDataFromRequest(input: {
	spaceId: string;
	signalId?: string;
	threadRootSignalId?: string;
	gatewayUrl: string;
	webAppUrl: string;
}): Promise<PublicSpaceInitialData> {
	return await readPublicSpaceInitialData({
		...input,
		requestHeaders: getRequestHeaders(),
	});
}

async function readBoundary<T>(input: {
	input: {
		gatewayUrl: string;
		webAppUrl: string;
		requestHeaders: Headers;
		proxyRequestImpl?: typeof proxyOpenMeldGatewayRequest;
	};
	path: string;
	operation: string;
	schema: Parameters<typeof readJsonFromWebOpenMeldBoundary<T>>[0]["schema"];
	invalidMessage: string;
}): Promise<T> {
	return await readJsonFromWebOpenMeldBoundary({
		currentUserSessionExpectation: "optional",
		gatewayUrl: input.input.gatewayUrl,
		webAppUrl: input.input.webAppUrl,
		requestHeaders: input.input.requestHeaders,
		routeFamily: PUBLIC_ROUTE_FAMILY,
		path: input.path,
		operation: input.operation,
		schema: input.schema,
		invalidMessage: input.invalidMessage,
		...(input.input.proxyRequestImpl
			? { proxyRequestImpl: input.input.proxyRequestImpl }
			: {}),
	});
}
