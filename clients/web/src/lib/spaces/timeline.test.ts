import {
	AGENT_REPLY_FINAL_PURPOSE,
	AGENT_REPLYING_END_PURPOSE,
	DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
	DISPATCH_ACTIVITY_FAILED_PURPOSE,
	REMOTE_AGENT_FAILURE_PURPOSE,
} from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	SignalEnvelope,
	SpaceAgentActivity,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import type { SpaceConversationVisibleStreamProjection } from "./conversation-stream";
import { buildSpaceEphemeralActivityItems } from "./dispatch-activity";
import {
	buildSpaceLandingMembers,
	buildSpaceTimelineItems,
	getEarliestVisibleTimelineSignalId,
	isSpaceOutcomeNoticeItem,
	isSpaceTimelineCatchUpAnchorSignal,
	mergeSpaceTimelineEnvelopes,
} from "./timeline";

describe("space timeline helpers", () => {
	it("deduplicates envelopes by id and keeps them in ascending order", () => {
		const first = createTextSignal({
			id: "sig-2",
			ts: 20,
			text: "later",
		});
		const second = createTextSignal({
			id: "sig-1",
			ts: 10,
			text: "earlier",
		});

		const merged = mergeSpaceTimelineEnvelopes({
			current: [first],
			incoming: [second, first],
		});

		expect(merged.map((item) => item.id)).toEqual(["sig-1", "sig-2"]);
	});

	it("builds visible timeline rows and preserves reply previews", () => {
		const membersSnapshot = createMembersSnapshot();
		const first = createTextSignal({
			id: "sig-1",
			ts: 10,
			text: "First message",
		});
		const second = createTextSignal({
			id: "sig-2",
			ts: 20,
			text: "Second message",
			replyTo: {
				signalId: "sig-1",
				profileId: "11111111-1111-1111-1111-111111111111",
				profileKind: "human",
				profileName: "Mira",
				previewText: "First message",
			},
		});
		const hiddenPresence = createPresenceSignal({
			id: "sig-3",
			ts: 30,
			type: "presence.join",
		});

		const items = buildSpaceTimelineItems({
			envelopes: [first, second, hiddenPresence],
			membersSnapshot,
		});

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			id: "sig-1",
			text: "First message",
			actorName: "Mira",
			replyToSignalId: null,
		});
		expect(items[1]).toMatchObject({
			id: "sig-2",
			replyPreviewText: "First message",
			replyToProfileName: "Mira",
			replyToSignalId: "sig-1",
		});
	});

	it("preserves the local agent source without turning it into identity", () => {
		const [item] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-local-agent",
					meta: {
						centerAgentInteractionSource: {
							client: "codex",
							kind: "local_agent",
							sessionId: "codex-thread-1",
						},
					},
					text: "Continue the release investigation.",
					ts: 30,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(item?.centerAgentInteractionSource).toEqual({
			client: "codex",
			kind: "local_agent",
			sessionId: "codex-thread-1",
		});
		expect(item?.actorProfileId).toBe("11111111-1111-1111-1111-111111111111");
	});

	it("preserves the structured work state of a status signal", () => {
		const [item] = buildSpaceTimelineItems({
			envelopes: [createStatusSignal("needs_input")],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(item).toMatchObject({
			signalType: "signal.status",
			spaceStatus: "needs_input",
			text: "Please confirm the release window.",
		});
	});

	it("preserves a trusted Navigation Action on the timeline item", () => {
		const signal = createTextSignal({
			id: "sig-project-created",
			messageEnvelope: {
				activationTargets: [],
				navigationAction: {
					label: "Open this Project",
					target: { kind: "project", projectId: "project_123" },
					url: "http://localhost:5173/o/acme/projects/project_123",
				},
				referenceTargets: [],
				text: "Project created.",
			},
			text: "Project created.",
			ts: 10,
		});

		expect(
			buildSpaceTimelineItems({
				envelopes: [signal],
				membersSnapshot: createMembersSnapshot(),
			})[0]
		).toMatchObject({
			navigationAction: {
				label: "Open this Project",
				target: { kind: "project", projectId: "project_123" },
				url: "http://localhost:5173/o/acme/projects/project_123",
			},
		});
	});

	it("projects reply staleness only when the signal carries it", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-stale-reply",
					meta: {
						staleness: {
							newMessagesDuringComposition: 4,
						},
					},
					text: "Reply from earlier context",
					ts: 10,
				}),
				createTextSignal({
					id: "sig-current-reply",
					text: "Reply from current context",
					ts: 20,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]?.newMessagesDuringComposition).toBe(4);
		expect(items[1]?.newMessagesDuringComposition).toBeNull();
	});

	it("projects a server-authored conversation compaction checkpoint", () => {
		const [item] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-compacted-reply",
					meta: {
						conversationCompaction: {
							completedAtMs: 1_753_520_400_000,
							count: 1,
							v: 1,
						},
						purpose: AGENT_REPLY_FINAL_PURPOSE,
					},
					profile: {
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
					text: "I kept the important context and continued.",
					ts: 20,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(item?.conversationCompaction).toEqual({
			completedAtMs: 1_753_520_400_000,
			count: 1,
			v: 1,
		});
	});

	it("repairs a persisted profile-id placeholder from the canonical member snapshot", () => {
		const profileId = "agt_33333333-3333-3333-3333-333333333333";
		const [item] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-center-agent",
					profile: {
						kind: "agent",
						profileId,
						profileName: profileId,
					},
					text: "Created the Space.",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(item).toMatchObject({
			actorName: "Runner",
			actorProfileName: "Runner",
		});
	});

	it.each([
		{
			expectedAgentControllerRef: "builtin:claude",
			memberAgentControllerRef: "builtin:claude",
			name: "rebound",
		},
		{
			expectedAgentControllerRef: null,
			memberAgentControllerRef: null,
			name: "unbound",
		},
	])("uses the current $name member controller instead of a stale message snapshot", ({
		expectedAgentControllerRef,
		memberAgentControllerRef,
	}) => {
		const profileId = "agt_33333333-3333-3333-3333-333333333333";
		const [item] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-old-controller",
					profile: {
						agentControllerRef: "builtin:codex",
						kind: "agent",
						profileId,
						profileName: "Runner",
					},
					text: "Completed the task.",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot({
				runnerAgentControllerRef: memberAgentControllerRef,
			}),
		});

		expect(item?.actorAgentControllerRef).toBe(expectedAgentControllerRef);
	});

	it("treats a removed live member avatar as authoritative over the old message snapshot", () => {
		const [item] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-old-avatar",
					profile: {
						avatarUrl: "https://example.com/old-google-avatar.webp",
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
						profileName: "Mira",
					},
					text: "Hello",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot({ miraAvatarUrl: null }),
		});

		expect(item?.actorAvatarImageUrl).toBeNull();
	});

	it("projects message attachments and only uses blob previews for pending signals", () => {
		const attachment = {
			fileName: "diagram.png",
			height: 900,
			id: "attachment-diagram",
			mimeType: "image/png" as const,
			sizeBytes: 2048,
			width: 1200,
		};
		const pending = createTextSignal({
			attachments: [attachment],
			id: "pending:client-message-1",
			text: "Draft diagram",
			ts: 10,
		});
		const persisted = createTextSignal({
			attachments: [attachment],
			id: "signal-persisted",
			text: "Persisted diagram",
			ts: 20,
		});

		const items = buildSpaceTimelineItems({
			envelopes: [pending, persisted],
			membersSnapshot: createMembersSnapshot(),
			pendingAttachmentPreviewUrlsById: new Map([
				["attachment-diagram", "blob:diagram-preview"],
			]),
		});

		expect(items[0]).toMatchObject({
			attachments: [{ ...attachment, localPreviewUrl: "blob:diagram-preview" }],
			deliveryState: "pending",
			spaceId: "space-123",
		});
		expect(items[1]).toMatchObject({
			attachments: [{ ...attachment, localPreviewUrl: null }],
			deliveryState: "sent",
			spaceId: "space-123",
		});
	});

	it("projects a definitively failed local submission separately from pending delivery", () => {
		const [failed] = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "failed:client-message-1",
					text: "Message that did not send",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(failed).toMatchObject({
			deliveryState: "failed",
			text: "Message that did not send",
		});
	});

	it("materializes one temporary Center Agent bubble per stream id", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "signal-trigger-1",
					text: "Please summarize this.",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				createAgentStreamProjection({
					sequence: 4,
					text: "Here is the partial summary",
				}),
			],
		});

		expect(items).toHaveLength(2);
		expect(items[1]).toMatchObject({
			agentStreamState: {
				sequence: 4,
				status: "streaming",
				streamId: "stream:submission-1",
			},
			actorName: "Runner",
			id: "stream:submission-1",
			replyToSignalId: "signal-trigger-1",
			text: "Here is the partial summary",
		});
	});

	it("keeps a Thread stream out of the main conversation and in its Thread", () => {
		const rootSignal = createTextSignal({
			id: "signal-thread-root",
			text: "Start a Thread here.",
			ts: 10,
		});
		const threadMessage = createTextSignal({
			id: "signal-thread-message",
			text: "Can you reply in this Thread?",
			ts: 20,
		});
		const failedThreadStream = {
			...createAgentStreamProjection({
				sequence: 4,
				text: "Runner could not finish this reply.",
			}),
			reasonCode: "model.inventory_unavailable",
			status: "failed" as const,
			triggerMessageId: threadMessage.id,
		};

		const mainItems = buildSpaceTimelineItems({
			agentStreams: [failedThreadStream],
			agentStreamScope: { kind: "main" },
			envelopes: [rootSignal],
			membersSnapshot: createMembersSnapshot(),
		});
		const threadItems = buildSpaceTimelineItems({
			agentStreams: [failedThreadStream],
			agentStreamScope: {
				kind: "thread",
				rootSignalId: rootSignal.id,
			},
			envelopes: [rootSignal, threadMessage],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(mainItems.map((item) => item.id)).toEqual([rootSignal.id]);
		expect(threadItems.map((item) => item.id)).toEqual([
			rootSignal.id,
			threadMessage.id,
			failedThreadStream.streamId,
		]);
	});

	it("does not duplicate a main-conversation stream beside a Thread root", () => {
		const rootSignal = createTextSignal({
			id: "signal-thread-root",
			text: "This message owns the main-conversation Wake.",
			ts: 10,
		});
		const mainStream = {
			...createAgentStreamProjection({
				sequence: 2,
				text: "Working in the main conversation.",
			}),
			triggerMessageId: rootSignal.id,
		};

		const threadItems = buildSpaceTimelineItems({
			agentStreams: [mainStream],
			agentStreamScope: {
				kind: "thread",
				rootSignalId: rootSignal.id,
			},
			envelopes: [rootSignal],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(threadItems.map((item) => item.id)).toEqual([rootSignal.id]);
	});

	it("keeps tool-first streams renderable before any text arrives", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "signal-trigger-1",
					text: "Please run the check.",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				{
					...createAgentStreamProjection({
						sequence: 1,
						text: "",
					}),
					toolParts: [
						{
							type: "tool",
							toolCallId: "tool-call-1",
							toolName: "agent_run_command",
							state: "input-available",
						},
					],
				},
			],
		});

		expect(items).toHaveLength(2);
		expect(items[1]).toMatchObject({
			agentStreamState: {
				sequence: 1,
				status: "streaming",
				streamId: "stream:submission-1",
			},
			id: "stream:submission-1",
			replyToSignalId: "signal-trigger-1",
			text: "",
		});
	});

	it.each([
		"stream:submission-1",
		"local-agent:10:dispatch-1:9:attempt-1",
	])("replaces %s as soon as its durable reply arrives, before stream closure", (streamId) => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "signal-trigger-1",
					text: "Please summarize this.",
					ts: 10,
				}),
				createTextSignal({
					id: "signal-final-1",
					meta: {
						agentActivity: {
							v: 1,
							steps: [
								{
									toolName: "openmeld_read_space_context",
									state: "output-available",
								},
							],
							truncated: false,
						},
						...(streamId.startsWith("local-agent:")
							? {}
							: { clientMessageId: "submission-1" }),
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
						targetProfileId: "agt_33333333-3333-3333-3333-333333333333",
					},
					profile: {
						agentControllerConversationId: "submission-1",
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
					text: "Authoritative final summary",
					ts: 30,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				createAgentStreamProjection({
					streamId,
					sequence: 4,
					text: "Different best-effort partial",
				}),
			],
		});

		expect(items.map((item) => item.id)).toEqual([
			"signal-trigger-1",
			"signal-final-1",
		]);
		expect(items[1]).toMatchObject({
			agentActivity: {
				v: 1,
				steps: [
					{
						toolName: "openmeld_read_space_context",
						state: "output-available",
					},
				],
				truncated: false,
			},
			isAgentFinalReply: true,
			text: "Authoritative final summary",
		});
		expect(items[1]?.agentStreamState).toBeUndefined();
	});

	it("prefers the complete Agent Work Summary over legacy activity metadata", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "signal-final-1",
					meta: {
						agentActivity: {
							v: 1,
							steps: [
								{
									toolName: "openmeld_list_spaces",
									state: "output-available",
									work: { v: 1, key: "spaces.read" },
								},
							],
							truncated: false,
						},
						agentWorkSummary: {
							v: 1,
							steps: [
								{
									toolName: "openmeld_execute_app_action",
									state: "output-available",
									work: {
										v: 1,
										key: "connected_app.action.execute",
										subject: { kind: "connected_app", label: "Slack" },
									},
								},
							],
							truncated: false,
						},
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
					},
					profile: {
						agentControllerConversationId: "submission-1",
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
					text: "Done.",
					ts: 30,
				}),
			],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [],
		});

		expect(items[0]?.agentActivity).toMatchObject({
			steps: [
				{
					work: {
						key: "connected_app.action.execute",
						subject: { kind: "connected_app", label: "Slack" },
					},
				},
			],
		});
	});

	it.each([
		"streaming",
		"failed",
		"stopped",
	] as const)("replaces a %s native reply stream with its durable cancellation confirmation", (status) => {
		const stream = createAgentStreamProjection({
			sequence: 4,
			text: "Working…",
		});
		const stopped = createTextSignal({
			id: "signal-stopped-native",
			ts: 30,
			text: "This request was stopped.",
			profile: {
				kind: "agent",
				profileId: stream.profileId,
				profileName: "Runner",
			},
			meta: {
				clientMessageId: "submission-1",
				dispatchId: stream.dispatchId,
				errorCode: "remote_agent.execution_cancelled",
				purpose: REMOTE_AGENT_FAILURE_PURPOSE,
			},
		});
		const items = buildSpaceTimelineItems({
			envelopes: [stopped],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				status === "streaming"
					? stream
					: {
							...stream,
							status,
							reasonCode: "remote_agent.execution_cancelled",
						},
				{
					...stream,
					dispatchId: "dispatch-2",
					streamId: "stream:submission-2",
				},
			],
		});
		expect(
			items
				.filter((item) => item.agentStreamState)
				.map((item) => item.agentStreamState?.streamId)
		).toEqual(["stream:submission-2"]);
		expect(items.filter((item) => item.id === stopped.id)).toHaveLength(1);
	});

	it("lets a durable terminal notice replace the temporary stream notice for the same dispatch", () => {
		const durableNotice = {
			v: 1,
			id: "signal-terminal-1",
			spaceId: "space-123",
			ts: 30,
			profile: {
				kind: "system",
				profileId: "system",
				profileName: "OpenMeld",
			},
			type: "signal.system_notice",
			data: {
				noticeType: "terminal_failure",
				actorProfileId: "agt_33333333-3333-3333-3333-333333333333",
				dispatchId: "dispatch-1",
				reason: "remote_agent.model_failed",
				text: "Center Agent could not complete this reply.",
				generatedBy: "openmeld",
			},
		} as SignalEnvelope;
		const items = buildSpaceTimelineItems({
			envelopes: [durableNotice],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				{
					...createAgentStreamProjection({
						sequence: 4,
						text: "Center Agent could not complete this reply.",
					}),
					reasonCode: "remote_agent.model_failed",
					status: "failed",
				},
			],
		});

		expect(items.map((item) => item.id)).toEqual(["signal-terminal-1"]);
	});

	it("replaces a failed stream bubble with a durable notice that still resolves back to the trigger message for anchoring", () => {
		const triggerMessage = createTextSignal({
			id: "signal-trigger-1",
			text: "Please summarize this.",
			ts: 10,
		});
		const durableNotice = {
			v: 1,
			id: "signal-terminal-1",
			spaceId: "space-123",
			ts: 30,
			profile: {
				kind: "system",
				profileId: "system",
				profileName: "OpenMeld",
			},
			type: "signal.system_notice",
			data: {
				noticeType: "terminal_failure",
				actorProfileId: "agt_33333333-3333-3333-3333-333333333333",
				dispatchId: "dispatch-1",
				reason: "remote_agent.model_failed",
				reasonCode: "remote_agent.model_failed",
				failureStage: "execution",
				replyTo: {
					signalId: "signal-trigger-1",
					profileId: "11111111-1111-1111-1111-111111111111",
					profileKind: "human",
					profileName: "Mira",
					previewText: "Please summarize this.",
				},
				text: "Center Agent could not complete this reply.",
				generatedBy: "openmeld",
			},
		} as SignalEnvelope;

		const items = buildSpaceTimelineItems({
			envelopes: [triggerMessage, durableNotice],
			membersSnapshot: createMembersSnapshot(),
			agentStreams: [
				{
					...createAgentStreamProjection({
						sequence: 4,
						text: "Center Agent could not complete this reply.",
					}),
					reasonCode: "remote_agent.model_failed",
					status: "failed",
				},
			],
		});

		expect(items.map((item) => item.id)).toEqual([
			"signal-trigger-1",
			"signal-terminal-1",
		]);
		expect(items[1]).toMatchObject({
			replyToSignalId: "signal-trigger-1",
			systemNoticeFailureStage: "execution",
			systemNoticeReasonCode: "remote_agent.model_failed",
			systemNoticeType: "terminal_failure",
		});
	});

	it("parses reasonCode and failureStage off a system notice signal", () => {
		const notice = {
			v: 1,
			id: "signal-notice-1",
			spaceId: "space-123",
			ts: 10,
			profile: {
				kind: "system",
				profileId: "system",
				profileName: "OpenMeld",
			},
			type: "signal.system_notice",
			data: {
				noticeType: "wake_stopped",
				actorProfileId: "agt_33333333-3333-3333-3333-333333333333",
				dispatchId: "dispatch-1",
				reasonCode: "wake_stop.user_requested",
				text: "Wake was stopped for Runner.",
				generatedBy: "openmeld",
			},
		} as SignalEnvelope;

		const items = buildSpaceTimelineItems({
			envelopes: [notice],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			systemNoticeFailureStage: null,
			systemNoticeReasonCode: "wake_stop.user_requested",
			systemNoticeType: "wake_stopped",
		});
	});

	it("keeps reply preview context when the original message is not loaded", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-2",
					ts: 20,
					text: "Reply message",
					replyTo: {
						signalId: "sig-1",
						profileId: "11111111-1111-1111-1111-111111111111",
						profileKind: "human",
						profileName: "Mira",
						previewText: "First message",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			replyToSignalId: "sig-1",
			replyToProfileName: "Mira",
			replyPreviewText: "First message",
		});
	});

	it("projects Wake details pointers from source Wake messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-wake",
					ts: 10,
					text: "@runner(wake) @watcher(wake) status check",
					messageEnvelope: {
						activationTargets: [
							"agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
							"agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						],
						referenceTargets: [],
						text: "@runner(wake) @watcher(wake) status check",
					},
					meta: {
						clientMessageId: "client-message-1",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			agentControllerConversationId: null,
			agentWorkspace: null,
			wakeClientMessageId: "client-message-1",
			wakeSourceSignalId: "sig-wake",
			wakeTargetProfileIds: [
				"agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				"agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
			],
		});
	});

	it("preserves Agent Reference targets without inventing Wake details", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-reference",
					ts: 10,
					text: "@watcher context only",
					messageEnvelope: {
						activationTargets: [],
						referenceTargets: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
						text: "@watcher context only",
					},
					meta: {
						clientMessageId: "client-message-1",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			referenceTargetProfileIds: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
			wakeClientMessageId: null,
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		});
	});

	it("does not project agent session details from source Wake messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-agent-wake",
					ts: 10,
					text: "@watcher(wake) status check",
					messageEnvelope: {
						activationTargets: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
						referenceTargets: [],
						text: "@watcher(wake) status check",
					},
					meta: {
						clientMessageId: "client-message-1",
					},
					profile: {
						agentControllerConversationId: "session-from-source-wake",
						kind: "agent",
						profileId: "agt_runner",
						profileName: "Runner",
						workingDirectory: "/Users/felix/source-wake",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			agentControllerConversationId: null,
			agentWorkspace: null,
			wakeClientMessageId: "client-message-1",
			wakeSourceSignalId: "sig-agent-wake",
			wakeTargetProfileIds: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
		});
	});

	it("projects Wake details pointers from agent-authored source Wake messages without client ids", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-agent-wake",
					ts: 10,
					text: "@watcher(wake) status check",
					messageEnvelope: {
						activationTargets: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
						referenceTargets: [],
						text: "@watcher(wake) status check",
					},
					profile: {
						kind: "agent",
						profileId: "agt_runner",
						profileName: "Runner",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			wakeClientMessageId: null,
			wakeSourceSignalId: "sig-agent-wake",
			wakeTargetProfileIds: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
		});
	});

	it("does not project Wake details pointers for normal messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-normal",
					ts: 10,
					text: "Plain message",
					meta: {
						clientMessageId: "client-message-1",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			agentControllerConversationId: null,
			agentWorkspace: null,
			clientMessageId: "client-message-1",
			isAgentFinalReply: false,
			wakeClientMessageId: null,
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		});
	});

	it("does not treat final agent replies as source Wake messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-reply",
					ts: 10,
					text: "Done.",
					meta: {
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
						sourceClientMessageId: "client-message-1",
						targetProfileId: "agt_runner",
					},
					profile: {
						kind: "agent",
						profileId: "agt_runner",
						profileName: "Runner",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			agentControllerConversationId: null,
			agentWorkspace: null,
			isAgentFinalReply: true,
			wakeClientMessageId: null,
			wakeSourceSignalId: null,
			wakeTargetProfileIds: [],
		});
	});

	it("projects agent session details from final agent replies", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-reply",
					ts: 10,
					text: "Done.",
					meta: {
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
						sourceClientMessageId: "client-message-1",
						targetProfileId: "agt_runner",
					},
					profile: {
						agentControllerConversationId:
							"agent-session-1234567890abcdefghijklmnopqrstuvwxyz",
						kind: "agent",
						profileId: "agt_runner",
						profileName: "Runner",
						workingDirectory:
							"/Users/felix/projects/very/long/workspace/path/for/agent",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items[0]).toMatchObject({
			agentControllerConversationId:
				"agent-session-1234567890abcdefghijklmnopqrstuvwxyz",
			agentWorkspace:
				"/Users/felix/projects/very/long/workspace/path/for/agent",
			isAgentFinalReply: true,
			wakeClientMessageId: null,
			wakeTargetProfileIds: [],
		});
	});

	it("projects the routed computer name for agent messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-agent",
					profile: {
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
					text: "Done",
					ts: 10,
				}),
			],
			membersSnapshot: createMembersSnapshot({
				runnerRuntimeDeviceDisplayName: "Felix's composer",
			}),
		});

		expect(items[0]).toMatchObject({
			actorControllerDisplay: "Codex",
			actorRuntimeDeviceDisplayName: "Felix's composer",
		});
	});

	it("removes transient dispatch activity from the main timeline", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-1",
					text: "@runner(wake) status check",
					ts: 10,
				}),
				createTextSignal({
					id: "sig-2",
					text: "Dispatching to @runner...",
					ts: 11,
					meta: {
						dispatchId: "dispatch-1",
						purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
						targetMentionLabel: "runner",
						targetProfileId: "agt_runner",
						transient: true,
					},
					profile: {
						kind: "system",
						profileId: "openmeld-system",
						profileName: "OpenMeld System",
					},
				}),
				createTextSignal({
					id: "sig-3",
					text: "All good.",
					ts: 20,
					meta: {
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
					},
					profile: {
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items.map((item) => item.id)).toEqual(["sig-1", "sig-3"]);
		expect(items.map((item) => item.text)).toEqual([
			"@runner(wake) status check",
			"All good.",
		]);
	});

	it("keeps transient failed dispatch activity in Wake progress instead of the main timeline", () => {
		const failedSignal = createTextSignal({
			id: "sig-failed-dispatch",
			text: "Couldn't route @runner right now",
			ts: 1_713_996_000_000,
			meta: {
				dispatchId: "dispatch-1",
				errorCode: "profile.unbound",
				purpose: DISPATCH_ACTIVITY_FAILED_PURPOSE,
				targetMentionLabel: "runner",
				targetProfileId: "agt_runner",
				transient: true,
			},
			profile: {
				kind: "system",
				profileId: "openmeld-system",
				profileName: "OpenMeld System",
			},
		});

		const timelineItems = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "sig-user",
					text: "@runner(wake) status check",
					ts: 1_713_996_000_000 - 1,
				}),
				failedSignal,
			],
			membersSnapshot: createMembersSnapshot(),
		});
		const activityItems = buildSpaceEphemeralActivityItems({
			envelopes: [failedSignal],
			nowMs: 1_713_996_000_000,
		});

		expect(timelineItems.map((item) => item.id)).toEqual(["sig-user"]);
		expect(timelineItems.map((item) => item.text)).not.toContain(
			"Couldn't route @runner right now"
		);
		expect(activityItems).toEqual([
			expect.objectContaining({
				failureReasonCode: "profile.unbound",
				message:
					"No local agent has been selected to reply for this agent yet.",
				phase: "failed",
				targetProfileId: "agt_runner",
				terminal: true,
			}),
		]);
	});

	it("clears ephemeral dispatch activity after the final reply arrives", () => {
		const activities = buildSpaceEphemeralActivityItems({
			envelopes: [
				createTextSignal({
					id: "sig-1",
					text: "Dispatching to @runner...",
					ts: 10,
					meta: {
						dispatchId: "dispatch-1",
						purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
						transient: true,
					},
					profile: {
						kind: "system",
						profileId: "openmeld-system",
						profileName: "OpenMeld System",
					},
				}),
				createTextSignal({
					id: "sig-2",
					text: "@runner is replying...",
					ts: 11,
					meta: {
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLYING_END_PURPOSE,
						targetMentionLabel: "runner",
						targetProfileId: "agt_runner",
						transient: true,
					},
					profile: {
						kind: "system",
						profileId: "openmeld-system",
						profileName: "OpenMeld System",
					},
				}),
				createTextSignal({
					id: "sig-3",
					text: "All good.",
					ts: 20,
					meta: {
						dispatchId: "dispatch-1",
						purpose: AGENT_REPLY_FINAL_PURPOSE,
						targetProfileId: "agt_runner",
					},
					profile: {
						kind: "agent",
						profileId: "agt_33333333-3333-3333-3333-333333333333",
						profileName: "Runner",
					},
				}),
			],
			nowMs: 20,
		});

		expect(activities).toEqual([]);
	});

	it("keeps recent transient dispatch activity in Wake progress state", () => {
		const activities = buildSpaceEphemeralActivityItems({
			envelopes: [
				createTextSignal({
					id: "sig-1",
					text: "Dispatching to @runner...",
					ts: 1_713_996_000_000,
					meta: {
						dispatchId: "dispatch-1",
						purpose: DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
						targetMentionLabel: "runner",
						targetProfileId: "agt_runner",
						transient: true,
					},
					profile: {
						kind: "system",
						profileId: "openmeld-system",
						profileName: "OpenMeld System",
					},
				}),
			],
			nowMs: 1_713_996_000_500,
		});

		expect(activities).toEqual([
			{
				clientMessageId: null,
				dispatchId: "dispatch-1",
				failureReasonCode: null,
				message: "Wake request sent to @runner.",
				phase: "request_sent",
				sourceSignalId: null,
				targetLabel: "@runner",
				targetProfileId: "agt_runner",
				terminal: false,
				updatedAtMs: 1_713_996_000_000,
			},
		]);
	});

	it("returns the earliest visible timeline signal id", () => {
		const earliestVisibleSignalId = getEarliestVisibleTimelineSignalId([
			createPresenceSignal({
				id: "sig-0",
				ts: 5,
				type: "presence.join",
			}),
			createTextSignal({
				id: "sig-1",
				ts: 10,
				text: "First message",
			}),
			createTextSignal({
				id: "sig-2",
				ts: 20,
				text: "Second message",
			}),
		]);

		expect(earliestVisibleSignalId).toBe("sig-1");
	});

	it("keeps legacy live catch-up anchors on visible timeline signals", () => {
		expect(
			isSpaceTimelineCatchUpAnchorSignal(
				createTextSignal({
					id: "sig-1",
					ts: 10,
					text: "First message",
				})
			)
		).toBe(true);
		expect(
			isSpaceTimelineCatchUpAnchorSignal(
				createPresenceSignal({
					id: "sig-2",
					ts: 20,
					type: "presence.join",
				})
			)
		).toBe(false);
	});

	it("orders people as live humans, live agents, other humans, then other agents", () => {
		const result = buildSpaceLandingMembers({
			membersSnapshot: createMembersSnapshot(),
			limit: 3,
		});

		expect(result.visibleMembers.map((member) => member.profileName)).toEqual([
			"Mira",
			"Runner",
			"Alex",
		]);
		expect(result.overflowCount).toBe(1);
	});

	it("labels unavailable agent routes separately from offline agents", () => {
		const result = buildSpaceLandingMembers({
			membersSnapshot: createMembersSnapshot({
				unavailableWatcher: true,
			}),
			limit: 4,
		});

		expect(result.visibleMembers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					detail: "Reply route unavailable",
					profileName: "Watcher",
				}),
			])
		);
	});
});

