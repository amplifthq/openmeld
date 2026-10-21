import {
	accountSpaceIndexItemSchema,
	listAgentDirectMessageSessionsResponseSchema,
	listCenterAgentSessionsResponseSchema,
	listMemberAgentDirectMessageSessionsResponseSchema,
	listMemberAgentsResponseSchema,
	memberAgentDirectMessageSessionSummarySchema,
	organizationProfileDirectoryResponseSchema,
} from "@openmeld/schemas";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { z } from "zod/v4";
import { agentDirectMessageSessionQueryKeys } from "#/query/organizations/agent-direct-message-sessions";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

// Display only. The reads the conversations sidebar paints from, saved when
// they last loaded, so a hard refresh paints the rows on the first frame. The
// seeded reads are marked stale and reread on mount; the server still decides
// every action.
const accountSpaceItemDisplaySchema = accountSpaceIndexItemSchema
	.pick({
		activeAgentCount: true,
		activeHumanCount: true,
		activeMemberCount: true,
		deletedAt: true,
		directMessageConvertedAt: true,
		directMessageProfileIds: true,
		joinedProfiles: true,
		lastJoinedAt: true,
		lastSeenTs: true,
		memberPreviews: true,
		messagePreview: true,
		openProfileId: true,
		openProfileName: true,
		organizationId: true,
		pinnedAt: true,
		pinnedProfileIds: true,
		recentMessagePreviews: true,
		spaceCreatedAt: true,
		spaceId: true,
		spaceName: true,
		spacePurpose: true,
		spaceUpdatedAt: true,
		visibility: true,
	})
	.partial({ spaceCreatedAt: true, spaceUpdatedAt: true });

const accountSpaceSectionsDisplaySchema = z.strictObject({
	pinnedItems: z.array(accountSpaceItemDisplaySchema),
	// Deleted-Space notices are shown once; a restored copy must not repeat them.
	recentlyDeletedItems: z.array(z.never()).max(0),
	spaceItems: z.array(accountSpaceItemDisplaySchema),
});

const MAX_AGENT_SESSION_LISTS = 24;

// The merged pages of the one MemberAgent Session read.
const memberAgentSessionsDisplaySchema =
	listMemberAgentDirectMessageSessionsResponseSchema.extend({
		sessions: z.array(memberAgentDirectMessageSessionSummarySchema).max(2000),
	});

export const sidebarDisplaySnapshotSchema = z.strictObject({
	version: z.literal(1),
	profileId: z.string().min(1),
	accountSpaces: accountSpaceSectionsDisplaySchema.nullable(),
	centerAgentSessions: listCenterAgentSessionsResponseSchema.nullable(),
	memberAgents: listMemberAgentsResponseSchema.nullable(),
	profileDirectory: organizationProfileDirectoryResponseSchema.nullable(),
	agentSessions: z
		.array(
			z.strictObject({
				agentProfileId: z.string().min(1),
				archived: z.boolean(),
				data: listAgentDirectMessageSessionsResponseSchema,
			})
		)
		.max(MAX_AGENT_SESSION_LISTS),
	// Optional: snapshots saved before this read existed still restore.
	memberAgentSessions: memberAgentSessionsDisplaySchema.nullable().optional(),
});
export type SidebarDisplaySnapshot = z.infer<
	typeof sidebarDisplaySnapshotSchema
>;

export function sidebarDisplaySnapshotQueryKey(
	ownerAccountId: string,
	organizationId: string
) {
	return [
		"spaces",
		"sidebar-display-snapshot",
		ownerAccountId,
		organizationId,
	] as const;
}

const SOURCE_KEY_ROOTS: ReadonlySet<unknown> = new Set([
	accountSpaceQueryKeys.all[0],
	agentDirectMessageSessionQueryKeys.root[0],
	centerAgentSessionsQueryOptions("", "").queryKey[0],
	memberAgentQueryKeys.all("")[0],
	organizationQueryKeys.profileIdentityDirectory("")[0],
]);

/** Whether a read can change what the sidebar snapshot holds. */
export function isSidebarSnapshotSource(queryKey: readonly unknown[]): boolean {
	return SOURCE_KEY_ROOTS.has(queryKey[0]);
}

function parsedOrNull<T>(schema: z.ZodType<T>, data: unknown): T | null {
	if (data === undefined) {
		return null;
	}
	const parsed = schema.safeParse(data);
	return parsed.success ? parsed.data : null;
}

