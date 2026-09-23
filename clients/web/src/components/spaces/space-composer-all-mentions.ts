import type { SpaceMentionSuggestion } from "@openmeld/space";
import {
	SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
	type SpaceComposerProfileElement,
	type SpaceMentionAudience,
} from "./space-composer-editor-model";

export type { SpaceMentionAudience } from "./space-composer-editor-model";

const AUDIENCE_MENTION_TEXT: Record<SpaceMentionAudience, string> = {
	people: "@everyone",
	agents: "@agents",
	both: "@all",
};

/** Keep one visible token while retaining the selected member IDs and relations. */
export function buildSpaceAudienceMentions(input: {
	audience: SpaceMentionAudience;
	suggestions: readonly SpaceMentionSuggestion[];
}): SpaceComposerProfileElement[] {
	const included = new Set<string>();
	const targets = input.suggestions.flatMap((target) => {
		const isHuman = target.profileKind === "human";
		const relation: "mention" | "wake" = isHuman ? "mention" : "wake";
		if (
			included.has(target.profileId) ||
			!target.allowedRelations[relation] ||
			(input.audience === "people" && !isHuman) ||
			(input.audience === "agents" && isHuman)
		) {
			return [];
		}
		included.add(target.profileId);
		return [{ profileId: target.profileId, relation }];
	});
	const firstTarget = targets[0];
	if (!firstTarget) {
		return [];
	}
	return [
		{
			audience: input.audience,
			audienceTargets: targets,
			children: [{ text: "" }],
			mentionText: AUDIENCE_MENTION_TEXT[input.audience],
			profileId: firstTarget.profileId,
			relation: firstTarget.relation,
			type: SPACE_COMPOSER_PROFILE_ELEMENT_TYPE,
		},
	];
}
