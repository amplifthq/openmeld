import { Fragment, type ReactNode } from "react";
import type { SpaceCollaborationProfilePresentation } from "./space-collaboration-profile";
import { SpaceProfileIcon } from "./space-profile-icon";

const SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX =
	"/__openmeld/message-agent-mentions/";
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

type SpaceMessageAgentMentionRemarkOptions = {
	profiles: readonly SpaceMessageAgentMentionIdentity[];
};

type MarkdownNode = {
	children?: MarkdownNode[];
	type: string;
	url?: string;
	value?: string;
};

export type SpaceMessageAgentMentionProfilesById = ReadonlyMap<
	string,
	SpaceCollaborationProfilePresentation
>;

export const EMPTY_SPACE_MESSAGE_AGENT_MENTION_PROFILES: SpaceMessageAgentMentionProfilesById =
	new Map();

export function buildSpaceMessageAgentMentionProfiles(input: {
	profilePresentationsById: SpaceMessageAgentMentionProfilesById;
	wakeTargetProfileIds: readonly string[];
}): SpaceMessageAgentMentionProfilesById {
	const profilesById = new Map<string, SpaceCollaborationProfilePresentation>();

	for (const profileId of input.wakeTargetProfileIds) {
		const profile = input.profilePresentationsById.get(profileId);
		if (profile?.profileKind === "agent") {
			profilesById.set(profileId, profile);
		}
	}

	return profilesById;
}

export function SpaceMessageAgentMentionText(input: {
	profilesById: SpaceMessageAgentMentionProfilesById;
	renderText?: (text: string) => ReactNode;
	text: string;
}) {
	return (
		<>
			{splitSpaceMessageAgentMentionText(input.text, input.profilesById).map(
				(segment, index) => {
					if (segment.kind === "text") {
						return (
							<Fragment key={`text:${String(index)}`}>
								{input.renderText?.(segment.value) ?? segment.value}
							</Fragment>
						);
					}

					return (
						<SpaceMessageAgentMention
							key={`${segment.profile.profileId}:${String(segment.offset)}`}
							profile={segment.profile}
						/>
					);
				}
			)}
		</>
	);
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
			profiles: [...profilesById.values()].map((profile) => ({
				profileId: profile.profileId,
				profileName: profile.profileName,
			})),
		} satisfies SpaceMessageAgentMentionRemarkOptions,
	];
	return plugin;
}

export function renderSpaceMessageAgentMentionInternalLink(input: {
	href: string;
	profilesById: SpaceMessageAgentMentionProfilesById;
}): ReactNode | null {
	const profileId = parseSpaceMessageAgentMentionProfileId(input.href);
	const profile = profileId ? input.profilesById.get(profileId) : null;
	if (!profile) {
		return null;
	}

	return <SpaceMessageAgentMention profile={profile} />;
}

function SpaceMessageAgentMention(input: {
	profile: SpaceCollaborationProfilePresentation;
}) {
	return (
		<span data-slot="space-message-agent-mention">
			<span aria-hidden="true">@</span>
			<SpaceProfileIcon
				agentControllerRef={input.profile.agentControllerRef}
				avatarImageUrl={input.profile.avatarImageUrl}
				className="inline-flex align-[-0.125em]"
				isCenterAgent={input.profile.isCenterAgent}
				profileId={input.profile.profileId}
				profileKind={input.profile.profileKind}
				profileName={input.profile.profileName}
				size="inline"
			/>
			<strong className="font-bold">{input.profile.profileName}</strong>
		</span>
	);
}

function splitSpaceMessageAgentMentionText<
	TProfile extends SpaceMessageAgentMentionIdentity,
>(
	text: string,
	profilesById: ReadonlyMap<string, TProfile>
): readonly SpaceMessageAgentMentionSegment<TProfile>[] {
	const candidates = [...profilesById.values()]
		.flatMap((profile) => {
			const mentionText = `@${profile.profileName}`;
			const start = text.indexOf(mentionText);
			return start < 0
				? []
				: [
						{
							end: start + mentionText.length,
							mentionText,
							profile,
							start,
						},
					];
		})
		.sort(
			(left, right) =>
				left.start - right.start ||
				right.mentionText.length - left.mentionText.length
		);
	const segments: SpaceMessageAgentMentionSegment<TProfile>[] = [];
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
		segments.push({
			kind: "agent_mention",
			offset: candidate.start,
			profile: candidate.profile,
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
		transformMarkdownAgentMentions(tree, profilesById);
	};
}

function transformMarkdownAgentMentions(
	node: MarkdownNode,
	profilesById: ReadonlyMap<string, SpaceMessageAgentMentionIdentity>
): void {
	if (MARKDOWN_MENTION_DESCENT_BLOCKLIST.has(node.type) || !node.children) {
		return;
	}

	const transformedChildren: MarkdownNode[] = [];
	for (const child of node.children) {
		if (child.type === "text" && typeof child.value === "string") {
			for (const segment of splitSpaceMessageAgentMentionText(
				child.value,
				profilesById
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
					url: buildSpaceMessageAgentMentionPath(segment.profile.profileId),
				});
			}
			continue;
		}

		transformMarkdownAgentMentions(child, profilesById);
		transformedChildren.push(child);
	}

	node.children = transformedChildren;
}

function buildSpaceMessageAgentMentionPath(profileId: string): string {
	return `${SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX}${encodeURIComponent(profileId)}`;
}

function parseSpaceMessageAgentMentionProfileId(href: string): string | null {
	if (!href.startsWith(SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX)) {
		return null;
	}

	const encodedProfileId = href.slice(
		SPACE_MESSAGE_AGENT_MENTION_PATH_PREFIX.length
	);
	if (!encodedProfileId || encodedProfileId.includes("/")) {
		return null;
	}

	try {
		return decodeURIComponent(encodedProfileId);
	} catch {
		return null;
	}
}
