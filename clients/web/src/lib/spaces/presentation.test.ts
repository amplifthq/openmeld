import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { buildSpaceMemberDirectory } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
	buildAnchoredSpaceOutcomeNoticesBySourceSignalId,
	buildSpaceConversationEntries,
	buildSpaceMemberDirectoryForStatusOrder,
	resolveSpaceMemberStatusBadgeDisplay,
	SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES,
	type SpaceConversationEntry,
} from "./presentation";
import type { SpaceTimelineItem } from "./timeline";

describe("space conversation presentation", () => {
	it("shows a recovered agent reply in the conversation while keeping its recovery linkage", () => {
		const source = createTimelineItem({ id: "source" });
		const recovered = createTimelineItem({
			id: "recovered",
			actorProfileKind: "agent",
			signalType: "signal.system_notice",
			systemNoticeType: "execution_recovery_completed",
			replyToSignalId: source.id,
			text: "Here is the saved answer.",
		});
		expect(
			buildSpaceConversationEntries({
				selfProfileId: "human",
				timelineItems: [source, recovered],
			})
		).toMatchObject([
			{ kind: "bubble_run" },
			{
				kind: "bubble_run",
				run: {
					items: [{ id: "recovered", text: "Here is the saved answer." }],
				},
			},
		]);
		expect(
			buildAnchoredSpaceOutcomeNoticesBySourceSignalId([source, recovered]).get(
				source.id
			)
		).toEqual([recovered]);
	});

	it("starts a new message run at each local calendar day", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 9, 23, 59).getTime(),
					id: "sig-before-midnight",
				}),
				createTimelineItem({
					createdAtMs: new Date(2026, 7, 10, 0, 1).getTime(),
					id: "sig-after-midnight",
				}),
			],
		});

		expect(entries).toMatchObject([
			{
				kind: "bubble_run",
				run: { items: [{ id: "sig-before-midnight" }] },
			},
			{
				kind: "bubble_run",
				run: { items: [{ id: "sig-after-midnight" }] },
			},
		]);
	});

	it("starts a new message run at an explicit conversation boundary", () => {
		const entries = buildSpaceConversationEntries({
			groupBoundarySignalIds: new Set(["sig-first-unread"]),
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({ id: "sig-seen" }),
				createTimelineItem({ createdAtMs: 2000, id: "sig-first-unread" }),
			],
		});

		expect(entries).toMatchObject([
			{ kind: "bubble_run", run: { items: [{ id: "sig-seen" }] } },
			{
				kind: "bubble_run",
				run: { items: [{ id: "sig-first-unread" }] },
			},
		]);
	});

	it("places a durable compaction marker immediately before the final reply and breaks message grouping", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					id: "sig-earlier-agent-reply",
					text: "I am still working from the same conversation.",
				}),
				createTimelineItem({
					actorName: "Center Agent",
					actorProfileId: "agent-profile-center",
					actorProfileKind: "agent",
					actorProfileName: "Center Agent",
					conversationCompaction: {
						completedAtMs: 2000,
						count: 1,
						v: 1,
					},
					createdAtMs: 2000,
					id: "sig-compacted-agent-reply",
					text: "I compacted the conversation and kept going.",
				}),
			],
		});

		expect(entries).toMatchObject([
			{
				kind: "bubble_run",
				run: {
					items: [{ id: "sig-earlier-agent-reply" }],
				},
			},
			{
				createdAtMs: 2000,
				id: "sig-compacted-agent-reply:conversation-compaction",
				kind: "conversation_compaction",
				marker: {
					completedAtMs: 2000,
					count: 1,
					v: 1,
				},
			},
			{
				kind: "bubble_run",
				run: {
					items: [{ id: "sig-compacted-agent-reply" }],
				},
			},
		]);
	});

	it("keeps terminal failure notices out of the main timeline when the failed Wake source message is loaded", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Codex Local Agent(wake) are you there?",
				}),
				createTimelineItem({
					createdAtMs: 2000,
					id: "sig-newer-message",
					text: "@Designer Agent(wake) @Codex(wake) check today's news",
				}),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 3000,
					id: "sig-wake-failure",
					replyPreviewText: "@Codex Local Agent(wake) are you there?",
					replyToProfileName: "Felix",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld could not wake Codex Local Agent because the local OpenMeld Service is not connected for the agent.",
				}),
			],
		});

		expect(readConversationEntryIds(entries)).toEqual([
			"sig-wake",
			"sig-newer-message",
		]);
	});

	it("keeps terminal failure system notices in normal order when the source message is not loaded", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					id: "sig-newer-message",
					text: "Newer loaded message",
				}),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 2000,
					id: "sig-wake-failure",
					replyToSignalId: "sig-not-loaded",
					signalType: "signal.system_notice",
					systemNoticeType: "terminal_failure",
					text: "OpenMeld could not wake Codex Local Agent.",
				}),
			],
		});

		expect(readConversationEntryIds(entries)).toEqual([
			"sig-newer-message",
			"sig-wake-failure",
		]);
	});

	it("also keeps an anchored wake_stopped notice out of the main timeline", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					id: "sig-wake",
					text: "@Codex Local Agent(wake) please investigate",
				}),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 2000,
					id: "sig-wake-stopped",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "wake_stopped",
					text: "Wake was stopped for Codex Local Agent.",
				}),
			],
		});

		expect(readConversationEntryIds(entries)).toEqual(["sig-wake"]);
	});

	it("keeps an unanchored wake_stopped notice in normal order, matching the head pre-agent stop gap", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({
					id: "sig-newer-message",
					text: "Newer loaded message",
				}),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 2000,
					id: "sig-wake-stopped",
					replyToSignalId: null,
					signalType: "signal.system_notice",
					systemNoticeType: "wake_stopped",
					text: "Wake was stopped before it reached the agent.",
				}),
			],
		});

		expect(readConversationEntryIds(entries)).toEqual([
			"sig-newer-message",
			"sig-wake-stopped",
		]);
	});

	it("never anchors stay_silent or policy_blocked notices, even with a loaded replyToSignalId", () => {
		const entries = buildSpaceConversationEntries({
			selfProfileId: "human-profile-1",
			timelineItems: [
				createTimelineItem({ id: "sig-wake", text: "@Codex(wake) go" }),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 2000,
					id: "sig-stay-silent",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "stay_silent",
					text: "Codex chose not to reply.",
				}),
				createTimelineItem({
					actorName: "OpenMeld System",
					actorProfileId: "openmeld-system",
					actorProfileKind: "system",
					actorProfileName: "OpenMeld System",
					createdAtMs: 3000,
					id: "sig-policy-blocked",
					replyToSignalId: "sig-wake",
					signalType: "signal.system_notice",
					systemNoticeType: "policy_blocked",
					text: "This Wake was blocked by policy.",
				}),
			],
		});

		expect(readConversationEntryIds(entries)).toEqual([
			"sig-wake",
			"sig-stay-silent",
			"sig-policy-blocked",
		]);
	});
});

