import { parseEnvelope } from "@openmeld/protocol";
import {
	catchupResponseSchema,
	getSpaceEntryResolutionResponseSchema,
	getSpaceStatusResponseSchema,
	listSpaceThreadSignalsResponseSchema,
	listSpaceThreadsResponseSchema,
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
	const signalsSearch = new URLSearchParams();
	if (anchorSignalId) {
		signalsSearch.set("aroundSignalId", anchorSignalId);
		signalsSearch.set("beforeCount", "30");
		signalsSearch.set("afterCount", "30");
	} else {
		signalsSearch.set("limit", String(PUBLIC_SIGNAL_LIMIT));
		signalsSearch.set("recent", "1");
	}

	const [status, history, threads, historyNavigation] = await Promise.all([
		readBoundary({
			input,
			path: `${base}/status`,
			operation: "load public Space status",
			schema: getSpaceStatusResponseSchema,
			invalidMessage: "Invalid public Space status response",
		}),
		readBoundary({
			input,
			path: `${base}/signals?${signalsSearch}`,
			operation: "load public Space messages",
			schema: catchupResponseSchema,
			invalidMessage: "Invalid public Space messages response",
		}),
		readBoundary({
			input,
			path: `${base}/threads`,
			operation: "load public Space Threads",
			schema: listSpaceThreadsResponseSchema,
			invalidMessage: "Invalid public Space Threads response",
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
		? threads.threads.find(
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
			status,
			signals: history.signals.flatMap((item) => {
				const envelope = parseEnvelope(item);
				return envelope ? [envelope] : [];
			}),
			nextCursor: history.nextCursor,
			threads: threads.threads,
			threadPreviews: threads.previews,
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
