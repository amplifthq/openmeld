import type { SignalEnvelope } from "@openmeld/protocol";
import {
	AGENT_REPLY_FINAL_PURPOSE,
	AGENT_REPLYING_END_PURPOSE,
	AGENT_REPLYING_PURPOSE,
} from "@openmeld/schemas";
import {
	applyWakeProgressSignals,
	createWakeProgressItem,
} from "@openmeld/space";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { resolveSpaceActiveWakeTarget } from "#/components/spaces/space-active-wake-presentation";
import { SPACE_WAKE_PROGRESS_TIMEOUT_MS } from "#/lib/spaces/request-timeouts";
import { ROUTE_REVISIT_GC_TIME_MS } from "#/query/query-config";
import {
	hasSpaceWakeProgressOutcome,
	readSpaceWakeProgressSummaryItems,
	recordSpaceWakeProgressEvidence,
	setSpaceWakeProgressPresentationItems,
	spaceActiveWakeProgressSummaryQueryOptions,
	spaceWakeProgressPresentationQueryOptions,
} from "./active-wake-progress";

const getActiveWakeProgressMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: (
		...args: Parameters<typeof createWebSpaceApiMock>
	) => createWebSpaceApiMock(...args),
}));

describe("spaceActiveWakeProgressSummaryQueryOptions", () => {
	it("filters the person's Wakes on the server and shares Space invalidation without sharing cached results", async () => {
		getActiveWakeProgressMock.mockResolvedValue({ items: [] });
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
		});
		const common = {
			enabled: true,
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		};
		const all = spaceActiveWakeProgressSummaryQueryOptions(common);
		const own = spaceActiveWakeProgressSummaryQueryOptions({
			...common,
			sourceProfileId: "profile-123",
		});
		const requestClient = new QueryClient();
		await requestClient.fetchQuery(own);
		requestClient.clear();
		expect(getActiveWakeProgressMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				sourceProfileId: "profile-123",
				includePageInfo: true,
			})
		);
		const client = new QueryClient();
		client.setQueryData(all.queryKey, {
			presentationEpoch: "test",
			items: [],
			query: { spaceId: "space-123", targetProfileId: null },
		});
		client.setQueryData(own.queryKey, {
			presentationEpoch: "test",
			items: [],
			query: {
				spaceId: "space-123",
				targetProfileId: null,
				sourceProfileId: "profile-123",
			},
		});
		expect(client.getQueryCache().getAll()).toHaveLength(2);
		await client.invalidateQueries({ queryKey: all.queryKey });
		expect(client.getQueryState(own.queryKey)?.isInvalidated).toBe(true);
		client.clear();
	});
	it("keeps a cached summary for route returns and revalidates complete active controls", async () => {
		getActiveWakeProgressMock.mockResolvedValue({
			items: [],
			query: {
				spaceId: "space-123",
				targetProfileId: null,
			},
		});
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
		});

		const options = spaceActiveWakeProgressSummaryQueryOptions({
			enabled: true,
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		const requestClient = new QueryClient();
		await requestClient.fetchQuery(options);
		requestClient.clear();

		expect(options.queryKey).toEqual([
			"spaces",
			"active-wake-progress-summary",
			"space-123",
			"profile-123",
		]);
		expect(options.gcTime).toBe(ROUTE_REVISIT_GC_TIME_MS);
		expect(options.staleTime).toBe(0);
		expect(options.refetchOnMount).toBe("always");
		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getActiveWakeProgressMock).toHaveBeenCalledWith({
			includePageInfo: true,
			includePreviewText: true,
			includeSourceContext: true,
			includeTiming: true,
			includeWaitReason: true,
			includeDeviceWait: true,
			includeWakeStopEligibility: true,
			spaceId: "space-123",
			timeoutMs: SPACE_WAKE_PROGRESS_TIMEOUT_MS,
		});
	});
});

