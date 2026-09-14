import type {
	LocalAgentReasoningState,
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamPartFrame,
	SpaceAgentStreamSnapshot,
	SpaceAgentStreamTerminal,
	SpaceAgentStreamTerminalFrame,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	applySpaceConversationStreamFrame,
	clearSpaceConversationTransientStreams,
	listVisibleSpaceConversationStreams,
	reconcileSpaceConversationStreamSnapshots,
	type SpaceConversationStreamState,
} from "./conversation-stream";

describe("space conversation stream state", () => {
	it("clears the live tail on privacy disable without replacing the execution", () => {
		const frame = createThinkingDeltaFrame({
			sequence: 1,
			thinkingSnapshot: "Live reasoning",
		});
		const streaming = applySpaceConversationStreamFrame({
			current: [],
			frame,
			observedRevision: 1,
		});
		const disabled = applySpaceConversationStreamFrame({
			current: streaming,
			frame: {
				...frame,
				kind: "thinking",
				sequence: 2,
				thinkingSnapshot: "",
				reasoningState: { status: "disabled" },
			},
			observedRevision: 2,
		});
		expect(disabled[0]).toMatchObject({
			status: "streaming",
			reasoningState: { status: "disabled" },
		});
		expect(disabled[0]).not.toHaveProperty("thinking");
		expect(
			clearSpaceConversationTransientStreams(disabled)[0]
		).not.toHaveProperty("reasoningState");
	});
	it("keeps live thinking separate from reply text and drops it at terminal", () => {
		let state = applySpaceConversationStreamFrame({
			current: [],
			frame: createThinkingDeltaFrame({
				sequence: 1,
				thinkingSnapshot: "Checking the current Space state",
			}),
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 2, textSnapshot: "Done." }),
			observedRevision: 2,
		});

		expect(listVisibleSpaceConversationStreams(state)).toEqual([
			expect.objectContaining({
				sequence: 2,
				text: "Done.",
				thinking: "Checking the current Space state",
				thinkingActive: false,
			}),
		]);

		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createTerminalFrame({
				sequence: 2,
				terminal: {
					kind: "failed",
					noticeText: "Center Agent could not finish this reply.",
					reasonCode: "remote_agent.model_failed",
				},
			}),
			observedRevision: 3,
		});

		expect(listVisibleSpaceConversationStreams(state)[0]).not.toHaveProperty(
			"thinking"
		);
	});

	it("reconciles tool lifecycle parts and text on the same live stream", () => {
		let state = applySpaceConversationStreamFrame({
			current: [],
			frame: createPartFrame({ sequence: 1, state: "input-available" }),
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 2, textSnapshot: "Checking now." }),
			observedRevision: 2,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createPartFrame({ sequence: 3, state: "output-available" }),
			observedRevision: 3,
		});

		expect(listVisibleSpaceConversationStreams(state)).toEqual([
			expect.objectContaining({
				sequence: 3,
				text: "Checking now.",
				toolParts: [
					{
						type: "tool",
						toolCallId: "tool-call-1",
						toolName: "openmeld_list_spaces",
						state: "output-available",
						work: {
							v: 1,
							key: "spaces.read",
						},
					},
				],
			}),
		]);
	});

	it("bounds live work and drops internal tool-only parts", () => {
		let state: SpaceConversationStreamState = [];
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: {
				...createPartFrame({ sequence: 1, state: "output-error" }),
				part: {
					type: "tool",
					toolCallId: "codemode",
					toolName: "codemode",
					state: "output-error",
				},
			},
			observedRevision: 1,
		});

		for (let index = 0; index < 55; index += 1) {
			state = applySpaceConversationStreamFrame({
				current: state,
				frame: {
					...createPartFrame({
						sequence: index + 2,
						state: "output-available",
					}),
					part: {
						type: "tool",
						toolCallId: `tool-call-${String(index)}`,
						toolName: "openmeld_list_spaces",
						state: "output-available",
						work: {
							v: 1,
							key: "spaces.read",
						},
					},
				},
				observedRevision: index + 2,
			});
		}

		const [projection] = listVisibleSpaceConversationStreams(state);
		expect(projection?.toolParts).toHaveLength(50);
		expect(projection?.toolParts?.[0]?.toolCallId).toBe("tool-call-5");
		expect(
			projection?.toolParts?.some((part) => part.toolName === "codemode")
		).toBe(false);
	});

	it("does not let compatibility-only Plugin work consume the live work budget", () => {
		let state: SpaceConversationStreamState = [];
		for (let index = 0; index < 50; index += 1) {
			state = applySpaceConversationStreamFrame({
				current: state,
				frame: {
					...createPartFrame({
						sequence: index + 1,
						state: "output-available",
					}),
					part: {
						type: "tool",
						toolCallId: `legacy-connected-app-${String(index)}`,
						toolName: "openmeld_execute_app_action",
						state: "output-available",
						work: {
							v: 1,
							key: "connected_app.action.execute",
						},
					},
				},
				observedRevision: index + 1,
			});
		}
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: {
				...createPartFrame({ sequence: 51, state: "output-available" }),
				part: {
					type: "tool",
					toolCallId: "specific-work",
					toolName: "web_fetch",
					state: "output-available",
					work: {
						v: 1,
						key: "webpage.read",
						subject: {
							kind: "website",
							label: "docs.example.com",
						},
					},
				},
			},
			observedRevision: 51,
		});

		const [projection] = listVisibleSpaceConversationStreams(state);
		expect(projection?.toolParts).toEqual([
			expect.objectContaining({ toolCallId: "specific-work" }),
		]);
	});

	it("folds the same stream into one latest snapshot and ignores replayed or out-of-order frames", () => {
		let state: SpaceConversationStreamState = [];
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 1, textSnapshot: "Hel" }),
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 3, textSnapshot: "Hello there" }),
			observedRevision: 2,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 2, textSnapshot: "Hello" }),
			observedRevision: 3,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({ sequence: 3, textSnapshot: "Replay" }),
			observedRevision: 4,
		});

		expect(listVisibleSpaceConversationStreams(state)).toEqual([
			expect.objectContaining({
				sequence: 3,
				streamId: STREAM_ID,
				text: "Hello there",
				status: "streaming",
			}),
		]);
	});

	it.each<Exclude<SpaceAgentStreamTerminal, { kind: "final_message" }>>([
		{
			kind: "failed",
			reasonCode: "remote_agent.model_failed",
			noticeText: "Center Agent could not complete this reply.",
		},
		{
			kind: "stopped",
			reasonCode: "remote_agent.stopped",
			noticeText: "Center Agent stopped this reply.",
		},
		{
			kind: "completed_but_publish_failed",
			reasonCode: "remote_agent.callback_publish_failed",
			noticeText:
				"Center Agent finished the reply, but OpenMeld could not publish it here.",
		},
	])("replaces partial text with the $kind terminal notice and rejects a late delta", (terminal) => {
		let state = applySpaceConversationStreamFrame({
			current: [],
			frame: {
				...createDeltaFrame({
					sequence: 4,
					textSnapshot: "Unfinished partial text",
				}),
				replyThreadRootSignalId: "source-thread-root",
			},
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createTerminalFrame({ sequence: 4, terminal }),
			observedRevision: 2,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createDeltaFrame({
				sequence: 5,
				textSnapshot: "This arrived too late",
			}),
			observedRevision: 3,
		});

		expect(listVisibleSpaceConversationStreams(state)).toEqual([
			expect.objectContaining({
				reasonCode: terminal.reasonCode,
				replyThreadRootSignalId: "source-thread-root",
				status: terminal.kind,
				text: terminal.noticeText,
			}),
		]);
	});

	it("closes a successful stream instead of showing best-effort partial text", () => {
		let state = applySpaceConversationStreamFrame({
			current: [],
			frame: createDeltaFrame({
				sequence: 2,
				textSnapshot: "Best-effort partial",
			}),
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createTerminalFrame({
				sequence: 2,
				terminal: {
					kind: "final_message",
					publishedSignalId: "signal-final-1",
				},
			}),
			observedRevision: 2,
		});

		expect(listVisibleSpaceConversationStreams(state)).toEqual([]);
	});

	it("restores active streams from the companion read model without overwriting a newer live frame", () => {
		const restored = reconcileSpaceConversationStreamSnapshots({
			current: [],
			requestStartedRevision: 0,
			snapshots: [createSnapshot({ sequence: 2, textSnapshot: "Restored" })],
		});
		const live = applySpaceConversationStreamFrame({
			current: restored,
			frame: createDeltaFrame({ sequence: 4, textSnapshot: "New live text" }),
			observedRevision: 2,
		});
		const reconciled = reconcileSpaceConversationStreamSnapshots({
			current: live,
			requestStartedRevision: 1,
			snapshots: [createSnapshot({ sequence: 3, textSnapshot: "Stale read" })],
		});

		expect(listVisibleSpaceConversationStreams(reconciled)).toEqual([
			expect.objectContaining({
				sequence: 4,
				text: "New live text",
			}),
		]);
	});

	it("restores authoritative text behind a newer transient thinking frame", () => {
		const thinking = applySpaceConversationStreamFrame({
			current: [],
			frame: createThinkingDeltaFrame({
				sequence: 3,
				thinkingSnapshot: "Checking the current Space state",
				reasoningState: { status: "streaming", firstOutputMs: 1200 },
			}),
			observedRevision: 1,
		});
		const reconciled = reconcileSpaceConversationStreamSnapshots({
			current: thinking,
			requestStartedRevision: 0,
			snapshots: [
				createSnapshot({ sequence: 2, textSnapshot: "Restored reply text" }),
			],
		});

		expect(listVisibleSpaceConversationStreams(reconciled)).toEqual([
			expect.objectContaining({
				sequence: 3,
				text: "Restored reply text",
				thinking: "Checking the current Space state",
				thinkingActive: true,
				reasoningState: { status: "streaming", firstOutputMs: 1200 },
			}),
		]);
	});

	it("drops transient thinking and work when a live connection is replaced", () => {
		let state = applySpaceConversationStreamFrame({
			current: [],
			frame: createDeltaFrame({ sequence: 1, textSnapshot: "Working" }),
			observedRevision: 1,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createThinkingDeltaFrame({
				sequence: 2,
				thinkingSnapshot: "Private transient thought",
			}),
			observedRevision: 2,
		});
		state = applySpaceConversationStreamFrame({
			current: state,
			frame: createPartFrame({ sequence: 3, state: "input-available" }),
			observedRevision: 3,
		});

		const cleared = clearSpaceConversationTransientStreams(state);

		expect(listVisibleSpaceConversationStreams(cleared)).toEqual([
			expect.objectContaining({ sequence: 3, text: "Working" }),
		]);
		expect(listVisibleSpaceConversationStreams(cleared)[0]).not.toHaveProperty(
			"thinking"
		);
		expect(listVisibleSpaceConversationStreams(cleared)[0]).not.toHaveProperty(
			"toolParts"
		);
		const replayed = applySpaceConversationStreamFrame({
			current: cleared,
			frame: createThinkingDeltaFrame({
				sequence: 2,
				thinkingSnapshot: "Private transient thought",
			}),
			observedRevision: 4,
		});
		expect(replayed[0]).toMatchObject({
			sequence: 3,
			text: "Working",
			thinking: "Private transient thought",
			thinkingActive: false,
		});
		const disabled = applySpaceConversationStreamFrame({
			current: replayed,
			frame: {
				...createThinkingDeltaFrame({ sequence: 4, thinkingSnapshot: "" }),
				reasoningState: { status: "disabled" },
			},
			observedRevision: 5,
		});
		expect(
			applySpaceConversationStreamFrame({
				current: disabled,
				frame: createThinkingDeltaFrame({
					sequence: 2,
					thinkingSnapshot: "Private transient thought",
				}),
				observedRevision: 6,
			})
		).toEqual(disabled);
	});
});

