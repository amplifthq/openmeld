import type {
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamPartFrame,
	SpaceAgentStreamPresence,
	SpaceAgentStreamSnapshot,
} from "@openmeld/schemas/types";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceConversation } from "./use-space-conversation";

const requestJsonMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: vi.fn(() => ({
		requestJson: requestJsonMock,
	})),
}));

describe("useSpaceConversation", () => {
	beforeEach(() => {
		requestJsonMock.mockReset().mockResolvedValue({
			v: 1,
			spaceId: "space-123",
			streams: [],
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("seeds the temporary Center Agent bubble from the bootstrap snapshot without a companion request", () => {
		const { result, rerender } = renderHook(
			(props: { initialAgentStreams: readonly SpaceAgentStreamSnapshot[] }) =>
				useSpaceConversation({
					initialAgentStreams: props.initialAgentStreams,
					liveConnectionEpoch: 0,
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-4111-8111-111111111111",
				}),
			{
				initialProps: {
					initialAgentStreams: [] as readonly SpaceAgentStreamSnapshot[],
				},
			}
		);
		expect(result.current.agentStreamProjections).toEqual([]);

		rerender({
			initialAgentStreams: [
				createSnapshot({
					sequence: 6,
					textSnapshot: "Restored from bootstrap",
				}),
			],
		});

		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({
				sequence: 6,
				streamId: STREAM_ID,
				text: "Restored from bootstrap",
			}),
		]);
		expect(requestJsonMock).not.toHaveBeenCalled();
	});

	it("restores a thinking-only Agent row from bootstrap presence and keeps its start time", () => {
		const presence: SpaceAgentStreamPresence = {
			v: 1,
			spaceId: "space-123",
			streamId: STREAM_ID,
			sequence: 3,
			profileId: PROFILE_ID,
			triggerMessageId: "signal-trigger-1",
			dispatchId: "dispatch-1",
			state: "streaming",
			gapDetected: false,
			createdAtMs: 900,
			updatedAtMs: 1003,
			expiresAtMs: 1_801_000,
		};
		const { result, rerender } = renderHook(
			(props: {
				initialAgentStreamPresences: readonly SpaceAgentStreamPresence[];
			}) =>
				useSpaceConversation({
					initialAgentStreamPresences: props.initialAgentStreamPresences,
					initialAgentStreams: [],
					liveConnectionEpoch: 0,
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-4111-8111-111111111111",
				}),
			{
				initialProps: {
					initialAgentStreamPresences:
						[] as readonly SpaceAgentStreamPresence[],
				},
			}
		);

		act(() => {
			result.current.handleAgentStreamFrame(createPartFrame(3));
		});
		expect(result.current.agentStreamProjections[0]).toMatchObject({
			createdAtMs: 1003,
			sequence: 3,
		});

		rerender({ initialAgentStreamPresences: [presence] });

		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({
				createdAtMs: 900,
				sequence: 3,
				streamId: STREAM_ID,
				text: "",
				toolParts: [expect.objectContaining({ toolCallId: "tool-call-1" })],
			}),
		]);

		act(() => {
			result.current.handleAgentStreamFrame(createPartFrame(4));
		});

		expect(result.current.agentStreamProjections[0]).toMatchObject({
			createdAtMs: 900,
			sequence: 4,
		});
	});

	it("batches accumulated live snapshots and renders at most ten updates per second", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(Date.now()), 0)
		);
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			window.clearTimeout(handle);
		});

		const { result } = renderHook(() =>
			useSpaceConversation({
				initialAgentStreams: [],
				liveConnectionEpoch: 0,
				spaceId: "space-123",
				openMeldProfileId: "11111111-1111-4111-8111-111111111111",
			})
		);
		await act(async () => {
			await Promise.resolve();
		});

		act(() => {
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 1, textSnapshot: "H" })
			);
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 2, textSnapshot: "He" })
			);
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 3, textSnapshot: "Hello" })
			);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({ sequence: 3, text: "Hello" }),
		]);

		act(() => {
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 4, textSnapshot: "Hello there" })
			);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(99);
		});
		expect(result.current.agentStreamProjections[0]?.sequence).toBe(3);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2);
		});
		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({ sequence: 4, text: "Hello there" }),
		]);
	});

	it("keeps the latest thinking and text snapshots when both arrive in one render batch", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(Date.now()), 0)
		);
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			window.clearTimeout(handle);
		});
		const { result } = renderHook(() =>
			useSpaceConversation({
				initialAgentStreams: [],
				liveConnectionEpoch: 0,
				spaceId: "space-123",
				openMeldProfileId: "11111111-1111-4111-8111-111111111111",
			})
		);

		act(() => {
			result.current.handleAgentStreamFrame(
				createThinkingDeltaFrame({
					sequence: 1,
					thinkingSnapshot: "Checking the current Space state",
				})
			);
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 2, textSnapshot: "Done." })
			);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});

		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({
				sequence: 2,
				text: "Done.",
				thinking: "Checking the current Space state",
			}),
		]);
	});

	it("applies a pending text snapshot before an immediately rendered tool part", () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(Date.now()), 0)
		);
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			window.clearTimeout(handle);
		});
		const { result } = renderHook(() =>
			useSpaceConversation({
				initialAgentStreams: [],
				liveConnectionEpoch: 0,
				spaceId: "space-123",
				openMeldProfileId: "11111111-1111-4111-8111-111111111111",
			})
		);

		act(() => {
			result.current.handleAgentStreamFrame(
				createDeltaFrame({ sequence: 1, textSnapshot: "Checking" })
			);
			result.current.handleAgentStreamFrame(createPartFrame(2));
		});

		expect(result.current.agentStreamProjections).toEqual([
			expect.objectContaining({
				sequence: 2,
				text: "Checking",
				toolParts: [expect.objectContaining({ toolCallId: "tool-call-1" })],
			}),
		]);
	});

	it("clears transient thinking when the live connection is replaced", () => {
		vi.useFakeTimers();
		vi.setSystemTime(10_000);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			window.setTimeout(() => callback(Date.now()), 0)
		);
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			window.clearTimeout(handle);
		});
		const { result, rerender } = renderHook(
			(props: { liveConnectionEpoch: number }) =>
				useSpaceConversation({
					initialAgentStreams: [],
					liveConnectionEpoch: props.liveConnectionEpoch,
					spaceId: "space-123",
					openMeldProfileId: "11111111-1111-4111-8111-111111111111",
				}),
			{ initialProps: { liveConnectionEpoch: 0 } }
		);

		act(() => {
			result.current.handleAgentStreamFrame(
				createThinkingDeltaFrame({
					sequence: 3,
					thinkingSnapshot: "This belongs to the old socket",
				})
			);
		});
		act(() => {
			vi.runAllTimers();
		});
		expect(result.current.agentStreamProjections[0]).toHaveProperty("thinking");

		rerender({ liveConnectionEpoch: 1 });

		expect(result.current.agentStreamProjections[0]).not.toHaveProperty(
			"thinking"
		);
	});
});