describe("isSpaceOutcomeNoticeItem", () => {
	it("is true for terminal_failure and wake_stopped system notices", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createSystemNoticeSignal({
					id: "signal-failure",
					noticeType: "terminal_failure",
					text: "Codex could not reply.",
				}),
				createSystemNoticeSignal({
					id: "signal-stopped",
					noticeType: "wake_stopped",
					text: "Wake was stopped for Codex.",
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items.every((item) => isSpaceOutcomeNoticeItem(item))).toBe(true);
	});

	it("is false for stay_silent, policy_blocked, and ordinary messages", () => {
		const items = buildSpaceTimelineItems({
			envelopes: [
				createTextSignal({
					id: "signal-text-1",
					text: "Just chatting",
					ts: 5,
				}),
				createSystemNoticeSignal({
					id: "signal-stay-silent",
					noticeType: "stay_silent",
					text: "Codex chose not to reply.",
				}),
				createSystemNoticeSignal({
					id: "signal-policy-blocked",
					noticeType: "policy_blocked",
					text: "This Wake was blocked by policy.",
				}),
			],
			membersSnapshot: createMembersSnapshot(),
		});

		expect(items.some((item) => isSpaceOutcomeNoticeItem(item))).toBe(false);
	});
});

function createSystemNoticeSignal(input: {
	id: string;
	noticeType: string;
	text: string;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: 10,
		profile: {
			kind: "system",
			profileId: "system",
			profileName: "OpenMeld",
		},
		type: "signal.system_notice",
		data: {
			noticeType: input.noticeType,
			dispatchId: "dispatch-1",
			text: input.text,
			generatedBy: "openmeld",
		},
	} as SignalEnvelope;
}

