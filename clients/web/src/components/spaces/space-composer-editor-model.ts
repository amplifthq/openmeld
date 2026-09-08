import type { MessageMentionType } from "@openmeld/schemas/types";
import type { TElement, TText } from "platejs";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";

export const SPACE_COMPOSER_PROFILE_ELEMENT_TYPE = "space_profile" as const;

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
	const targetsById = new Map(
		input.targets.map((target) => [target.profileId, target])
	);
	const seenProfileIds = new Set(input.existingProfileIds);
	const authoredMentions = (input.preferredMentions ?? []).flatMap(
		(mention) => {
			const target = targetsById.get(mention.profileId);
			if (
				!target?.allowedRelations[mention.relation] ||
				mention.start < 0 ||
				mention.end <= mention.start ||
				input.text.slice(mention.start, mention.end) !== mention.text
			) {
				return [];
			}
			const relation = seenProfileIds.has(target.profileId)
				? target.duplicateRelation
				: mention.relation;
			seenProfileIds.add(target.profileId);
			return [{ ...mention, relation }];
		}
	);
	return createSpaceComposerEditorValue({ authoredMentions, text: input.text });
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