describe("Space Wake progress presentation cache", () => {
	it("shows the same working item synchronously when the conversation remounts", () => {
		const queryClient = new QueryClient();
		const options = spaceWakeProgressPresentationQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		const compactConversation = new QueryObserver(queryClient, options);
		const stopObservingCompactConversation = compactConversation.subscribe(
			() => undefined
		);
		const workingItem = createWakeProgressItem({
			clientMessageId: "client-message-123",
			dispatchId: null,
			phase: "request_sent",
			sourceSignalId: "signal-123",
			targetLabel: "Center Agent",
			targetProfileId: "agent-123",
			updatedAtMs: 1_775_000_000_000,
		});

		setSpaceWakeProgressPresentationItems({
			items: [workingItem],
			queryClient,
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
		});
		expect(compactConversation.getCurrentResult().data?.items).toEqual([
			workingItem,
		]);

		stopObservingCompactConversation();
		const fullConversation = new QueryObserver(queryClient, options);
		expect(fullConversation.getCurrentResult().data?.items).toEqual([
			workingItem,
		]);

		fullConversation.destroy();
		queryClient.clear();
	});
});

const scope = { spaceId: "space-123", openMeldProfileId: "viewer" };
function readPresentation(queryClient: QueryClient) {
	const presentation = queryClient.getQueryData(
		spaceWakeProgressPresentationQueryOptions(scope).queryKey
	);
	if (!presentation) {
		throw new Error("Expected the Space presentation cache");
	}
	return presentation;
}
function running(dispatchId: string | null = "A") {
	return createWakeProgressItem({
		clientMessageId: "request",
		dispatchId,
		phase: "running",
		sourceSignalId: "source",
		targetLabel: "Agent",
		targetProfileId: "agent",
		updatedAtMs: Date.now(),
	});
}
function finalSignal(): SignalEnvelope {
	return {
		v: 1,
		id: "final-A",
		spaceId: scope.spaceId,
		ts: Date.now(),
		type: "signal.text",
		profile: { kind: "agent", profileId: "agent", profileName: "Agent" },
		data: {
			text: "Done",
			meta: {
				purpose: AGENT_REPLY_FINAL_PURPOSE,
				dispatchId: "A",
				targetProfileId: "agent",
			},
			replyTo: {
				signalId: "source",
				profileId: "viewer",
				profileKind: "human",
				profileName: "Viewer",
				previewText: "Request",
			},
		},
	};
}

