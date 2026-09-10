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
import { serializeSpaceComposerEditorValue } from "./space-composer-editor-model";

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
		["people", [humanId], ["mention"]],
		["agents", [agentId], ["wake"]],
	] as const)("selects only %s and retains the requested relation", (audience, ids, relations) => {
		const mentions = buildSpaceAudienceMentions({
			audience,
			suggestions,
		});
		expect(mentions.map((mention) => mention.profileId)).toEqual(ids);
		expect(mentions.map((mention) => mention.relation)).toEqual(relations);
	});

	it("includes each target only once", () => {
		const mentions = buildSpaceAudienceMentions({
			audience: "both",
			suggestions: [...suggestions, ...suggestions],
		});
		expect(mentions.map((mention) => mention.profileId).sort()).toEqual(
			[humanId, agentId].sort()
		);
	});

	it("serializes through ordinary Composer tokens with no synthetic recipient", () => {
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
		expect(serialized.text).toContain("@Alex");
		expect(serialized.text).toContain("@Research");
		expect(serialized.text).not.toContain("@all");
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