describe("buildAnchoredSpaceOutcomeNoticesBySourceSignalId", () => {
	it("groups an anchored terminal_failure and wake_stopped notice under their shared source", () => {
		const wakeItem = createTimelineItem({
			id: "sig-wake",
			text: "@Codex(wake) @Designer(wake) go",
		});
		const failureNotice = createTimelineItem({
			actorProfileKind: "system",
			id: "sig-failure",
			replyToSignalId: "sig-wake",
			signalType: "signal.system_notice",
			systemNoticeType: "terminal_failure",
			text: "Codex could not reply.",
		});
		const stoppedNotice = createTimelineItem({
			actorProfileKind: "system",
			id: "sig-stopped",
			replyToSignalId: "sig-wake",
			signalType: "signal.system_notice",
			systemNoticeType: "wake_stopped",
			text: "Wake was stopped for Designer.",
		});

		const bySourceSignalId = buildAnchoredSpaceOutcomeNoticesBySourceSignalId([
			wakeItem,
			failureNotice,
			stoppedNotice,
		]);

		expect(bySourceSignalId.get("sig-wake")?.map((item) => item.id)).toEqual([
			"sig-failure",
			"sig-stopped",
		]);
	});

	it("returns an empty map when no notice anchors to a loaded source", () => {
		const bySourceSignalId = buildAnchoredSpaceOutcomeNoticesBySourceSignalId([
			createTimelineItem({ id: "sig-wake", text: "@Codex(wake) go" }),
			createTimelineItem({
				actorProfileKind: "system",
				id: "sig-failure",
				replyToSignalId: "sig-not-loaded",
				signalType: "signal.system_notice",
				systemNoticeType: "terminal_failure",
				text: "Codex could not reply.",
			}),
		]);

		expect(bySourceSignalId.size).toBe(0);
	});

	it("does not anchor stay_silent or policy_blocked notices", () => {
		const bySourceSignalId = buildAnchoredSpaceOutcomeNoticesBySourceSignalId([
			createTimelineItem({ id: "sig-wake", text: "@Codex(wake) go" }),
			createTimelineItem({
				actorProfileKind: "system",
				id: "sig-stay-silent",
				replyToSignalId: "sig-wake",
				signalType: "signal.system_notice",
				systemNoticeType: "stay_silent",
				text: "Codex chose not to reply.",
			}),
		]);

		expect(bySourceSignalId.size).toBe(0);
	});
});