/** Reads the sidebar's current data into a snapshot, or null if none loaded. */
export function readSidebarDisplaySnapshot(
	queryClient: QueryClient,
	input: { organizationId: string; profileId: string }
): SidebarDisplaySnapshot | null {
	const { organizationId, profileId } = input;
	const accountSpaces = queryClient.getQueryData<{
		pinnedItems: unknown;
		spaceItems: unknown;
	}>(accountSpaceQueryKeys.items(profileId, "account"));
	const centerAgentSessions = queryClient.getQueryData<
		InfiniteData<unknown, unknown>
	>(centerAgentSessionsQueryOptions(organizationId, profileId).queryKey);
	const agentSessions = queryClient
		.getQueriesData({
			queryKey: agentDirectMessageSessionQueryKeys.all(organizationId),
		})
		.flatMap(([queryKey, data]) => {
			const agentProfileId = queryKey[2];
			const state = queryKey[3];
			const parsed = parsedOrNull(
				listAgentDirectMessageSessionsResponseSchema,
				data
			);
			if (
				queryKey.length !== 4 ||
				typeof agentProfileId !== "string" ||
				(state !== "active" && state !== "archived") ||
				!parsed
			) {
				return [];
			}
			return [{ agentProfileId, archived: state === "archived", data: parsed }];
		})
		.slice(0, MAX_AGENT_SESSION_LISTS);
	const snapshot: SidebarDisplaySnapshot = {
		version: 1,
		profileId,
		accountSpaces: accountSpaces
			? parsedOrNull(accountSpaceSectionsDisplaySchema, {
					pinnedItems: accountSpaces.pinnedItems,
					recentlyDeletedItems: [],
					spaceItems: accountSpaces.spaceItems,
				})
			: null,
		centerAgentSessions: parsedOrNull(
			listCenterAgentSessionsResponseSchema,
			centerAgentSessions?.pages[0]
		),
		memberAgents: parsedOrNull(
			listMemberAgentsResponseSchema,
			queryClient.getQueryData(memberAgentQueryKeys.all(organizationId))
		),
		profileDirectory: parsedOrNull(
			organizationProfileDirectoryResponseSchema,
			queryClient.getQueryData(
				organizationQueryKeys.profileIdentityDirectory(organizationId)
			)
		),
		agentSessions,
		memberAgentSessions: parsedOrNull(
			memberAgentSessionsDisplaySchema,
			queryClient.getQueryData(
				agentDirectMessageSessionQueryKeys.memberAgents(organizationId)
			)
		),
	};
	return snapshot.accountSpaces || snapshot.centerAgentSessions
		? snapshot
		: null;
}

/**
 * Puts a restored snapshot into the reads it came from when they have no data
 * yet. Each seeded read is marked stale so its observer rereads it on mount.
 */
export function seedSidebarDisplaySnapshot(
	queryClient: QueryClient,
	input: { organizationId: string; ownerAccountId: string }
): void {
	const parsed = sidebarDisplaySnapshotSchema.safeParse(
		queryClient.getQueryData(
			sidebarDisplaySnapshotQueryKey(input.ownerAccountId, input.organizationId)
		)
	);
	if (!parsed.success) {
		return;
	}
	const snapshot = parsed.data;
	const { organizationId } = input;
	const seeds: [readonly unknown[], unknown][] = [
		[
			accountSpaceQueryKeys.items(snapshot.profileId, "account"),
			snapshot.accountSpaces,
		],
		[
			centerAgentSessionsQueryOptions(organizationId, snapshot.profileId)
				.queryKey,
			snapshot.centerAgentSessions && {
				pageParams: [undefined],
				pages: [snapshot.centerAgentSessions],
			},
		],
		[memberAgentQueryKeys.all(organizationId), snapshot.memberAgents],
		[
			organizationQueryKeys.profileIdentityDirectory(organizationId),
			snapshot.profileDirectory,
		],
		[
			agentDirectMessageSessionQueryKeys.memberAgents(organizationId),
			snapshot.memberAgentSessions ?? null,
		],
		...snapshot.agentSessions.map(
			(list) =>
				[
					agentDirectMessageSessionQueryKeys.list({
						agentProfileId: list.agentProfileId,
						archived: list.archived,
						organizationId,
					}),
					list.data,
				] as [readonly unknown[], unknown]
		),
	];
	for (const [queryKey, data] of seeds) {
		if (data === null || queryClient.getQueryData(queryKey) !== undefined) {
			continue;
		}
		queryClient.setQueryData(queryKey, data);
		queryClient.getQueryCache().find({ exact: true, queryKey })?.invalidate();
	}
}
