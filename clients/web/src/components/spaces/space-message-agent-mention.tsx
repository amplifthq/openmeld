import type { ReactElement, ReactNode } from "react";

export type SpaceAgentProfileTriggerRenderer = (
	profileId: string,
	trigger: ReactElement
) => ReactNode;

import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceMessageAgentMention } from "./space-message-agent-mention-view";

const SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX =
	"/__openmeld/message-agent-mentions/";
const ID_MENTION_LEFT_CONTINUATION = /[\p{L}\p{N}_@.-]/u;
const ID_MENTION_RIGHT_CONTINUATION = /[\p{L}\p{N}_-]/u;
const MARKDOWN_MENTION_DESCENT_BLOCKLIST = new Set([
	"code",
	"inlineCode",
	"link",
	"linkReference",
]);

type SpaceMessageAgentMentionIdentity = Pick<
	SpaceCollaborationProfilePresentation,
	"profileId" | "profileName"
>;

type SpaceMessageAgentMentionSegment<
	TProfile extends SpaceMessageAgentMentionIdentity,
> =
	| { kind: "text"; value: string }
	| {
			kind: "agent_mention";
			offset: number;
			profile: TProfile;
	  };

type MarkdownNode = {
	children?: MarkdownNode[];
	type: string;
	url?: string;
	value?: string;
};

type SpaceMessageAgentRelation = "reference" | "wake";

export type SpaceMessageAgentMentionPresentation =
	SpaceCollaborationProfilePresentation & {
		relation: SpaceMessageAgentRelation;
	};

type SpaceMessageAgentMentionRemarkOptions = {
	profiles: readonly SpaceMessageAgentMentionPresentation[];
};

export type SpaceMessageAgentMentionProfilesById = ReadonlyMap<
	string,
	SpaceMessageAgentMentionPresentation
>;

export const EMPTY_SPACE_MESSAGE_AGENT_MENTION_PROFILES: SpaceMessageAgentMentionProfilesById =
	new Map();

export function buildSpaceMessageAgentMentionProfiles(input: {
	profilePresentationsById: ReadonlyMap<
		string,
		SpaceCollaborationProfilePresentation
	>;
	referenceTargetProfileIds: readonly string[];
	wakeTargetProfileIds: readonly string[];
}): SpaceMessageAgentMentionProfilesById {
	const profilesById = new Map<string, SpaceMessageAgentMentionPresentation>();
	const addProfile = (
		profileId: string,
		relation: SpaceMessageAgentRelation
	) => {
		if (profilesById.has(profileId)) {
			return;
		}

		const profile = input.profilePresentationsById.get(profileId);
		if (profile?.profileKind === "agent") {
			profilesById.set(profileId, { ...profile, relation });
		}
	};

	for (const profileId of input.wakeTargetProfileIds) {
		addProfile(profileId, "wake");
	}
	for (const profileId of input.referenceTargetProfileIds) {
		addProfile(profileId, "reference");
	}

	return profilesById;
}

export function createSpaceMessageAgentMentionRemarkPlugin(
	profilesById: SpaceMessageAgentMentionProfilesById
) {
	const plugin: [
		typeof spaceMessageAgentMentionRemarkPlugin,
		SpaceMessageAgentMentionRemarkOptions,
	] = [
		spaceMessageAgentMentionRemarkPlugin,
		{
			profiles: [...profilesById.values()],
		} satisfies SpaceMessageAgentMentionRemarkOptions,
	];
	return plugin;
}

export function renderSpaceMessageAgentMentionInternalLink(input: {
	href: string;
	onOpenAgentProfile?: (profileId: string) => void;
	profilesById: SpaceMessageAgentMentionProfilesById;
	renderAgentProfileTrigger?: SpaceAgentProfileTriggerRenderer;
}): ReactNode | null {
	const parsedMention = parseSpaceMessageAgentMentionPath(input.href);
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
		<SpaceMessageAgentMention
			onOpenAgentProfile={input.onOpenAgentProfile}
			profile={profile}
			renderAgentProfileTrigger={input.renderAgentProfileTrigger}
		/>
	);
}

export const SPACE_MESSAGE_AGENT_MENTION_TOKEN_CLASS_NAME =
	"inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-baseline text-foreground ring-1 ring-border/70";

export function splitSpaceMessageAgentMentionText(
	text: string,
	profilesById: SpaceMessageAgentMentionProfilesById,
	occurrenceCountByProfileId = new Map<string, number>()
): readonly SpaceMessageAgentMentionSegment<SpaceMessageAgentMentionPresentation>[] {
	const candidates = [...profilesById.values()]
		.flatMap((profile) =>
			[...new Set([profile.profileName, profile.profileId])].flatMap(
				(label) => {
					const mentionText = `@${label}`;
					const matches: Array<{
						end: number;
						mentionText: string;
						profile: SpaceMessageAgentMentionPresentation;
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
	const segments: SpaceMessageAgentMentionSegment<SpaceMessageAgentMentionPresentation>[] =
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
			kind: "agent_mention",
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

function spaceMessageAgentMentionRemarkPlugin(
	options: SpaceMessageAgentMentionRemarkOptions
) {
	const profilesById = new Map(
		options.profiles.map((profile) => [profile.profileId, profile])
	);
	return (tree: MarkdownNode) => {
		transformMarkdownAgentMentions(tree, profilesById, new Map());
	};
}

function transformMarkdownAgentMentions(
	node: MarkdownNode,
	profilesById: SpaceMessageAgentMentionProfilesById,
	occurrenceCountByProfileId: Map<string, number>
): void {
	if (MARKDOWN_MENTION_DESCENT_BLOCKLIST.has(node.type) || !node.children) {
		return;
	}

	const transformedChildren: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type === "text" && typeof child.value === "string") {
			for (const segment of splitSpaceMessageAgentMentionText(
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
					url: buildSpaceMessageAgentMentionPath({
						profileId: segment.profile.profileId,
						relation: segment.profile.relation,
					}),
				});
			}
			continue;
		}

		transformMarkdownAgentMentions(
			child,
			profilesById,
			occurrenceCountByProfileId
		);
		transformedChildren.push(child);
	}

	node.children = transformedChildren;
}

function buildSpaceMessageAgentMentionPath(input: {
	profileId: string;
	relation: SpaceMessageAgentRelation;
}): string {
	return `${SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX}${encodeURIComponent(input.profileId)}?relation=${input.relation}`;
}

function parseSpaceMessageAgentMentionPath(href: string): {
	profileId: string;
	relation: SpaceMessageAgentRelation | null;
} | null {
	if (!href.startsWith(SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX)) {
		return null;
	}

	const encodedTarget = href.slice(
		SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX.length
	);
	const [encodedProfileId, rawQuery = ""] = encodedTarget.split("?", 2);
	if (!encodedProfileId || encodedProfileId.includes("/")) {
		return null;
	}

	try {
		const profileId = decodeURIComponent(encodedProfileId);
		const rawRelation = new URLSearchParams(rawQuery).get("relation");
		const relation =
			rawRelation === "wake" || rawRelation === "reference"
				? rawRelation
				: null;
		return { profileId, relation };
	} catch {
		return null;
	}
}
