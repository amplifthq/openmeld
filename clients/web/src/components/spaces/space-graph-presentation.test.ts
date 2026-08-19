import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildSpaceGraphPresentation } from "./space-graph-presentation";

describe("buildSpaceGraphPresentation", () => {
	it("projects ordinary messages and reply relationships without inventing work", () => {
		const source = buildTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "message-source",
			text: "Can you review this?",
		});
		const reply = buildTimelineItem({
			actorName: "Alex",
			actorProfileId: "profile-alex",
			id: "message-reply",
			replyToSignalId: source.id,
			text: "Yes — the contract looks sound.",
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map(),
			timelineItems: [source, reply],
		});

		expect(graph.nodes.map((node) => [node.id, node.kind])).toEqual([
			["message:message-source", "message"],
			["message:message-reply", "message"],
		]);
		expect(graph.edges).toEqual([
			expect.objectContaining({
				kind: "reply",
				source: "message:message-source",
				target: "message:message-reply",
			}),
		]);
	});

	it("connects each terminal result directly without redundant Wake cards", () => {
		const source = buildTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "message-source",
			text: "Compare the release options.",
			wakeTargetProfileIds: ["profile-codex", "profile-cursor"],
		});
		const codexReply = buildTimelineItem({
			actorName: "Codex",
			actorProfileId: "profile-codex",
			id: "message-codex",
			replyToSignalId: source.id,
			text: "I recommend the staged release.",
			wakeSourceSignalId: source.id,
		});
		const cursorFailure = buildTimelineItem({
			actorName: "OpenMeld",
			actorProfileId: "system",
			actorProfileKind: "system",
			id: "notice-cursor",
			replyToSignalId: source.id,
			signalType: "signal.system_notice",
			systemNoticeTargetProfileId: "profile-cursor",
			systemNoticeType: "terminal_failure",
			text: "Cursor could not participate because its plan limit was reached.",
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([
				["profile-codex", "Codex"],
				["profile-cursor", "Cursor"],
			]),
			profilePresentationsById: new Map([
				["profile-codex", buildProfilePresentation("profile-codex", "Codex")],
				[
					"profile-cursor",
					buildProfilePresentation("profile-cursor", "Cursor"),
				],
			]),
			timelineItems: [source, codexReply, cursorFailure],
		});

		expect(graph.nodes.filter((node) => node.kind === "wake")).toEqual([]);
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"message:message-source",
			"message:message-codex",
			"message:notice-cursor",
		]);
		expect(graph.nodes[2]).toEqual(
			expect.objectContaining({
				actorName: "Cursor",
				kind: "message",
				profilePresentation: expect.objectContaining({
					profileId: "profile-cursor",
				}),
			})
		);
		expect(graph.edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "result",
					source: "message:message-source",
					target: "message:message-codex",
				}),
				expect.objectContaining({
					kind: "result",
					source: "message:message-source",
					target: "message:notice-cursor",
				}),
			])
		);
	});

	it("keeps a terminal failure attached to its target Agent while profile artwork is unavailable", () => {
		const source = buildTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-cursor"],
		});
		const failure = buildTimelineItem({
			actorName: "OpenMeld System",
			actorProfileId: "system",
			actorProfileKind: "system",
			id: "notice-cursor",
			replyToSignalId: source.id,
			signalType: "signal.system_notice",
			systemNoticeTargetProfileId: "profile-cursor",
			systemNoticeType: "terminal_failure",
			text: "Cursor could not reply.",
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([["profile-cursor", "Cursor"]]),
			timelineItems: [source, failure],
		});

		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				actorName: "Cursor",
				actorProfileKind: "agent",
				id: "message:notice-cursor",
				profilePresentation: null,
			})
		);
	});

	it("keeps an explicit silent outcome distinct from a missing result", () => {
		const source = buildTimelineItem({
			id: "message-source",
			wakeTargetProfileIds: ["profile-claude", "profile-opencode"],
		});
		const silent = buildTimelineItem({
			actorProfileId: "system",
			actorProfileKind: "system",
			id: "notice-silent",
			replyToSignalId: source.id,
			signalType: "signal.system_notice",
			systemNoticeTargetProfileId: "profile-claude",
			systemNoticeType: "stay_silent",
			text: "Claude chose not to reply.",
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([
				["profile-claude", "Claude"],
				["profile-opencode", "OpenCode"],
			]),
			timelineItems: [source, silent],
		});

		expect(graph.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "message:notice-silent" }),
				expect.objectContaining({
					id: "wake:message-source:profile-opencode",
					status: "requested",
				}),
			])
		);
		expect(graph.nodes).not.toContainEqual(
			expect.objectContaining({ id: "wake:message-source:profile-claude" })
		);
	});

	it("links an Agent reply to its incoming Wake when that reply starts another Wake", () => {
		const source = buildTimelineItem({
			actorName: "Felix",
			actorProfileId: "profile-felix",
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const codexReplyAndHandoff = buildTimelineItem({
			actorName: "Codex",
			actorProfileId: "profile-codex",
			id: "message-codex",
			replyToSignalId: source.id,
			wakeSourceSignalId: "message-codex",
			wakeTargetProfileIds: ["profile-claude"],
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([
				["profile-codex", "Codex"],
				["profile-claude", "Claude"],
			]),
			timelineItems: [source, codexReplyAndHandoff],
		});

		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				kind: "result",
				source: "message:message-source",
				target: "message:message-codex",
			})
		);
		expect(graph.edges).not.toContainEqual(
			expect.objectContaining({
				source: "message:message-codex",
				target: "message:message-codex",
			})
		);
		expect(graph.nodes).not.toContainEqual(
			expect.objectContaining({ id: "wake:message-source:profile-codex" })
		);
	});

	it.each([
		["streaming", "working"],
		["failed", "awaiting_outcome"],
		["stopped", "awaiting_outcome"],
		["completed_but_publish_failed", "posting"],
	] as const)("projects an Agent stream in %s state as %s instead of a successful reply", (streamStatus, expectedWakeStatus) => {
		const source = buildTimelineItem({
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const stream = buildTimelineItem({
			actorProfileId: "profile-codex",
			agentStreamState: {
				reasonCode: null,
				sequence: 1,
				status: streamStatus,
				streamId: "stream-codex",
			},
			id: "stream-codex",
			replyToSignalId: source.id,
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([["profile-codex", "Codex"]]),
			timelineItems: [source, stream],
		});

		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: "wake:message-source:profile-codex",
				status: expectedWakeStatus,
			})
		);
		expect(graph.nodes).not.toContainEqual(
			expect.objectContaining({ id: "message:stream-codex" })
		);
		expect(graph.edges).not.toContainEqual(
			expect.objectContaining({ target: "message:stream-codex" })
		);
	});

	it("updates an active Wake card from live progress", () => {
		const source = buildTimelineItem({
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-codex"],
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([["profile-codex", "Codex"]]),
			timelineItems: [source],
			wakeProgressItems: [
				{
					clientMessageId: null,
					dispatchId: "dispatch-codex",
					message: "Codex is reviewing the release.",
					phase: "running",
					sourceSignalId: source.id,
					targetLabel: "Codex",
					targetProfileId: "profile-codex",
					terminal: false,
					updatedAtMs: 2,
				},
			],
		});

		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: "wake:message-source:profile-codex",
				status: "working",
			})
		);
	});

	it.each([
		["working", "working"],
		["needs_input", "needs_input"],
	] as const)("keeps a durable active %s status on the Wake card", (spaceStatus, expectedWakeStatus) => {
		const source = buildTimelineItem({
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const status = buildTimelineItem({
			actorProfileId: "profile-codex",
			id: `status-${spaceStatus}`,
			replyToSignalId: source.id,
			signalType: "signal.status",
			spaceStatus,
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([["profile-codex", "Codex"]]),
			timelineItems: [source, status],
		});

		expect(graph.nodes).toContainEqual(
			expect.objectContaining({
				id: "wake:message-source:profile-codex",
				status: expectedWakeStatus,
			})
		);
		expect(graph.nodes).not.toContainEqual(
			expect.objectContaining({ id: `message:status-${spaceStatus}` })
		);
	});

	it.each([
		"done",
		"blocked",
		"handoff",
	] as const)("connects a durable terminal %s status directly", (spaceStatus) => {
		const source = buildTimelineItem({
			actorProfileKind: "human",
			id: "message-source",
			wakeTargetProfileIds: ["profile-codex"],
		});
		const status = buildTimelineItem({
			actorProfileId: "profile-codex",
			id: `status-${spaceStatus}`,
			replyToSignalId: source.id,
			signalType: "signal.status",
			spaceStatus,
			wakeSourceSignalId: source.id,
		});

		const graph = buildSpaceGraphPresentation({
			profileNamesById: new Map([["profile-codex", "Codex"]]),
			timelineItems: [source, status],
		});

		expect(graph.nodes).not.toContainEqual(
			expect.objectContaining({ id: "wake:message-source:profile-codex" })
		);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				kind: "result",
				source: "message:message-source",
				target: `message:status-${spaceStatus}`,
			})
		);
	});
});

function buildTimelineItem(
	overrides: Partial<SpaceTimelineItem>
): SpaceTimelineItem {
	return {
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Agent",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "profile-agent",
		actorProfileKind: "agent",
		actorProfileName: "Agent",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: 1,
		deliveryState: "sent",
		id: "message-1",
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: "space-1",
		systemNoticeType: null,
		text: "Hello",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...overrides,
	};
}

function buildProfilePresentation(profileId: string, profileName: string) {
	return {
		agentControllerRef: null,
		avatarImageUrl: null,
		isCenterAgent: false,
		profileId,
		profileKind: "agent" as const,
		profileName,
	};
}
