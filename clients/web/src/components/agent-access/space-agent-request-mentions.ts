import type {
	GetSpaceStatusResponse,
	OrganizationDirectoryResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { isDirectMessageSpace } from "@openmeld/space";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	type OrganizationSpaceProfileCandidates,
	organizationDirectoryQueryOptions,
	organizationSpaceProfileCandidatesQueryOptions,
} from "#/query/organizations/organization-directory";

// Mentioning a colleague's Agent that is not in this Space asks its owner
// (member-agent-program.md §4.6, §5, §7 "Bringing an Agent into a Space").
// The message posts with the owner-qualified name as text
// ("@Tali Smoke's Codex"), so it never reads as a member's mention; the
// request binds to it.

const NO_ITEMS: readonly SpaceAgentRequestMentionItem[] = [];

/** Wake availability from the organization directory, in its shared wording. */
export type SpaceAgentRequestMentionAvailability = NonNullable<
	OrganizationDirectoryResponse["agentProfiles"][number]["readiness"]["agentWakeAvailability"]
>;

/** A colleague's Agent the composer can mention by asking its owner. */
export type SpaceAgentRequestMentionItem = {
	agentControllerRef: string | null;
	availability: SpaceAgentRequestMentionAvailability | null;
	avatarUrl: string | null;
	/** The text after "@": the owner-qualified name. */
	mentionName: string;
	ownerName: string;
	ownerUserId: string;
	profileHandle: string | null;
	profileId: string;
	profileName: string;
};

export type SpaceAgentRequestMentions = {
	items: readonly SpaceAgentRequestMentionItem[];
	onSelect: (item: SpaceAgentRequestMentionItem) => void;
};

export type SpaceAgentRequestMentionSelection = Pick<
	SpaceAgentRequestMentionItem,
	"profileId" | "profileName"
>;

/**
 * Active personal Agents of other owners that are not in the Space. Only the
 * profile id decides membership: a colleague's Agent that shares a name or
 * Harness with a member is still a different Agent.
 */
export function buildSpaceAgentRequestMentionItems(input: {
	agentProfiles: OrganizationSpaceProfileCandidates["agentProfiles"];
	availabilityByProfileId?: ReadonlyMap<
		string,
		SpaceAgentRequestMentionAvailability
	>;
	currentUserId: string;
	snapshot: SpaceMembersSnapshot;
}): readonly SpaceAgentRequestMentionItem[] {
	const memberIds = new Set(
		[...input.snapshot.humans, ...input.snapshot.agents].map(
			(member) => member.profileId
		)
	);
	return input.agentProfiles
		.flatMap((profile): SpaceAgentRequestMentionItem[] =>
			profile.status === "active" &&
			!profile.isCenterAgent &&
			profile.ownerUserId &&
			profile.ownerUserId !== input.currentUserId &&
			!memberIds.has(profile.profileId)
				? [
						{
							agentControllerRef: profile.agentControllerRef ?? null,
							availability:
								input.availabilityByProfileId?.get(profile.profileId) ?? null,
							avatarUrl: profile.avatarUrl ?? null,
							mentionName: `${profile.ownerName ?? "Its owner"}'s ${profile.profileName}`,
							ownerName: profile.ownerName ?? "Its owner",
							ownerUserId: profile.ownerUserId,
							profileHandle: profile.profileHandle ?? null,
							profileId: profile.profileId,
							profileName: profile.profileName,
						},
					]
				: []
		)
		.sort(
			(left, right) =>
				left.ownerName.localeCompare(right.ownerName) ||
				left.profileName.localeCompare(right.profileName)
		);
}

/** The owner groups, in order, for the mention picker. */
export function groupSpaceAgentRequestMentionItems(
	items: readonly SpaceAgentRequestMentionItem[]
): readonly {
	ownerName: string;
	ownerUserId: string;
	items: readonly SpaceAgentRequestMentionItem[];
}[] {
	const groups = new Map<
		string,
		{ ownerName: string; items: SpaceAgentRequestMentionItem[] }
	>();
	for (const item of items) {
		const group = groups.get(item.ownerUserId) ?? {
			ownerName: item.ownerName,
			items: [],
		};
		group.items.push(item);
		groups.set(item.ownerUserId, group);
	}
	return [...groups].map(([ownerUserId, group]) => ({
		ownerUserId,
		...group,
	}));
}

