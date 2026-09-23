import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import {
	listSpaceMentionSuggestions,
	prepareSpaceComposerSubmission,
} from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildSpaceAudienceMentions } from "./space-composer-all-mentions";
import {
	createSpaceComposerEditorValue,
	serializeSpaceComposerEditorValue,
} from "./space-composer-editor-model";

const humanId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const snapshot = createSpaceMembersSnapshot({
	humans: [
		createSpaceMemberHumanSnapshot({ profileId: humanId, profileName: "Alex" }),
	],
	agents: [
		createSpaceMemberAgentSnapshot({
			profileId: agentId,
			profileName: "Research",
			agentWakeAvailability: { status: "offline_for_wake" },
		}),
	],
});
const suggestions = listSpaceMentionSuggestions({ query: "", snapshot });

describe("explicit @all audience", () => {
	it.each([
		["people", "@everyone", [humanId], ["mention"]],
		["agents", "@agents", [agentId], ["wake"]],
		["both", "@all", [agentId, humanId], ["wake", "mention"]],
	] as const)("keeps one %s token with its selected targets", (audience, text, ids, relations) => {
		const mentions = buildSpaceAudienceMentions({
			audience,
			suggestions,
		});
		expect(mentions).toHaveLength(1);
		expect(mentions[0]?.mentionText).toBe(text);
		expect(
			mentions[0]?.audienceTargets?.map((target) => target.profileId)
		).toEqual(ids);
		expect(
			mentions[0]?.audienceTargets?.map((target) => target.relation)
		).toEqual(relations);
	});

	it("includes each target only once", () => {
		const mentions = buildSpaceAudienceMentions({
			audience: "both",
			suggestions: [...suggestions, ...suggestions],
		});
		expect(
			mentions[0]?.audienceTargets?.map((target) => target.profileId).sort()
		).toEqual([humanId, agentId].sort());
	});

	it("serializes one visible token with every selected recipient", () => {
		const mentions = buildSpaceAudienceMentions({
			audience: "both",
			suggestions,
		});
		const serialized = serializeSpaceComposerEditorValue([
			{
				type: "p",
				children: mentions.flatMap((mention) => [mention, { text: " " }]),
			},
		]);
		expect(
			serialized.authoredMentions.map((mention) => mention.profileId).sort()
		).toEqual([humanId, agentId].sort());
		expect(serialized.text).toBe("@all ");
		expect(serialized.authoredMentions.map((mention) => mention.start)).toEqual(
			[0, 0]
		);
		expect(
			serialized.authoredMentions.map((mention) => mention.audience)
		).toEqual(["both", "both"]);
		const restored = createSpaceComposerEditorValue(serialized);
		expect(restored[0].children).toHaveLength(2);
		expect(serializeSpaceComposerEditorValue(restored)).toEqual(serialized);
		const submission = prepareSpaceComposerSubmission({
			authoredMentionsInTextOrder: serialized.authoredMentions,
			missingSnapshotMessage: "Members unavailable",
			replyTo: null,
			snapshot,
			text: `${serialized.text}Please review`,
		});
		expect(submission.messageEnvelope?.mentionTargets).toEqual([humanId]);
		expect(submission.messageEnvelope?.activationTargets).toEqual([agentId]);
	});

	it("keeps people-only submissions on the existing canonical submission path", () => {
		const mentions = buildSpaceAudienceMentions({
			audience: "people",
			suggestions,
		});
		const serialized = serializeSpaceComposerEditorValue([
			{
				type: "p",
				children: mentions.flatMap((mention) => [mention, { text: " " }]),
			},
		]);
		const submission = prepareSpaceComposerSubmission({
			authoredMentionsInTextOrder: serialized.authoredMentions,
			missingSnapshotMessage: "Members unavailable",
			replyTo: null,
			snapshot,
			text: `${serialized.text}Please review`,
		});
		expect(submission.messageEnvelope?.mentionTargets).toEqual([humanId]);
		expect(submission.messageEnvelope?.activationTargets).toEqual([]);
	});
});