describe("space member status presentation", () => {
	it("orders member directory sections by user-visible status", () => {
		const directory = buildSpaceMemberDirectoryForStatusOrder(
			buildSpaceMemberDirectory(
				createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							profileName: "A Offline Agent",
							profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
							agentWakeAvailability: { status: "offline_for_wake" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "B Unavailable Agent",
							profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
							agentWakeAvailability: {
								action: "check_status",
								badgeLabel: "Unavailable",
								category: "unavailable",
								isRefreshing: false,
								label: "Unavailable for Wake",
								phase: "unavailable",
								reasonCode: "agent_execution.unavailable",
								status: "unavailable_for_wake",
								summary: "This agent cannot reply right now.",
								tooltip: "Unavailable for Wake",
							},
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "C Available Agent",
							profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
							agentWakeAvailability: { status: "available_for_wake" },
						}),
					],
					humans: [
						createSpaceMemberHumanSnapshot({
							liveNow: false,
							profileName: "A Away Human",
							profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						}),
						createSpaceMemberHumanSnapshot({
							liveNow: true,
							profileName: "B Live Human",
							profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						}),
					],
				})
			)
		);

		expect(
			directory.sections[0]?.entries.map((entry) => entry.profileName)
		).toEqual(["C Available Agent", "B Unavailable Agent", "A Offline Agent"]);
		expect(
			directory.sections[1]?.entries.map((entry) => entry.profileName)
		).toEqual(["B Live Human", "A Away Human"]);
	});

	it("uses the same positive status badge model for live humans and available agents", () => {
		const directory = buildSpaceMemberDirectoryForStatusOrder(
			buildSpaceMemberDirectory(
				createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							profileName: "Available Agent",
							profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
							agentWakeAvailability: { status: "available_for_wake" },
						}),
					],
					humans: [
						createSpaceMemberHumanSnapshot({
							liveNow: true,
							profileName: "Live Human",
							profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						}),
					],
				})
			)
		);
		const agentBadge = resolveSpaceMemberStatusBadgeDisplay(
			readDirectoryEntry(directory, "agents", 0)
		);
		const humanBadge = resolveSpaceMemberStatusBadgeDisplay(
			readDirectoryEntry(directory, "humans", 0)
		);

		expect(agentBadge).toEqual(
			expect.objectContaining({
				className: SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES.positive,
				label: "Available",
			})
		);
		expect(humanBadge).toEqual(
			expect.objectContaining({
				className: SPACE_MEMBER_STATUS_BADGE_CLASS_NAMES.positive,
				label: "Live",
			})
		);
	});
});

function readDirectoryEntry(
	directory: ReturnType<typeof buildSpaceMemberDirectoryForStatusOrder>,
	sectionId: "agents" | "humans",
	index: number
) {
	const section = directory.sections.find((item) => item.id === sectionId);
	const entry = section?.entries[index];
	if (!entry) {
		throw new Error(`Missing ${sectionId} entry at index ${String(index)}.`);
	}
	return entry;
}

function readConversationEntryIds(
	entries: readonly SpaceConversationEntry[]
): readonly string[] {
	return entries.flatMap((entry) => {
		if (entry.kind === "system_event") {
			return [entry.item.id];
		}
		if (entry.kind === "conversation_compaction") {
			return [entry.id];
		}
		return entry.run.items.map((item) => item.id);
	});
}

function createTimelineItem(
	overrides: Partial<SpaceTimelineItem> = {}
): SpaceTimelineItem {
	return {
		attachments: [],
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Felix",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "human-profile-1",
		actorProfileKind: "human",
		actorProfileName: "Felix",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		clientMessageId: null,
		createdAtMs: 1000,
		deliveryState: "sent",
		id: "sig-1",
		newMessagesDuringComposition: null,
		spaceId: "space-1",
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		systemNoticeType: null,
		text: "Message",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
		...overrides,
	};
}
