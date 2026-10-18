import type { HarnessKind } from "@openmeld/schemas";
import type {
	AuthProfileView,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import type { MemberAgentIndex } from "./member-agent-index";
import {
	aggregateMemberAgentPresence,
	type MemberAgentPresence,
} from "./member-agent-presence";

type RuntimeOverviewItem =
	OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number];

export type MemberAgentLatestSession = {
	spaceId: string;
	title: string;
	profileId: string;
	at: number;
};

export type MemberAgentDirectoryRow = {
	memberAgentId: string;
	harnessKind: HarnessKind;
	displayName: string;
	archived: boolean;
	defaultProfileId: string | null;
	/** Profiles visible in this Organization, default Profile first. */
	profiles: readonly AuthProfileView[];
	presence: MemberAgentPresence;
	latestSession: MemberAgentLatestSession | null;
};

export type UnassignedAgentProfile = {
	profile: AuthProfileView;
	/**
	 * True when the listing names it unassigned: the controller switcher is its
	 * assignment action. False for a Profile the listing does not know yet
	 * (created after the read); it still shows, without the switcher.
	 */
	assignable: boolean;
};

export type MemberAgentDirectory = {
	rows: readonly MemberAgentDirectoryRow[];
	unassigned: readonly UnassignedAgentProfile[];
};

/**
 * Groups the signed-in member's own agent Profiles by MemberAgent. Every
 * owned, unmanaged Profile lands in exactly one row or in the unassigned
 * section, so no existing Profile disappears from the Agents list.
 */
export function buildMemberAgentDirectory(input: {
	index: MemberAgentIndex;
	ownedProfiles: readonly AuthProfileView[];
	runtimeByProfileId: ReadonlyMap<string, RuntimeOverviewItem>;
	directMessages?: readonly AccountSpaceItem[];
	conversationTitle?: (item: AccountSpaceItem) => string;
}): MemberAgentDirectory {
	const profilesById = new Map(
		input.ownedProfiles
			.filter(
				(profile) => profile.profileKind === "agent" && !profile.managedRole
			)
			.map((profile) => [profile.openMeldProfileId, profile])
	);
	const placed = new Set<string>();
	const rows = input.index.memberAgents.map(
		(entry): MemberAgentDirectoryRow => {
			const defaultProfileId = entry.memberAgent.defaultProfileId;
			const profiles = entry.memberAgent.profiles
				.map((summary) => profilesById.get(summary.openMeldProfileId))
				.filter((profile): profile is AuthProfileView => profile !== undefined)
				.sort(
					(left, right) =>
						Number(right.openMeldProfileId === defaultProfileId) -
							Number(left.openMeldProfileId === defaultProfileId) ||
						left.profileName.localeCompare(right.profileName, "en")
				);
			for (const profile of profiles) {
				placed.add(profile.openMeldProfileId);
			}
			const profileIds = profiles.map((profile) => profile.openMeldProfileId);
			return {
				memberAgentId: entry.memberAgent.id,
				harnessKind: entry.harnessKind,
				displayName: entry.displayName,
				archived: entry.memberAgent.archivedAt !== null,
				defaultProfileId,
				profiles,
				presence: aggregateMemberAgentPresence({
					profileIds,
					runtimeByProfileId: input.runtimeByProfileId,
				}),
				latestSession: resolveLatestMemberAgentSession({
					profileIds,
					directMessages: input.directMessages ?? [],
					conversationTitle:
						input.conversationTitle ?? ((item) => item.spaceName ?? "New chat"),
				}),
			};
		}
	);
	const unassigned = [...profilesById.values()]
		.filter((profile) => !placed.has(profile.openMeldProfileId))
		.map((profile) => ({
			profile,
			assignable: input.index.unassignedProfileIds.has(
				profile.openMeldProfileId
			),
		}))
		.sort((left, right) =>
			left.profile.profileName.localeCompare(right.profile.profileName, "en")
		);
	return {
		rows: [...rows].sort(
			(left, right) =>
				Number(left.archived) - Number(right.archived) ||
				(right.latestSession?.at ?? 0) - (left.latestSession?.at ?? 0) ||
				left.displayName.localeCompare(right.displayName, "en")
		),
		unassigned,
	};
}

/** The most recent Direct Message Session with any of the given Profiles. */
export function resolveLatestMemberAgentSession(input: {
	profileIds: readonly string[];
	directMessages: readonly AccountSpaceItem[];
	conversationTitle: (item: AccountSpaceItem) => string;
}): MemberAgentLatestSession | null {
	const profileIds = new Set(input.profileIds);
	let latest: MemberAgentLatestSession | null = null;
	for (const item of input.directMessages) {
		const profileId = item.directMessageProfileIds?.find((id) =>
			profileIds.has(id)
		);
		if (!profileId) {
			continue;
		}
		const at = Math.max(
			item.messagePreview?.timestamp ?? 0,
			Date.parse(item.spaceCreatedAt ?? "") || 0
		);
		if (!latest || at > latest.at) {
			latest = {
				spaceId: item.spaceId,
				title: input.conversationTitle(item),
				profileId,
				at,
			};
		}
	}
	return latest;
}
