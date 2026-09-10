import type { ReactElement, ReactNode } from "react";

export type SpaceProfileTriggerRenderer = (
	profileId: string,
	trigger: ReactElement
) => ReactNode;

import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceMessageProfileMention } from "./space-message-profile-mention-view";

const SPACE_MESSAGE_PROFILE_MENTION_PATH_PREFIX =
	"/__openmeld/message-profile-mentions/";
const ID_MENTION_LEFT_CONTINUATION = /[\p{L}\p{N}_@.-]/u;
const ID_MENTION_RIGHT_CONTINUATION = /[\p{L}\p{N}_-]/u;
const MARKDOWN_MENTION_DESCENT_BLOCKLIST = new Set([
	"code",
	"inlineCode",
	"link",
	"linkReference",
]);

type SpaceMessageProfileMentionIdentity = Pick<
	SpaceCollaborationProfilePresentation,
	"profileId" | "profileName"
>;

type SpaceMessageProfileMentionSegment<
	TProfile extends SpaceMessageProfileMentionIdentity,
> =
	| { kind: "text"; value: string }
	| {
			kind: "profile_mention";
			offset: number;
			profile: TProfile;
	  };

type MarkdownNode = {
	children?: MarkdownNode[];
	type: string;
	url?: string;
	value?: string;
};

type SpaceMessageProfileRelation = "reference" | "wake" | "mention";

export type SpaceMessageProfileMentionPresentation =
	SpaceCollaborationProfilePresentation & {
		relation: SpaceMessageProfileRelation;
	};

type SpaceMessageProfileMentionRemarkOptions = {
	profiles: readonly SpaceMessageProfileMentionPresentation[];
};

export type SpaceMessageProfileMentionProfilesById = ReadonlyMap<
	string,
	SpaceMessageProfileMentionPresentation
>;

export const EMPTY_SPACE_MESSAGE_PROFILE_MENTION_PROFILES: SpaceMessageProfileMentionProfilesById =
	new Map();

export function buildSpaceMessageProfileMentionProfiles(input: {
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	referenceTargetProfileIds: readonly string[];
	mentionTargetProfileIds: readonly string[];
	wakeTargetProfileIds: readonly string[];
}): SpaceMessageProfileMentionProfilesById {
	const profilesById = new Map<
		string,
		SpaceMessageProfileMentionPresentation
	>();
	const addProfile = (
		profileId: string,
		relation: SpaceMessageProfileRelation
	) => {
		if (profilesById.has(profileId)) {
			return;
		}

		const profile = input.profilePresentationsById.get(profileId);
		if (
			profile &&
			(relation === "mention" || profile.profileKind === "agent")
		) {
			profilesById.set(profileId, { ...profile, relation });
		}
	};

	for (const profileId of input.wakeTargetProfileIds) {
		addProfile(profileId, "wake");
	}
	for (const profileId of input.referenceTargetProfileIds) {
		addProfile(profileId, "reference");
	}
	for (const profileId of input.mentionTargetProfileIds) {
		addProfile(profileId, "mention");
	}

	return profilesById;
}

export function createSpaceMessageProfileMentionRemarkPlugin(
	profilesById: SpaceMessageProfileMentionProfilesById
) {
	const plugin: [
		typeof spaceMessageProfileMentionRemarkPlugin,
		SpaceMessageProfileMentionRemarkOptions,
	] = [
		spaceMessageProfileMentionRemarkPlugin,
		{
			profiles: [...profilesById.values()],
		} satisfies SpaceMessageProfileMentionRemarkOptions,
	];
	return plugin;
}

export function renderSpaceMessageProfileMentionInternalLink(input: {
	href: string;
	onOpenProfile?: (profileId: string) => void;
	profilesById: SpaceMessageProfileMentionProfilesById;
	renderProfileTrigger?: SpaceProfileTriggerRenderer;
}): ReactNode | null {
	const parsedMention = parseSpaceMessageProfileMentionPath(input.href);
	const baseProfile = parsedMention
		? input.profilesById.get(parsedMention.profileId)
		: null;
	if (!(parsedMention && baseProfile)) {
		return null;
	}
	const profile = parsedMention.relation
		? { ...baseProfile, relation: parsedMention.relation }
		: baseProfile;

	return (
		<SpaceMessageProfileMention
			onOpenProfile={input.onOpenProfile}
			profile={profile}
			renderProfileTrigger={input.renderProfileTrigger}
		/>
	);
}

export const SPACE_MESSAGE_PROFILE_MENTION_TOKEN_CLASS_NAME =
	"inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-foreground ring-1 ring-border/70";