describe("accepted Wake outcomes", () => {
	it("does not infer completion from ordinary Agent text, an end-of-stream hint or missing messages", () => {
		const queryClient = new QueryClient();
		const a = running();
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: [a],
		});
		for (const purpose of [undefined, AGENT_REPLYING_END_PURPOSE]) {
			const signal: SignalEnvelope = {
				...finalSignal(),
				type: "signal.text",
				data: {
					text: "An update",
					meta: {
						purpose,
						dispatchId: "A",
						targetProfileId: "agent",
						transient: true,
					},
				},
			};
			recordSpaceWakeProgressEvidence({
				...scope,
				queryClient,
				signals: [signal],
			});
		}
		recordSpaceWakeProgressEvidence({ ...scope, queryClient, signals: [] });
		expect(readPresentation(queryClient).items).toEqual([a]);
		queryClient.clear();
	});
	it("survives Thread preview trimming and remounts, rejects late detail, transient and summary, and still targets a new execution", async () => {
		const queryClient = new QueryClient();
		const options = spaceWakeProgressPresentationQueryOptions(scope);
		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => undefined);
		const a = running();
		const b = running("B");
		let finish!: (response: {
			items: ReturnType<typeof running>[];
			query: { spaceId: string; targetProfileId: null };
		}) => void;
		getActiveWakeProgressMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
		});
		const request = queryClient.fetchQuery(
			spaceActiveWakeProgressSummaryQueryOptions({ ...scope, enabled: true })
		);
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: [a, b],
		});
		recordSpaceWakeProgressEvidence({
			...scope,
			queryClient,
			signals: [finalSignal()],
		});
		// The final is no longer part of either two-message preview or open Thread.
		recordSpaceWakeProgressEvidence({ ...scope, queryClient, signals: [] });
		unsubscribe();
		const reopened = new QueryObserver(queryClient, options);
		expect(
			reopened.getCurrentResult().data?.items.map((item) => item.dispatchId)
		).toEqual(["B"]);
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: [a, b],
		});
		const transient: SignalEnvelope = {
			...finalSignal(),
			id: "late-running-A",
			type: "signal.text",
			data: {
				text: "Working",
				meta: {
					purpose: AGENT_REPLYING_PURPOSE,
					dispatchId: "A",
					targetProfileId: "agent",
					sourceEventId: "source",
					transient: true,
				},
			},
		};
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: (items) =>
				applyWakeProgressSignals({ currentItems: items, signals: [transient] }),
		});
		finish({
			items: [a, b],
			query: { spaceId: scope.spaceId, targetProfileId: null },
		});
		const summary = await request;
		const presentation = readPresentation(queryClient);
		expect(presentation.items.map((item) => item.dispatchId)).toEqual(["B"]);
		// Reply-stream rendering uses this same accepted-outcome decision.
		expect(hasSpaceWakeProgressOutcome({ presentation, item: a })).toBe(true);
		expect(hasSpaceWakeProgressOutcome({ presentation, item: b })).toBe(false);
		const visible = readSpaceWakeProgressSummaryItems({
			presentation,
			summary,
		});
		expect(visible.map((item) => item.dispatchId)).toEqual(["B"]);
		expect(resolveSpaceActiveWakeTarget(visible)?.dispatchId).toBe("B");
		// Scope isolation: another viewer does not inherit these observations.
		setSpaceWakeProgressPresentationItems({
			...scope,
			openMeldProfileId: "other-viewer",
			queryClient,
			items: [a],
		});
		expect(
			queryClient.getQueryData(
				spaceWakeProgressPresentationQueryOptions({
					...scope,
					openMeldProfileId: "other-viewer",
				}).queryKey
			)?.items
		).toEqual([a]);
		reopened.destroy();
		queryClient.clear();
	});

	it.each([
		"replied",
		"failed",
		"stopped",
		"publication_unknown",
	] as const)("retains %s evidence after its visible detail is removed without inventing success", (phase) => {
		const queryClient = new QueryClient();
		const a = running();
		const terminal = createWakeProgressItem({ ...a, phase, terminal: true });
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: [terminal],
		});
		setSpaceWakeProgressPresentationItems({ ...scope, queryClient, items: [] });
		setSpaceWakeProgressPresentationItems({
			...scope,
			queryClient,
			items: [
				a,
				running("B"),
				{ ...a, dispatchId: "other", targetProfileId: "other-agent" },
			],
		});
		const state = readPresentation(queryClient);
		expect(state.items.map((item) => item.dispatchId)).toEqual(["B", "other"]);
		expect(state.terminalItems[0]?.phase).toBe(phase);
		queryClient.clear();
	});

	it("rejects a summary request from a retired presentation lifetime and accepts a fresh read", async () => {
		const queryClient = new QueryClient();
		let finish!: (value: unknown) => void;
		getActiveWakeProgressMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		createWebSpaceApiMock.mockReturnValue({
			getActiveWakeProgress: getActiveWakeProgressMock,
		});
		const summaryOptions = spaceActiveWakeProgressSummaryQueryOptions({
			...scope,
			enabled: true,
		});
		const pending = queryClient.fetchQuery(summaryOptions);
		recordSpaceWakeProgressEvidence({
			...scope,
			queryClient,
			signals: [finalSignal()],
		});
		// Exercise the same retirement boundary as query GC without wall-clock waits.
		const options = spaceWakeProgressPresentationQueryOptions(scope);
		queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
		finish({
			items: [running()],
			query: { spaceId: scope.spaceId, targetProfileId: null },
		});
		const oldSummary = await pending;
		const presentation = readPresentation(queryClient);
		expect(
			readSpaceWakeProgressSummaryItems({ presentation, summary: oldSummary })
		).toEqual([]);
		getActiveWakeProgressMock.mockResolvedValueOnce({
			items: [running("B")],
			query: { spaceId: scope.spaceId, targetProfileId: null },
		});
		const fresh = await queryClient.fetchQuery(summaryOptions);
		expect(
			readSpaceWakeProgressSummaryItems({ presentation, summary: fresh }).map(
				(item) => item.dispatchId
			)
		).toEqual(["B"]);
		queryClient.clear();
	});
});