const STREAM_ID = "stream:submission-1";
const PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

function createSnapshot(input: {
	sequence: number;
	textSnapshot: string;
}): SpaceAgentStreamSnapshot {
	return {
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence: input.sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		textSnapshot: input.textSnapshot,
		state: "streaming",
		gapDetected: false,
		createdAtMs: 900,
		updatedAtMs: 1000 + input.sequence,
		expiresAtMs: 1_801_000,
	};
}

function createDeltaFrame(input: {
	sequence: number;
	textSnapshot: string;
}): SpaceAgentStreamDeltaFrame {
	return {
		type: "space.agent_stream_delta",
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence: input.sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		textSnapshot: input.textSnapshot,
		state: "streaming",
		updatedAtMs: 1000 + input.sequence,
	};
}

function createThinkingDeltaFrame(input: {
	sequence: number;
	thinkingSnapshot: string;
}): SpaceAgentStreamDeltaFrame {
	return {
		type: "space.agent_stream_delta",
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence: input.sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		kind: "thinking",
		thinkingSnapshot: input.thinkingSnapshot,
		state: "streaming",
		updatedAtMs: 1000 + input.sequence,
	};
}

function createPartFrame(sequence: number): SpaceAgentStreamPartFrame {
	return {
		type: "space.agent_stream_part",
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		part: {
			type: "tool",
			toolCallId: "tool-call-1",
			toolName: "openmeld_list_spaces",
			state: "input-available",
			work: { key: "spaces.read", v: 1 },
		},
		updatedAtMs: 1000 + sequence,
	};
}
