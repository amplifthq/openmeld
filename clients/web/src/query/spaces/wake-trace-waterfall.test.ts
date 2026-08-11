import { describe, expect, it, vi } from "vitest";
import {
	readSpaceWakeTraceWaterfall,
	spaceWakeTraceWaterfallQueryOptions,
} from "./wake-trace-waterfall";

const getWakeTraceWaterfallMock = vi.hoisted(() => vi.fn());
const createWebSpaceApiMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/spaces/api", () => ({
	createWebSpaceApi: (...args: Parameters<typeof createWebSpaceApiMock>) =>
		createWebSpaceApiMock(...args),
}));

describe("spaceWakeTraceWaterfallQueryOptions", () => {
	it("uses the target-scoped Wake trace waterfall key and explicit OpenMeld profile id", async () => {
		getWakeTraceWaterfallMock.mockResolvedValue({
			query: {
				spaceId: "space-123",
				clientMessageId: "client-message-1",
				sourceSignalId: null,
				targetProfileId: "agt-target-1",
			},
			items: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getWakeTraceWaterfall: getWakeTraceWaterfallMock,
		});

		const queryOptions = spaceWakeTraceWaterfallQueryOptions({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
			targetProfileId: "agt-target-1",
			openMeldProfileId: "profile-123",
			enabled: true,
		});
		const result = await readSpaceWakeTraceWaterfall({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
			targetProfileId: "agt-target-1",
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			"client_message",
			"client-message-1",
			"agt-target-1",
			"profile-123",
		]);
		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			openMeldProfileId: "profile-123",
		});
		expect(getWakeTraceWaterfallMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
			targetProfileId: "agt-target-1",
		});
		expect(result.query.targetProfileId).toBe("agt-target-1");
	});

	it("uses a source-level key when no target profile id is provided", () => {
		expect(
			spaceWakeTraceWaterfallQueryOptions({
				spaceId: "space-123",
				clientMessageId: "client-message-1",
				openMeldProfileId: "profile-123",
				enabled: true,
			}).queryKey
		).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			"client_message",
			"client-message-1",
			null,
			"profile-123",
		]);
	});

	it("keeps disabled ordinary message details from throwing without a selector", () => {
		const queryOptions = spaceWakeTraceWaterfallQueryOptions({
			spaceId: "space-123",
			openMeldProfileId: "profile-123",
			enabled: false,
		});

		expect(queryOptions.enabled).toBe(false);
		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			null,
			null,
			null,
			"profile-123",
		]);
	});

	it("uses a source-signal key and selector when no client message id is available", async () => {
		getWakeTraceWaterfallMock.mockResolvedValue({
			query: {
				clientMessageId: null,
				sourceSignalId: "sig-source-1",
				spaceId: "space-123",
				targetProfileId: null,
			},
			items: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getWakeTraceWaterfall: getWakeTraceWaterfallMock,
		});

		const queryOptions = spaceWakeTraceWaterfallQueryOptions({
			spaceId: "space-123",
			sourceSignalId: "sig-source-1",
			openMeldProfileId: "profile-123",
			enabled: true,
		});
		await readSpaceWakeTraceWaterfall({
			spaceId: "space-123",
			sourceSignalId: "sig-source-1",
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			"source_signal",
			"sig-source-1",
			null,
			"profile-123",
		]);
		expect(getWakeTraceWaterfallMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			sourceSignalId: "sig-source-1",
		});
	});

	it("sends only the selected selector when a Wake source has both client and signal ids", async () => {
		getWakeTraceWaterfallMock.mockResolvedValue({
			query: {
				clientMessageId: "client-message-1",
				sourceSignalId: null,
				spaceId: "space-123",
				targetProfileId: null,
			},
			items: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getWakeTraceWaterfall: getWakeTraceWaterfallMock,
		});

		const queryOptions = spaceWakeTraceWaterfallQueryOptions({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
			sourceSignalId: "sig-source-1",
			openMeldProfileId: "profile-123",
			enabled: true,
		});
		await readSpaceWakeTraceWaterfall({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
			sourceSignalId: "sig-source-1",
			openMeldProfileId: "profile-123",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			"client_message",
			"client-message-1",
			null,
			"profile-123",
		]);
		expect(getWakeTraceWaterfallMock).toHaveBeenCalledWith({
			spaceId: "space-123",
			clientMessageId: "client-message-1",
		});
	});

	it("passes a protected Space password without putting it in the query key", async () => {
		getWakeTraceWaterfallMock.mockResolvedValue({
			query: {
				clientMessageId: "client-message-1",
				sourceSignalId: null,
				spaceId: "space-123",
				targetProfileId: null,
			},
			items: [],
		});
		createWebSpaceApiMock.mockReturnValue({
			getWakeTraceWaterfall: getWakeTraceWaterfallMock,
		});

		const queryOptions = spaceWakeTraceWaterfallQueryOptions({
			openMeldProfileId: "profile-123",
			clientMessageId: "client-message-1",
			enabled: true,
			spaceId: "space-123",
			spacePassword: "protected-password",
		});
		await readSpaceWakeTraceWaterfall({
			openMeldProfileId: "profile-123",
			clientMessageId: "client-message-1",
			spaceId: "space-123",
			spacePassword: "protected-password",
		});

		expect(queryOptions.queryKey).toEqual([
			"spaces",
			"wake-trace-waterfall",
			"space-123",
			"client_message",
			"client-message-1",
			null,
			"profile-123",
		]);
		expect(getWakeTraceWaterfallMock).toHaveBeenCalledWith({
			clientMessageId: "client-message-1",
			spaceId: "space-123",
			spacePassword: "protected-password",
		});
	});
});