const STREAM_ID = "stream:submission-1";
const PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

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
	reasoningState?: LocalAgentReasoningState;
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
		...(input.reasoningState ? { reasoningState: input.reasoningState } : {}),
		state: "streaming",
		updatedAtMs: 1000 + input.sequence,
	};
}

function createTerminalFrame(input: {
	sequence: number;
	terminal: SpaceAgentStreamTerminal;
}): SpaceAgentStreamTerminalFrame {
	return {
		type: "space.agent_stream_terminal",
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence: input.sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		terminal: input.terminal,
		updatedAtMs: 2000 + input.sequence,
	};
}

function createPartFrame(input: {
	sequence: number;
	state: "input-available" | "output-available" | "output-error";
}): SpaceAgentStreamPartFrame {
	return {
		type: "space.agent_stream_part",
		v: 1,
		spaceId: "space-123",
		streamId: STREAM_ID,
		sequence: input.sequence,
		profileId: PROFILE_ID,
		triggerMessageId: "signal-trigger-1",
		dispatchId: "dispatch-1",
		part: {
			type: "tool",
			toolCallId: "tool-call-1",
			toolName: "openmeld_list_spaces",
			state: input.state,
			work: {
				v: 1,
				key: "spaces.read",
			},
		},
		updatedAtMs: 1500 + input.sequence,
	};
}

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
