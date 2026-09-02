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

type MarkdownNode = {
	children?: MarkdownNode[];
	type: string;
	url?: string;
	value?: string;
};

type SpaceMessageAgentRelation = "reference" | "wake";

type SpaceMessageAgentMentionPresentation =
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

export function SpaceMessageAgentMentionText(input: {
	onOpenAgentProfile?: (profileId: string) => void;
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
							onOpenAgentProfile={input.onOpenAgentProfile}
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
			profiles: [...profilesById.values()],
		} satisfies SpaceMessageAgentMentionRemarkOptions,
	];
	return plugin;
}

export function renderSpaceMessageAgentMentionInternalLink(input: {
	href: string;
	onOpenAgentProfile?: (profileId: string) => void;
	profilesById: SpaceMessageAgentMentionProfilesById;
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
		/>
	);
}

function SpaceMessageAgentMention(input: {
	onOpenAgentProfile?: (profileId: string) => void;
	profile: SpaceMessageAgentMentionPresentation;
}) {
	const relationLabel =
		input.profile.relation === "wake" ? "Wake" : "Reference";
	const content = (
		<>
			<span aria-hidden="true" className="shrink-0 font-semibold">
				@
			</span>
			<SpaceProfileIcon
				agentControllerRef={input.profile.agentControllerRef}
				avatarImageUrl={input.profile.avatarImageUrl}
				className="inline-flex"
				isCenterAgent={input.profile.isCenterAgent}
				profileId={input.profile.profileId}
				profileKind={input.profile.profileKind}
				profileName={input.profile.profileName}
				size="inline"
			/>
			<strong className="min-w-0 truncate font-semibold">
				{input.profile.profileName}
			</strong>
			<span className="shrink-0 border-border border-l pl-1.5 font-medium text-muted-foreground text-xs">
				{relationLabel}
			</span>
		</>
	);
	const tokenClassName =
		"inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-middle text-foreground ring-1 ring-border/70";

	if (!input.onOpenAgentProfile) {
		return (
			<span className={tokenClassName} data-slot="space-message-agent-mention">
				{content}
			</span>
		);
	}

	return (
		<button
			aria-label={`Open ${input.profile.profileName} profile (${relationLabel})`}
			className={`${tokenClassName} cursor-pointer border-0 transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
			data-slot="space-message-agent-mention"
			onClick={() => input.onOpenAgentProfile?.(input.profile.profileId)}
			type="button"
		>
			{content}
		</button>
	);
}

function splitSpaceMessageAgentMentionText(
	text: string,
	profilesById: SpaceMessageAgentMentionProfilesById,
	occurrenceCountByProfileId = new Map<string, number>()
): readonly SpaceMessageAgentMentionSegment<SpaceMessageAgentMentionPresentation>[] {
	const candidates = [...profilesById.values()]
		.flatMap((profile) => {
			const mentionText = `@${profile.profileName}`;
			const matches: Array<{
				end: number;
				mentionText: string;
				profile: SpaceMessageAgentMentionPresentation;
				start: number;
			}> = [];
			let start = text.indexOf(mentionText);
			while (start >= 0) {
				matches.push({
					end: start + mentionText.length,
					mentionText,
					profile,
					start,
				});
				start = text.indexOf(mentionText, start + mentionText.length);
			}
			return matches;
		})
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
