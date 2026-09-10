import type { SpaceMentionSuggestion } from "@openmeld/space";
import {
	SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
	type SpaceComposerProfileElement,
} from "./space-composer-editor-model";

export type SpaceMentionAudience = "people" | "agents" | "both";

/** Expand an explicit audience choice into the ordinary, editable mentions. */
export function buildSpaceAudienceMentions(input: {
	audience: SpaceMentionAudience;
	suggestions: readonly SpaceMentionSuggestion[];
}): SpaceComposerProfileElement[] {
	const included = new Set<string>();
	return input.suggestions.flatMap((target) => {
		const isHuman = target.profileKind === "human";
		const relation = isHuman ? "mention" : "wake";
		if (
			included.has(target.profileId) ||
			!target.allowedRelations[relation] ||
			(input.audience === "people" && !isHuman) ||
			(input.audience === "agents" && isHuman)
		) {
			return [];
		}
		included.add(target.profileId);
		return [
			{
				children: [{ text: "" }],
				mentionText: `@${target.primaryMentionLabel}`,
				profileId: target.profileId,
				relation,
				type: SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
			},
		];
	});
}
