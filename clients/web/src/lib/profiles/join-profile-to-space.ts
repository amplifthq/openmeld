import type { AuthProfileView } from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { recordProfileSpaceHistory } from "#/lib/onboarding/record-profile-space-history";
import { buildProfileRequestContext } from "#/lib/profiles/human-profiles";
import { createWebSpaceApi } from "#/lib/spaces/api";
import { applySpaceMembersResponseToCache } from "#/lib/spaces/member-cache";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

// Route-free "add a profile to a Space" step. Mirrors the in-space
// useSpaceAddProfilesHandler (space-landing.tsx) so the standalone Create
// Profile dialog can optionally join the freshly created profile into the
// current Space without depending on StartFlow space-entry. Membership is
// always managed by a human acting profile (see callers); addMembers is an
// idempotent upsert.

export type JoinProfileToSpaceResult = {
	addedCount: number;
	alreadyMemberCount: number;
};

export async function joinProfileToSpace(input: {
	actingHumanProfile: AuthProfileView;
	memberProfileIds: readonly string[];
	pendingWakeReadinessProfileIds?: readonly string[];
	queryClient: QueryClient;
	spaceId: string;
	spaceName: string | null;
}): Promise<JoinProfileToSpaceResult> {
	const memberProfileIds = normalizeJoinMemberProfileIds(
		input.memberProfileIds
	);
	if (memberProfileIds.length === 0) {
		return { addedCount: 0, alreadyMemberCount: 0 };
	}

	const actingProfileId = input.actingHumanProfile.openMeldProfileId;
	// Only the addMembers write is load-bearing — once it resolves the member is
	// added server-side, so the best-effort steps below must never reject the
	// join (mirrors the in-space useSpaceAddProfilesHandler).
	const addMembersResult = await createWebSpaceApi({
		openMeldProfileId: actingProfileId,
	}).addMembers({
		memberProfileIds,
		requestContext: buildProfileRequestContext(input.actingHumanProfile),
		spaceId: input.spaceId,
	});
	applySpaceMembersResponseToCache({
		pendingWakeReadinessProfileIds: input.pendingWakeReadinessProfileIds,
		queryClient: input.queryClient,
		response: addMembersResult,
		spaceId: input.spaceId,
		viewerProfileId: actingProfileId,
	});

	recordProfileSpaceHistory({
		creatorKind: input.actingHumanProfile.profileKind,
		creatorProfileId: actingProfileId,
		profileIds: memberProfileIds,
		spaceId: input.spaceId,
		spaceName: input.spaceName,
	}).catch((error) => {
		console.warn(
			"OpenMeld added the profile to the Space but could not record Space history.",
			error
		);
	});

	(async () => {
		await Promise.all([
			input.queryClient.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
			}),
			// Prefix match so every viewer-identity variant of the Space members /
			// status queries is marked stale, not just the acting human's.
			input.queryClient.invalidateQueries({
				queryKey: ["spaces", "members", input.spaceId],
			}),
			input.queryClient.invalidateQueries({
				queryKey: ["spaces", "status", input.spaceId],
			}),
		]);
	})().catch((error) => {
		console.warn(
			"OpenMeld added the profile to the Space but could not refresh Space caches.",
			error
		);
	});

	return {
		addedCount: addMembersResult.addedMemberIds.length,
		alreadyMemberCount: addMembersResult.alreadyMemberIds.length,
	};
}

function normalizeJoinMemberProfileIds(
	profileIds: readonly string[]
): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const candidate of profileIds) {
		const profileId = candidate.trim();
		if (profileId.length === 0 || seen.has(profileId)) {
			continue;
		}
		seen.add(profileId);
		normalized.push(profileId);
	}
	return normalized;
}