function createMembersSnapshot(
	input: {
		miraAvatarUrl?: string | null;
		runnerAgentControllerRef?: string | null;
		runnerRuntimeDeviceDisplayName?: string;
		unavailableWatcher?: boolean;
	} = {}
): SpaceMembersSnapshot {
	return createSpaceMembersSnapshot({
		agents: [
			createAgentMember({
				agentControllerRef: input.runnerAgentControllerRef,
				profileId: "agt_33333333-3333-3333-3333-333333333333",
				profileName: "Runner",
				liveNow: true,
				runtimeDeviceDisplayName: input.runnerRuntimeDeviceDisplayName,
				wakeState: "wakeable",
			}),
			createAgentMember({
				profileId: "agt_44444444-4444-4444-4444-444444444444",
				wakeRouteEvidenceStatus: input.unavailableWatcher
					? "unavailable"
					: "offline",
				profileName: "Watcher",
				liveNow: false,
				wakeState: "offline",
			}),
		],
		generatedAt: "2026-04-11T00:00:00.000Z",
		humans: [
			createHumanMember({
				avatarUrl: input.miraAvatarUrl,
				profileId: "11111111-1111-1111-1111-111111111111",
				profileName: "Mira",
				liveNow: true,
			}),
			createHumanMember({
				profileId: "22222222-2222-2222-2222-222222222222",
				profileName: "Alex",
				liveNow: false,
			}),
		],
		spaceId: "space-123",
	});
}

