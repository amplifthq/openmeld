import type { MessageMentionType } from "@openmeld/schemas/types";
import type { TElement, TText } from "platejs";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";

export const SPACE_COMPOSER_PROFILE_ELEMENT_TYPE = "space_profile" as const;
const PASTED_MENTION_PRECEDING_CHARACTER_PATTERN = /[\p{L}\p{N}._%+/@#<>-]/u;
const PASTED_MENTION_CONTINUATION_PATTERN = /[\p{L}\p{N}_'’(/-]/u;

export type SpaceComposerProfileElement = TElement & {
	children: [{ text: "" }];
	mentionText: string;
	profileId: string;
	relation: MessageMentionType;
	type: typeof SPACE_COMPOSER_PROFILE_ELEMENT_TYPE;
};

export type SpaceComposerEditorChild = SpaceComposerProfileElement | TText;

export type SpaceComposerEditorBlock = TElement & {
	children: SpaceComposerEditorChild[];
	type: "p";
};

export type SpaceComposerEditorValue = [SpaceComposerEditorBlock];

export type SpaceComposerPasteTarget = {
	allowedRelations: Readonly<Record<MessageMentionType, boolean>>;
	defaultRelation: MessageMentionType;
	duplicateRelation: MessageMentionType;
	mentionText: string;
	profileId: string;
};

type PastedMentionMatch = {
	mentionText: string;
	start: number;
	target: SpaceComposerPasteTarget;
};

export function createSpaceComposerEditorValue(input: {
	authoredMentions: readonly ComposerDraftAuthoredMention[];
	text: string;
}): SpaceComposerEditorValue {
	const children: SpaceComposerEditorChild[] = [];
	let cursor = 0;
	const claimedProfileIds = new Set<string>();

	for (const mention of [...input.authoredMentions].sort(
		(left, right) => left.start - right.start
	)) {
		if (
			mention.start < cursor ||
			mention.end <= mention.start ||
			input.text.slice(mention.start, mention.end) !== mention.text
		) {
			continue;
		}

		appendText(children, input.text.slice(cursor, mention.start));
		children.push({
			children: [{ text: "" }],
			mentionText: mention.text,
			profileId: mention.profileId,
			relation:
				claimedProfileIds.has(mention.profileId) && mention.relation === "wake"
					? "reference"
					: mention.relation,
			type: SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
		});
		claimedProfileIds.add(mention.profileId);
		cursor = mention.end;
	}

	appendText(children, input.text.slice(cursor));
	if (children.length === 0) {
		children.push({ text: "" });
	}

	return [{ children, type: "p" }];
}

export function serializeSpaceComposerEditorValue(value: readonly TElement[]): {
	authoredMentions: ComposerDraftAuthoredMention[];
	text: string;
} {
	const authoredMentions: ComposerDraftAuthoredMention[] = [];
	const textParts: string[] = [];
	const claimedProfileIds = new Set<string>();
	let offset = 0;

	value.forEach((block, blockIndex) => {
		if (blockIndex > 0) {
			textParts.push("\n");
			offset += 1;
		}
		for (const child of block.children) {
			if (isSpaceComposerProfileElement(child)) {
				const start = offset;
				textParts.push(child.mentionText);
				offset += child.mentionText.length;
				authoredMentions.push({
					end: offset,
					profileId: child.profileId,
					relation:
						claimedProfileIds.has(child.profileId) && child.relation === "wake"
							? "reference"
							: child.relation,
					start,
					text: child.mentionText,
				});
				claimedProfileIds.add(child.profileId);
				continue;
			}

			const childText = getSpaceComposerEditorChildText(child);
			textParts.push(childText);
			offset += childText.length;
		}
	});

	return {
		authoredMentions,
		text: textParts.join(""),
	};
}

export function createSpaceComposerPastedValue(input: {
	existingProfileIds: readonly string[];
	preferredMentions?: readonly ComposerDraftAuthoredMention[];
	targets: readonly SpaceComposerPasteTarget[];
	text: string;
}): SpaceComposerEditorValue {
	const targetsByMentionText = new Map<string, SpaceComposerPasteTarget[]>();
	for (const target of input.targets) {
		const matches = targetsByMentionText.get(target.mentionText) ?? [];
		matches.push(target);
		targetsByMentionText.set(target.mentionText, matches);
	}
	const unambiguousTargets = [...targetsByMentionText.entries()]
		.flatMap(([mentionText, targets]) => {
			const profileIds = new Set(targets.map((target) => target.profileId));
			return profileIds.size === 1 && targets[0]
				? [{ mentionText, target: targets[0] }]
				: [];
		})
		.sort((left, right) => right.mentionText.length - left.mentionText.length);
	const preferredByStart = new Map(
		(input.preferredMentions ?? []).map((mention) => [mention.start, mention])
	);
	const seenProfileIds = new Set(input.existingProfileIds);
	const authoredMentions = collectPastedMentionMatches({
		text: input.text,
		unambiguousTargets,
	}).map(({ mentionText, start, target }) => {
		const preferred = preferredByStart.get(start);
		const preferredRelation =
			preferred?.profileId === target.profileId &&
			preferred.text === mentionText &&
			preferred.end === start + mentionText.length &&
			target.allowedRelations[preferred.relation]
				? preferred.relation
				: null;
		const relation = seenProfileIds.has(target.profileId)
			? target.duplicateRelation
			: (preferredRelation ?? target.defaultRelation);
		seenProfileIds.add(target.profileId);
		return {
			end: start + mentionText.length,
			profileId: target.profileId,
			relation,
			start,
			text: mentionText,
		};
	});

	return createSpaceComposerEditorValue({ authoredMentions, text: input.text });
}

function collectPastedMentionMatches(input: {
	text: string;
	unambiguousTargets: readonly {
		mentionText: string;
		target: SpaceComposerPasteTarget;
	}[];
}): PastedMentionMatch[] {
	const matches: PastedMentionMatch[] = [];
	let fencedCode = false;
	let inlineCode = false;

	for (let index = 0; index < input.text.length; index += 1) {
		if (input.text.startsWith("```", index) && !isEscaped(input.text, index)) {
			fencedCode = !fencedCode;
			inlineCode = false;
			index += 2;
			continue;
		}
		if (
			!fencedCode &&
			input.text[index] === "`" &&
			!isEscaped(input.text, index)
		) {
			inlineCode = !inlineCode;
			continue;
		}
		if (
			fencedCode ||
			inlineCode ||
			input.text[index] !== "@" ||
			!canStartPastedMention(input.text, index)
		) {
			continue;
		}
		const match = input.unambiguousTargets.find(({ mentionText }) =>
			input.text.startsWith(mentionText, index)
		);
		if (
			!(
				match &&
				canEndPastedMention(input.text, index + match.mentionText.length)
			)
		) {
			continue;
		}
		matches.push({ ...match, start: index });
		index += match.mentionText.length - 1;
	}

	return matches;
}

export function getSpaceComposerEditorChildText(value: unknown): string {
	if (!(value && typeof value === "object")) {
		return "";
	}
	if (isSpaceComposerProfileElement(value)) {
		return value.mentionText;
	}
	if (
		"type" in value &&
		value.type === "mention_input" &&
		"trigger" in value &&
		typeof value.trigger === "string"
	) {
		const search =
			"search" in value && typeof value.search === "string" ? value.search : "";
		return `${value.trigger}${search}`;
	}
	return "text" in value && typeof value.text === "string" ? value.text : "";
}

export function isSpaceComposerProfileElement(
	value: unknown
): value is SpaceComposerProfileElement {
	if (!(value && typeof value === "object")) {
		return false;
	}
	const candidate = value as Partial<SpaceComposerProfileElement>;
	return (
		candidate.type === SPACE_COMPOSER_PROFILE_ELEMENT_TYPE &&
		typeof candidate.mentionText === "string" &&
		typeof candidate.profileId === "string" &&
		(candidate.relation === "mention" ||
			candidate.relation === "reference" ||
			candidate.relation === "wake")
	);
}

function appendText(children: SpaceComposerEditorChild[], text: string): void {
	if (text.length === 0) {
		return;
	}
	children.push({ text });
}

function canStartPastedMention(text: string, index: number): boolean {
	if (isEscaped(text, index)) {
		return false;
	}
	const preceding = text[index - 1];
	return !(
		preceding && PASTED_MENTION_PRECEDING_CHARACTER_PATTERN.test(preceding)
	);
}

function canEndPastedMention(text: string, index: number): boolean {
	const following = text[index];
	return !(following && PASTED_MENTION_CONTINUATION_PATTERN.test(following));
}

function isEscaped(text: string, index: number): boolean {
	let backslashCount = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && text[cursor] === "\\";
		cursor -= 1
	) {
		backslashCount += 1;
	}
	return backslashCount % 2 === 1;
}
