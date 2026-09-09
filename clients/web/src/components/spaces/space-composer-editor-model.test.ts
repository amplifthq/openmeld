import { describe, expect, it } from "vitest";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import {
	createSpaceComposerEditorValue,
	createSpaceComposerPastedValue,
	serializeSpaceComposerEditorValue,
} from "./space-composer-editor-model";

describe("space Composer editor model", () => {
	it("turns an authored mention into one inline profile token without changing public text", () => {
		const authoredMention = createAuthoredMention({
			end: 11,
			profileId: "agent-runner",
			relation: "wake",
			start: 4,
			text: "@Runner",
		});

		expect(
			createSpaceComposerEditorValue({
				authoredMentions: [authoredMention],
				text: "Ask @Runner to review this.",
			})
		).toEqual([
			{
				children: [
					{ text: "Ask " },
					{
						children: [{ text: "" }],
						mentionText: "@Runner",
						profileId: "agent-runner",
						relation: "wake",
						type: "space_profile",
					},
					{ text: " to review this." },
				],
				type: "p",
			},
		]);
	});

	it("serializes edited text and inline relations back to the existing draft contract", () => {
		const value = createSpaceComposerEditorValue({
			authoredMentions: [
				createAuthoredMention({
					end: 11,
					profileId: "agent-runner",
					relation: "reference",
					start: 4,
					text: "@Runner",
				}),
			],
			text: "Ask @Runner\nthen ship.",
		});

		expect(serializeSpaceComposerEditorValue(value)).toEqual({
			authoredMentions: [
				{
					end: 11,
					profileId: "agent-runner",
					relation: "reference",
					start: 4,
					text: "@Runner",
				},
			],
			text: "Ask @Runner\nthen ship.",
		});
	});

	it("keeps later appearances of the same Agent as visible Reference tokens", () => {
		const text = "@Runner ask @Runner to review this.";
		const value = createSpaceComposerEditorValue({
			authoredMentions: [
				createAuthoredMention({
					end: 7,
					profileId: "agent-runner",
					relation: "wake",
					start: 0,
					text: "@Runner",
				}),
				createAuthoredMention({
					end: 19,
					profileId: "agent-runner",
					relation: "reference",
					start: 12,
					text: "@Runner",
				}),
			],
			text,
		});

		expect(value[0].children).toEqual([
			{
				children: [{ text: "" }],
				mentionText: "@Runner",
				profileId: "agent-runner",
				relation: "wake",
				type: "space_profile",
			},
			{ text: " ask " },
			{
				children: [{ text: "" }],
				mentionText: "@Runner",
				profileId: "agent-runner",
				relation: "reference",
				type: "space_profile",
			},
			{ text: " to review this." },
		]);

		const serialized = serializeSpaceComposerEditorValue(value);
		expect(serialized.text).toBe(text);
		expect(serialized.authoredMentions).toEqual([
			{
				end: 7,
				profileId: "agent-runner",
				relation: "wake",
				start: 0,
				text: "@Runner",
			},
			{
				end: 19,
				profileId: "agent-runner",
				relation: "reference",
				start: 12,
				text: "@Runner",
			},
		]);
	});

	it("leaves stale or malformed draft ranges as harmless plain text", () => {
		const value = createSpaceComposerEditorValue({
			authoredMentions: [
				createAuthoredMention({
					end: 11,
					profileId: "agent-runner",
					relation: "wake",
					start: 4,
					text: "@Different",
				}),
			],
			text: "Ask @Runner to review this.",
		});

		expect(serializeSpaceComposerEditorValue(value)).toEqual({
			authoredMentions: [],
			text: "Ask @Runner to review this.",
		});
	});

	it("keeps all plain pasted text literal even when a current member matches", () => {
		const text =
			"runner@example.com https://openmeld.dev/@Runner `@Runner` \\@Runner @RunnerExtra then @Runner";
		const value = createSpaceComposerPastedValue({
			existingProfileIds: [],
			targets: [
				{
					allowedRelations: {
						mention: false,
						reference: true,
						wake: true,
					},
					defaultRelation: "wake",
					duplicateRelation: "reference",
					mentionText: "@Runner",
					profileId: "agent-runner",
				},
			],
			text,
		});

		expect(serializeSpaceComposerEditorValue(value)).toEqual({
			authoredMentions: [],
			text,
		});
	});

	it("leaves an ambiguous pasted member name as ordinary text", () => {
		const value = createSpaceComposerPastedValue({
			existingProfileIds: [],
			targets: ["agent-one", "agent-two"].map((profileId) => ({
				allowedRelations: {
					mention: false,
					reference: true,
					wake: true,
				},
				defaultRelation: "wake" as const,
				duplicateRelation: "reference" as const,
				mentionText: "@Runner",
				profileId,
			})),
			text: "Ask @Runner",
		});

		expect(serializeSpaceComposerEditorValue(value)).toEqual({
			authoredMentions: [],
			text: "Ask @Runner",
		});
	});

	it("preserves an internal Reference and normalizes a repeated Agent to Reference", () => {
		const target = {
			allowedRelations: { mention: false, reference: true, wake: true },
			defaultRelation: "wake" as const,
			duplicateRelation: "reference" as const,
			mentionText: "@Runner",
			profileId: "agent-runner",
		};
		const preferredMentions = [
			{
				end: 7,
				profileId: "agent-runner",
				relation: "reference" as const,
				start: 0,
				text: "@Runner",
			},
		];

		expect(
			serializeSpaceComposerEditorValue(
				createSpaceComposerPastedValue({
					existingProfileIds: [],
					preferredMentions,
					targets: [target],
					text: "@Runner",
				})
			).authoredMentions[0]?.relation
		).toBe("reference");
		expect(
			serializeSpaceComposerEditorValue(
				createSpaceComposerPastedValue({
					existingProfileIds: ["agent-runner"],
					preferredMentions: [
						{ ...preferredMentions[0], relation: "wake" as const },
					],
					targets: [target],
					text: "@Runner",
				})
			).authoredMentions[0]?.relation
		).toBe("reference");
	});

	it("keeps an unfinished @ search in the browser draft", () => {
		expect(
			serializeSpaceComposerEditorValue([
				{
					children: [
						{ text: "Ask " },
						{
							children: [{ text: "" }],
							search: "Run",
							trigger: "@",
							type: "mention_input",
						},
					],
					type: "p",
				},
			])
		).toEqual({
			authoredMentions: [],
			text: "Ask @Run",
		});
	});
});

function createAuthoredMention(
	overrides: ComposerDraftAuthoredMention
): ComposerDraftAuthoredMention {
	return overrides;
}