function createAgentStreamProjection(input: {
	streamId?: string;
	sequence: number;
	text: string;
}): SpaceConversationVisibleStreamProjection {
	return {
		createdAtMs: 20,
		dispatchId: "dispatch-1",
		observedRevision: input.sequence,
		profileId: "agt_33333333-3333-3333-3333-333333333333",
		reasonCode: null,
		sequence: input.sequence,
		spaceId: "space-123",
		status: "streaming",
		streamId: input.streamId ?? "stream:submission-1",
		text: input.text,
		textSequence: input.sequence,
		triggerMessageId: "signal-trigger-1",
		updatedAtMs: 20 + input.sequence,
	};
}

function createHumanMember(input: {
	avatarUrl?: string | null;
	profileId: string;
	profileName: string;
	liveNow: boolean;
}): SpaceMembersSnapshot["humans"][number] {
	return createSpaceMemberHumanSnapshot({
		addedAt: "2026-04-11T00:00:00.000Z",
		...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
		createdAt: "2026-04-11T00:00:00.000Z",
		firstEnteredAt: null,
		lastEnteredAt: null,
		lastSeenAt: null,
		lastSeenLabel: null,
		liveNow: input.liveNow,
		memberSource: "joined_directly",
		memberSourceLabel: "Joined directly",
		ownerName: null,
		ownerUserId: null,
		profileId: input.profileId,
		profileName: input.profileName,
		updatedAt: "2026-04-11T00:00:00.000Z",
	});
}