export function splitSpaceMessageProfileMentionText(
	text: string,
	profilesById: SpaceMessageProfileMentionProfilesById,
	occurrenceCountByProfileId = new Map<string, number>()
): readonly SpaceMessageProfileMentionSegment<SpaceMessageProfileMentionPresentation>[] {
	const candidates = [...profilesById.values()]
		.flatMap((profile) =>
			[...new Set([profile.profileName, profile.profileId])].flatMap(
				(label) => {
					const mentionText = `@${label}`;
					const matches: Array<{
						end: number;
						mentionText: string;
						profile: SpaceMessageProfileMentionPresentation;
						start: number;
					}> = [];
					let start = text.indexOf(mentionText);
					while (start >= 0) {
						const end = start + mentionText.length;
						if (
							label === profile.profileId &&
							(ID_MENTION_LEFT_CONTINUATION.test(text[start - 1] ?? "") ||
								ID_MENTION_RIGHT_CONTINUATION.test(text[end] ?? ""))
						) {
							start = text.indexOf(mentionText, end);
							continue;
						}
						matches.push({
							end: start + mentionText.length,
							mentionText,
							profile,
							start,
						});
						start = text.indexOf(mentionText, start + mentionText.length);
					}
					return matches;
				}
			)
		)
		.sort(
			(left, right) =>
				left.start - right.start ||
				right.mentionText.length - left.mentionText.length
		);
	const segments: SpaceMessageProfileMentionSegment<SpaceMessageProfileMentionPresentation>[] =
		[];
	let cursor = 0;

	for (const candidate of candidates) {
		if (candidate.start < cursor) {
			continue;
		}
		if (candidate.start > cursor) {
			segments.push({
				kind: "text",
				value: text.slice(cursor, candidate.start),
			});
		}
		const occurrenceCount =
			occurrenceCountByProfileId.get(candidate.profile.profileId) ?? 0;
		occurrenceCountByProfileId.set(
			candidate.profile.profileId,
			occurrenceCount + 1
		);
		const profile =
			candidate.profile.relation === "wake" && occurrenceCount > 0
				? { ...candidate.profile, relation: "reference" as const }
				: candidate.profile;
		segments.push({
			kind: "profile_mention",
			offset: candidate.start,
			profile,
		});
		cursor = candidate.end;
	}

	if (cursor < text.length || segments.length === 0) {
		segments.push({ kind: "text", value: text.slice(cursor) });
	}

	return segments;
}

function spaceMessageProfileMentionRemarkPlugin(
	options: SpaceMessageProfileMentionRemarkOptions
) {
	const profilesById = new Map(
		options.profiles.map((profile) => [profile.profileId, profile])
	);
	return (tree: MarkdownNode) => {
		transformMarkdownProfileMentions(tree, profilesById, new Map());
	};
}

function transformMarkdownProfileMentions(
	node: MarkdownNode,
	profilesById: SpaceMessageProfileMentionProfilesById,
	occurrenceCountByProfileId: Map<string, number>
): void {
	if (MARKDOWN_MENTION_DESCENT_BLOCKLIST.has(node.type) || !node.children) {
		return;
	}

	const transformedChildren: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type === "text" && typeof child.value === "string") {
			for (const segment of splitSpaceMessageProfileMentionText(
				child.value,
				profilesById,
				occurrenceCountByProfileId
			)) {
				if (segment.kind === "text") {
					transformedChildren.push({ type: "text", value: segment.value });
					continue;
				}

				transformedChildren.push({
					children: [
						{
							type: "text",
							value: `@${segment.profile.profileName}`,
						},
					],
					type: "link",
					url: buildSpaceMessageProfileMentionPath({
						profileId: segment.profile.profileId,
						relation: segment.profile.relation,
					}),
				});
			}
			continue;
		}

		transformMarkdownProfileMentions(
			child,
			profilesById,
			occurrenceCountByProfileId
		);
		transformedChildren.push(child);
	}

	node.children = transformedChildren;
}

function buildSpaceMessageProfileMentionPath(input: {
	profileId: string;
	relation: SpaceMessageProfileRelation;
}): string {
	return `${SPACE_MESSAGE_PROFILE_MENTION_PATH_PREFIX}${encodeURIComponent(input.profileId)}?relation=${input.relation}`;
}

function parseSpaceMessageProfileMentionPath(href: string): {
	profileId: string;
	relation: SpaceMessageProfileRelation | null;
} | null {
	if (!href.startsWith(SPACE_MESSAGE_PROFILE_MENTION_PATH_PREFIX)) {
		return null;
	}

	const encodedTarget = href.slice(
		SPACE_MESSAGE_PROFILE_MENTION_PATH_PREFIX.length
	);
	const [encodedProfileId, rawQuery = ""] = encodedTarget.split("?", 2);
	if (!encodedProfileId || encodedProfileId.includes("/")) {
		return null;
	}

	try {
		const profileId = decodeURIComponent(encodedProfileId);
		const rawRelation = new URLSearchParams(rawQuery).get("relation");
		const relation =
			rawRelation === "wake" ||
			rawRelation === "reference" ||
			rawRelation === "mention"
				? rawRelation
				: null;
		return { profileId, relation };
	} catch {
		return null;
	}
}