const MENTION_NAME_CONTINUATION = /[\p{L}\p{N}_]/u;

/** Adds a choice; a later choice of the same name replaces the earlier one. */
export function addAgentRequestMentionSelection(
	selections: readonly SpaceAgentRequestMentionSelection[],
	item: SpaceAgentRequestMentionSelection
): readonly SpaceAgentRequestMentionSelection[] {
	if (
		selections.some(
			(selection) =>
				selection.profileId === item.profileId &&
				selection.profileName === item.profileName
		)
	) {
		return selections;
	}
	return [
		...selections.filter(
			(selection) =>
				selection.profileId !== item.profileId &&
				selection.profileName !== item.profileName
		),
		{ profileId: item.profileId, profileName: item.profileName },
	];
}

/**
 * Chosen Agents whose whole mention is still in the text being sent. Longer
 * names match first and consume their text, so `@Reviewer Pro` never also
 * counts as `@Reviewer`.
 */
export function resolveAgentRequestMentionProfileIds(input: {
	selections: readonly SpaceAgentRequestMentionSelection[];
	text: string;
}): readonly string[] {
	let remaining = input.text;
	const profileIds: string[] = [];
	const longestFirst = [...input.selections].sort(
		(left, right) => right.profileName.length - left.profileName.length
	);
	for (const selection of longestFirst) {
		const mention = `@${selection.profileName}`;
		let found = false;
		let index = remaining.indexOf(mention);
		while (index !== -1) {
			const end = index + mention.length;
			const next = remaining.charAt(end);
			if (!(next && MENTION_NAME_CONTINUATION.test(next))) {
				found = true;
				remaining = `${remaining.slice(0, index)}${" ".repeat(mention.length)}${remaining.slice(end)}`;
			}
			index = remaining.indexOf(mention, index + 1);
		}
		if (found) {
			profileIds.push(selection.profileId);
		}
	}
	return profileIds;
}

/**
 * Candidates for a group Space only: a Direct Message must become a Space
 * before an Agent can be asked in.
 */
export function useSpaceAgentRequestMentions(input: {
	onSelect: (item: SpaceAgentRequestMentionItem) => void;
	snapshot: SpaceMembersSnapshot | null;
	status: Pick<
		GetSpaceStatusResponse,
		"directMessageConvertedAt" | "spacePurpose"
	> | null;
}): SpaceAgentRequestMentions | undefined {
	const organization = useOptionalAppOrganization();
	const currentUserId = organization?.currentUserId ?? "";
	const enabled =
		isMemberAgentsEnabled() &&
		Boolean(organization && currentUserId && input.status) &&
		!(
			input.status &&
			isDirectMessageSpace({
				directMessageConvertedAt: input.status.directMessageConvertedAt,
				purpose: input.status.spacePurpose,
			})
		) &&
		input.snapshot !== null;
	const directory = useQuery(
		organizationSpaceProfileCandidatesQueryOptions({
			enabled,
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	// The profile directory has no availability; the organization directory
	// carries each Agent's shared Wake availability.
	const availabilityDirectory = useQuery(
		organizationDirectoryQueryOptions({
			enabled,
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const availabilityByProfileId = useMemo(
		() =>
			new Map(
				(availabilityDirectory.data?.agentProfiles ?? []).flatMap((profile) =>
					profile.readiness.agentWakeAvailability
						? [
								[
									profile.profileId,
									profile.readiness.agentWakeAvailability,
								] as const,
							]
						: []
				)
			),
		[availabilityDirectory.data]
	);
	const items = useMemo(
		() =>
			enabled && input.snapshot && directory.data
				? buildSpaceAgentRequestMentionItems({
						agentProfiles: directory.data.agentProfiles,
						availabilityByProfileId,
						currentUserId,
						snapshot: input.snapshot,
					})
				: NO_ITEMS,
		[
			availabilityByProfileId,
			currentUserId,
			directory.data,
			enabled,
			input.snapshot,
		]
	);
	return useMemo(
		() => (items.length > 0 ? { items, onSelect: input.onSelect } : undefined),
		[items, input.onSelect]
	);
}