function createAgentMember(input: {
	agentControllerRef?: string | null;
	wakeRouteEvidenceStatus?: "online" | "offline" | "unavailable";
	profileId: string;
	profileName: string;
	liveNow: boolean;
	runtimeDeviceDisplayName?: string;
	wakeState: "wakeable" | "offline";
}): SpaceMembersSnapshot["agents"][number] {
	const wakeRouteEvidenceStatus =
		input.wakeRouteEvidenceStatus ??
		(input.wakeState === "wakeable" ? "online" : "offline");
	let wakeabilityReasonCodes: NonNullable<
		Parameters<typeof createSpaceMemberAgentSnapshot>[0]
	>["wakeabilityReasonCodes"] = [];

	if (input.wakeState !== "wakeable") {
		wakeabilityReasonCodes =
			wakeRouteEvidenceStatus === "unavailable"
				? ["route.unavailable"]
				: ["profile.unbound"];
	}

	return createSpaceMemberAgentSnapshot({
		addedAt: "2026-04-11T00:00:00.000Z",
		addedByDisplayName: "Mira",
		addedByOwnerUserId: "user-mira",
		addedByProfileId: "11111111-1111-1111-1111-111111111111",
		agentControllerConversationId: null,
		agentControllerRef:
			input.agentControllerRef === undefined
				? "builtin:codex"
				: input.agentControllerRef,
		createdAt: "2026-04-11T00:00:00.000Z",
		daemonRouteStatus: wakeRouteEvidenceStatus,
		firstEnteredAt: null,
		lastEnteredAt: null,
		lastSeenAt: null,
		lastSeenLabel: null,
		liveNow: input.liveNow,
		memberSource: "added_by_member",
		memberSourceLabel: "Added by member",
		mentionAlias: null,
		ownerName: "Mira",
		ownerUserId: "user-mira",
		profileId: input.profileId,
		profileName: input.profileName,
		runtimeDeviceDisplayName: input.runtimeDeviceDisplayName,
		wakeState: input.wakeState,
		wakeabilityReasonCodes,
		wakeabilityReasonText:
			input.wakeState === "wakeable" ? "Available for Wake" : "Offline",
		wakeabilityStatus: input.wakeState === "wakeable" ? "ready" : "blocked",
		workingDirectory: null,
		updatedAt: "2026-04-11T00:00:00.000Z",
	});
}

