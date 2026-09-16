import type { WakeProgressItem } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildActiveWakeConversationItems } from "./active-wake-conversation";
import type { SpaceTimelineItem } from "./timeline";

describe("active Wake conversation placement", () => {
	it.each([
		"request",
		null,
	] as const)("follows the selected reply destination (%s), not the source", (replyThreadRootSignalId) => {
		const source = message("request", 100);
		const progress = wake(source);
		const agentStreams = [
			{
				dispatchId: "dispatch:request",
				profileId: "agent",
				triggerMessageId: source.id,
				replyThreadRootSignalId,
				createdAtMs: 100,
				updatedAtMs: 200,
				observedRevision: 1,
				sequence: 1,
				spaceId: "space",
				streamId: "stream",
				status: "streaming" as const,
				reasonCode: null,
				text: "",
				textSequence: 0,
			},
		];
		for (const threadId of [null, "thread"]) {
			const items = buildActiveWakeConversationItems({
				timelineItems: [source],
				activityItems: [progress],
				agentStreams,
				threadId,
				threadRootSignalId: "request",
				profileEntriesById: new Map(),
				spaceId: "space",
			});
			expect(items.filter((item) => item.activeWakeProgress)).toHaveLength(
				(
					replyThreadRootSignalId === null
						? threadId === null
						: threadId === "thread"
				)
					? 1
					: 0
			);
		}
	});
	it("keeps concurrent Wakes after new messages and releases replies in publication order", () => {
		const first = message("request-1", 100);
		const second = message("request-2", 200);
		const later = message("teammate-message", 300);
		const progress = [wake(second), wake(first)];
		const before = present([first, second, later], progress);
		expect(before.map((item) => item.id)).toEqual([
			first.id,
			second.id,
			later.id,
			"active-wake:request-1:agent",
			"active-wake:request-2:agent",
		]);
		const stream = {
			...message("stream", 210),
			actorProfileKind: "agent" as const,
			actorProfileId: "agent",
			replyToSignalId: second.id,
			agentStreamState: {
				reasonCode: null,
				sequence: 1,
				status: "streaming" as const,
				streamId: "stream",
			},
			text: "Public reply in progress",
		};
		const streaming = present([first, second, stream, later], progress);
		expect(streaming.map((item) => item.id)).toEqual([
			first.id,
			second.id,
			later.id,
			"active-wake:request-1:agent",
			"stream",
		]);
		expect(streaming.at(-1)?.activeWakeProgress).toBe(progress[0]);
		const final = {
			...message("reply-2", 400),
			actorProfileKind: "agent" as const,
			actorProfileId: "agent",
			replyToSignalId: second.id,
		};
		// A durable reply wins even before the stale active snapshot refreshes.
		const after = present([first, second, later, final], progress);
		expect(after.map((item) => item.id)).toEqual([
			first.id,
			second.id,
			later.id,
			final.id,
			"active-wake:request-1:agent",
		]);
		expect(present([final], [progress[0]]).map((item) => item.id)).toEqual([
			final.id,
		]);
	});

	it("keeps multiple targets separate and restores only the owning conversation's unloaded Wakes", () => {
		const source = message("request", 100);
		source.wakeTargetProfileIds = ["other-agent", "agent"];
		const main = wake(source);
		if (!main.sourceContext) {
			throw new Error("Expected the request's conversation context.");
		}
		const thread = {
			...wake(source),
			targetProfileId: "other-agent",
			sourceContext: { ...main.sourceContext, threadId: "thread" },
		};
		expect(
			present([], [main, thread]).map((item) => item.actorProfileId)
		).toEqual(["agent"]);
		expect(
			present([], [main, thread], "thread").map((item) => item.actorProfileId)
		).toEqual(["other-agent"]);
		expect(
			present([source], [main, { ...main, targetProfileId: "other-agent" }])
				.filter((item) => item.activeWakeProgress)
				.map((item) => item.actorProfileId)
		).toEqual(["other-agent", "agent"]);
		expect(present([], [{ ...main, sourceContext: undefined }])).toEqual([]);
	});

	it("never turns terminal outcomes into active answer placeholders", () => {
		const source = message("request", 100);
		for (const phase of [
			"replied",
			"failed",
			"stopped",
			"publication_unknown",
		] as const) {
			expect(
				present([source], [{ ...wake(source), phase, terminal: true }])
			).toEqual([source]);
		}
	});
});

function present(
	timelineItems: readonly SpaceTimelineItem[],
	activityItems: readonly WakeProgressItem[],
	threadId: string | null = null
) {
	return buildActiveWakeConversationItems({
		timelineItems,
		activityItems,
		profileEntriesById: new Map(),
		spaceId: "space",
		threadId,
	});
}

function wake(source: SpaceTimelineItem): WakeProgressItem {
	return {
		clientMessageId: null,
		dispatchId: `dispatch:${source.id}`,
		runtimeCoordinatorExecutionId: `execution:${source.id}`,
		sourceSignalId: source.id,
		targetProfileId: "agent",
		targetLabel: "Review Agent",
		phase: "running",
		terminal: false,
		message: "Working",
		startedAtMs: source.createdAtMs,
		updatedAtMs: 1000,
		sourceContext: {
			messagePreview: source.text,
			profileId: source.actorProfileId,
			profileKind: "human",
			profileName: "Teammate",
			threadId: null,
		},
	};
}

function message(id: string, createdAtMs: number): SpaceTimelineItem {
	return {
		id,
		createdAtMs,
		spaceId: "space",
		signalType: "signal.text",
		deliveryState: "sent",
		actorName: "Teammate",
		actorProfileId: "human",
		actorProfileKind: "human",
		actorProfileName: "Teammate",
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorAgentControllerRef: null,
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		systemNoticeType: null,
		text: "Review the launch checklist",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
	};
}
