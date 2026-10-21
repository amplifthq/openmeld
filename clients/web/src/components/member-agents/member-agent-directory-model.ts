import type { HarnessKind, MemberAgentPresence } from "@openmeld/schemas";
import type {
	AuthProfileView,
	OrganizationAgentRuntimeOverviewResponse,
} from "@openmeld/schemas/types";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import type { MemberAgentIndex } from "./member-agent-index";
import {
	type MemberAgentPresenceView,
	resolveMemberAgentPresence,
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
	/**
	 * `creating` while a new MemberAgent's Profiles are not readable yet:
	 * the default Profile is still being written, or the Profile reads have
	 * not caught up with the listing. Such a row is never final.
	 */
	setup: "creating" | "ready";
	presence: MemberAgentPresenceView;
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
	/** Core's derived presence, keyed by MemberAgent id. */
	presenceByMemberAgentId?: ReadonlyMap<string, MemberAgentPresence>;
	directMessages?: readonly AccountSpaceItem[];
	/** Archived Session Spaces never count as the latest Session. */
	archivedSpaceIds?: ReadonlySet<string>;
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
			const archived = entry.memberAgent.archivedAt !== null;
			return {
				memberAgentId: entry.memberAgent.id,
				harnessKind: entry.harnessKind,
				displayName: entry.displayName,
				archived,
				defaultProfileId,
				profiles,
				setup: resolveMemberAgentSetup({
					archived,
					listedProfileCount: entry.memberAgent.profiles.length,
					memberAgent: entry.memberAgent,
					visibleProfileCount: profiles.length,
				}),
				presence: resolveMemberAgentPresence({
					presence: input.presenceByMemberAgentId?.get(entry.memberAgent.id),
					profileIds,
					runtimeByProfileId: input.runtimeByProfileId,
				}),
				latestSession: resolveLatestMemberAgentSession({
					profileIds,
					directMessages: (input.directMessages ?? []).filter(
						(item) => !input.archivedSpaceIds?.has(item.spaceId)
					),
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

function resolveMemberAgentSetup(input: {
	archived: boolean;
	listedProfileCount: number;
	memberAgent: MemberAgentIndex["memberAgents"][number]["memberAgent"];
	visibleProfileCount: number;
}): MemberAgentDirectoryRow["setup"] {
	// Only a detected MemberAgent is created automatically; a migrated or
	// manual one always shows what it has.
	if (input.archived || input.memberAgent.source !== "detected") {
		return "ready";
	}
	return input.visibleProfileCount < input.listedProfileCount ||
		input.memberAgent.defaultProfileId === null
		? "creating"
		: "ready";
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

/**
 * The directory narrowed to the given Profiles, in their order: a MemberAgent
 * row shows while any of its Profiles does and sits where its first visible
 * Profile does; archived rows stay last. Unless `filtered`, a row with no
 * readable Profile yet (still being set up) stays too, after the others.
 */
export function narrowMemberAgentDirectory(input: {
	directory: MemberAgentDirectory;
	visibleProfileIds: readonly string[];
	filtered: boolean;
}): MemberAgentDirectory {
	const position = new Map(
		input.visibleProfileIds.map((profileId, index) => [profileId, index])
	);
	const rowPosition = (row: MemberAgentDirectoryRow) =>
		Math.min(
			...row.profiles.map(
				(profile) =>
					position.get(profile.openMeldProfileId) ?? Number.POSITIVE_INFINITY
			)
		);
	const rows = input.directory.rows
		.filter((row) =>
			row.profiles.length === 0
				? !input.filtered
				: Number.isFinite(rowPosition(row))
		)
		.map((row, index) => ({ row, index, at: rowPosition(row) }))
		.sort(
			(left, right) =>
				Number(left.row.archived) - Number(right.row.archived) ||
				left.at - right.at ||
				left.index - right.index
		)
		.map(({ row }) => row);
	return {
		rows,
		unassigned: input.directory.unassigned
			.filter((entry) => position.has(entry.profile.openMeldProfileId))
			.sort(
				(left, right) =>
					(position.get(left.profile.openMeldProfileId) ?? 0) -
					(position.get(right.profile.openMeldProfileId) ?? 0)
			),
	};
}