function createTextSignal(input: {
	attachments?: Array<{
		fileName?: string;
		height?: number;
		id: string;
		mimeType: "image/jpeg" | "image/png";
		sizeBytes: number;
		width?: number;
	}>;
	id: string;
	messageEnvelope?: {
		activationTargets: string[];
		navigationAction?: {
			label: string;
			target:
				| { kind: "organization_app"; service: "github" }
				| { kind: "project"; projectId: string }
				| { kind: "projects" }
				| { kind: "space"; spaceId: string };
			url: string;
		};
		referenceTargets: string[];
		text: string;
	};
	ts: number;
	text: string;
	meta?: {
		agentActivity?: SpaceAgentActivity;
		agentWorkSummary?: SpaceAgentActivity;
		centerAgentInteractionSource?: {
			client: string;
			kind: "local_agent";
			sessionId?: string;
		};
		clientMessageId?: string;
		conversationCompaction?: {
			completedAtMs: number;
			count: number;
			v: 1;
		};
		dispatchId?: string;
		errorCode?: string;
		purpose?: string;
		sourceClientMessageId?: string;
		sourceEventId?: string;
		staleness?: {
			newMessagesDuringComposition: number;
		};
		targetMentionLabel?: string;
		targetProfileId?: string;
		targetProfileName?: string;
		transient?: true;
	};
	profile?: {
		agentControllerConversationId?: string;
		agentControllerRef?: string;
		avatarUrl?: string;
		kind: "human" | "agent" | "system";
		profileId: string;
		profileName: string;
		workingDirectory?: string;
	};
	replyTo?: SignalEnvelope["type"] extends never
		? never
		: {
				signalId: string;
				profileId: string;
				profileKind: "human" | "agent" | "system";
				profileName: string;
				previewText: string;
			};
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile:
			input.profile ??
			({
				kind: "human",
				profileId: "11111111-1111-1111-1111-111111111111",
				profileName: "Mira",
			} as const),
		type: "signal.text",
		data: {
			text: input.text,
			...(input.attachments ? { attachments: input.attachments } : {}),
			...(input.messageEnvelope
				? { messageEnvelope: input.messageEnvelope }
				: {}),
			...(input.meta ? { meta: input.meta } : {}),
			...(input.replyTo ? { replyTo: input.replyTo } : {}),
		},
	};
}

function createStatusSignal(
	status: "working" | "needs_input" | "done" | "blocked" | "handoff"
): SignalEnvelope {
	return {
		data: {
			actorProfileId: "agt_33333333-3333-3333-3333-333333333333",
			dispatchId: "dispatch-1",
			generatedBy: "openmeld",
			status,
			text: "Please confirm the release window.",
		},
		id: `status-${status}`,
		profile: {
			kind: "agent",
			profileId: "agt_33333333-3333-3333-3333-333333333333",
		},
		spaceId: "space-123",
		ts: 20,
		type: "signal.status",
		v: 1,
	};
}

function createPresenceSignal(input: {
	id: string;
	ts: number;
	type: "presence.join" | "presence.quit";
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "agent",
			profileId: "agt_33333333-3333-3333-3333-333333333333",
			profileName: "Runner",
		},
		type: input.type,
		data: {},
	};
}
