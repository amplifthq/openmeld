import { describe, expect, it } from "vitest";
import { createSpaceLiveStreamUrl, parseSpaceLiveMessage } from "./live-stream";

describe("space live stream helpers", () => {
	it("builds a same-origin websocket url for the current space", () => {
		expect(
			createSpaceLiveStreamUrl({
				origin: "https://app.openmeld.test",
				spaceId: "space-123",
				profileId: "profile-123",
			})
		).toBe(
			"wss://app.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123"
		);
	});

	it("treats hello ack frames as live subscription readiness", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "system.hello.ack",
					profile: {
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
					},
				})
			)
		).toEqual({
			kind: "ready",
		});
	});

	it("parses signal envelopes", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					v: 1,
					id: "sig-1",
					spaceId: "space-123",
					ts: 10,
					profile: {
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
						profileName: "Mira",
					},
					type: "signal.text",
					data: {
						text: "Hello from the stream",
					},
				})
			)
		).toMatchObject({
			kind: "signal",
			history: null,
			signal: {
				id: "sig-1",
				type: "signal.text",
			},
			threadContext: null,
			threadPlacement: null,
		});
	});

	it("parses thread-aware signal frames without treating them as main timeline messages", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.signal",
					signal: {
						v: 1,
						id: "sig-thread-1",
						spaceId: "space-123",
						ts: 10,
						profile: {
							kind: "human",
							profileId: "11111111-1111-1111-1111-111111111111",
							profileName: "Mira",
						},
						type: "signal.text",
						data: {
							text: "Thread reply",
						},
					},
					history: {
						persisted: true,
					},
					threadContext: {
						threadId: "thr_11111111-1111-4111-8111-111111111111",
						rootSignalId: "sig-root-1",
					},
					threadPlacement: {
						threadId: "thr_11111111-1111-4111-8111-111111111111",
						signalId: "sig-thread-1",
						placement: "thread",
						createdAt: "2026-04-11T00:00:00.000Z",
					},
				})
			)
		).toMatchObject({
			kind: "signal",
			history: {
				persisted: true,
			},
			signal: {
				id: "sig-thread-1",
			},
			threadContext: {
				rootSignalId: "sig-root-1",
				threadId: "thr_11111111-1111-4111-8111-111111111111",
			},
			threadPlacement: {
				placement: "thread",
				signalId: "sig-thread-1",
			},
		});
	});

	it("parses live invalidation frames separately from timeline messages", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.members.changed",
					spaceId: "space-123",
					version: 101,
					profileIds: ["profile-1"],
					reason: "space.members.added",
				})
			)
		).toEqual({
			kind: "invalidation",
			frame: {
				type: "space.members.changed",
				spaceId: "space-123",
				version: 101,
				profileIds: ["profile-1"],
				reason: "space.members.added",
			},
		});
	});

	it("parses accumulated Center Agent stream snapshots with stable sequence identity", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.agent_stream_delta",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					sequence: 7,
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					textSnapshot: "Accumulated reply text",
					state: "streaming",
					updatedAtMs: 1_713_996_000_000,
				})
			)
		).toMatchObject({
			kind: "agent_stream",
			frame: {
				sequence: 7,
				streamId: "stream:submission-1",
				textSnapshot: "Accumulated reply text",
				type: "space.agent_stream_delta",
			},
		});
	});

	it("parses transient Center Agent thinking snapshots", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.agent_stream_delta",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					sequence: 6,
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					kind: "thinking",
					thinkingSnapshot: "Checking the current Space state",
					state: "streaming",
					updatedAtMs: 1_713_996_000_000,
				})
			)
		).toMatchObject({
			kind: "agent_stream",
			frame: {
				kind: "thinking",
				sequence: 6,
				thinkingSnapshot: "Checking the current Space state",
				type: "space.agent_stream_delta",
			},
		});
	});

	it("parses privacy-bounded Center Agent tool lifecycle parts", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.agent_stream_part",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					sequence: 8,
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					part: {
						type: "tool",
						toolCallId: "tool-call-1",
						toolName: "openmeld_list_spaces",
						state: "input-available",
					},
					updatedAtMs: 1_713_996_000_000,
				})
			)
		).toMatchObject({
			kind: "agent_stream",
			frame: {
				sequence: 8,
				part: { toolCallId: "tool-call-1", state: "input-available" },
				type: "space.agent_stream_part",
			},
		});
	});

	it("parses Center Agent stream terminal replacement frames", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					type: "space.agent_stream_terminal",
					v: 1,
					spaceId: "space-123",
					streamId: "stream:submission-1",
					sequence: 7,
					profileId: "agt_33333333-3333-4333-8333-333333333333",
					triggerMessageId: "signal-trigger-1",
					dispatchId: "dispatch-1",
					terminal: {
						kind: "stopped",
						reasonCode: "remote_agent.stopped",
						noticeText: "Center Agent stopped this reply.",
					},
					updatedAtMs: 1_713_996_000_001,
				})
			)
		).toMatchObject({
			kind: "agent_stream",
			frame: {
				streamId: "stream:submission-1",
				terminal: { kind: "stopped" },
				type: "space.agent_stream_terminal",
			},
		});
	});

	it("returns structured server errors from websocket frames", () => {
		expect(
			parseSpaceLiveMessage(
				JSON.stringify({
					error: "space.password_required",
					requestId: "req-space-stream-1",
				})
			)
		).toEqual({
			kind: "server_error",
			error: {
				error: "space.password_required",
				requestId: "req-space-stream-1",
			},
		});
	});
});
