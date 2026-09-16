import type { AuthProfileView } from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAccountSpaceItems } from "#/lib/spaces/account-spaces";
import { createSpaceInOrganization } from "#/lib/spaces/create-space-in-organization";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	readWelcomeSpace,
	saveWelcomeSpace,
} from "../spaces/welcome-space-state";

/** Select an ordinary Space through the existing creation and membership owners. */
export function useDeskSpace(input: {
	profile: AuthProfileView | null | undefined;
	organizationId: string;
	storageScope: string;
}) {
	const client = useQueryClient();
	const profile = input.profile;
	const key = `openmeld.desk.space:${input.storageScope}:${input.organizationId}`;
	function prepareWelcome(spaceId: string) {
		if (
			!profile ||
			readWelcomeSpace(input.storageScope, spaceId) !== "prepare"
		) {
			return;
		}
		saveWelcomeSpace(input.storageScope, spaceId, "add");
	}
	const query = useQuery({
		queryKey: ["desk-space", key, profile?.openMeldProfileId],
		enabled: !!profile,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		queryFn: async () => {
			if (!profile) {
				throw new Error("Choose a profile to open your Desk.");
			}
			return await navigator.locks.request(key, async () => {
				const saved = localStorage.getItem(key);
				const replacedDefaultSpaceId =
					saved &&
					saved !== "creating" &&
					!readWelcomeSpace(input.storageScope, saved)
						? saved
						: undefined;
				const sections = await listAccountSpaceItems({
					profileId: profile.openMeldProfileId,
				});
				if (
					saved &&
					saved !== "creating" &&
					readWelcomeSpace(input.storageScope, saved)
				) {
					prepareWelcome(saved);
					return {
						spaceId: saved,
						profileId: profile.openMeldProfileId,
					};
				}
				const existing = [...sections.pinnedItems, ...sections.spaceItems].find(
					(item) =>
						item.organizationId === input.organizationId &&
						(readWelcomeSpace(input.storageScope, item.spaceId) !== null ||
							item.spaceName === "Welcome Space") &&
						!item.directMessageProfileIds &&
						item.joinedProfiles.some(
							(joined) => joined.profileId === profile.openMeldProfileId
						)
				);
				if (existing) {
					localStorage.setItem(key, existing.spaceId);
					if (!readWelcomeSpace(input.storageScope, existing.spaceId)) {
						saveWelcomeSpace(input.storageScope, existing.spaceId, "add");
					}
					prepareWelcome(existing.spaceId);
					return {
						spaceId: existing.spaceId,
						replacedDefaultSpaceId,
						profileId: profile.openMeldProfileId,
					};
				}
				// A lost create response must never silently create a second Space.
				if (saved === "creating") {
					throw new Error(
						"Couldn’t confirm your Space was created. Check Spaces before trying again."
					);
				}
				localStorage.setItem(key, "creating");
				const created = await createSpaceInOrganization({
					actingProfile: profile,
					organizationId: input.organizationId,
					space: {
						name: "Welcome Space",
						accessMode: "members_only",
						visibility: "private",
					},
				});
				localStorage.setItem(key, created.spaceId);
				saveWelcomeSpace(input.storageScope, created.spaceId, "add");
				await client.invalidateQueries({ queryKey: accountSpaceQueryKeys.all });
				return {
					spaceId: created.spaceId,
					replacedDefaultSpaceId,
					profileId: profile.openMeldProfileId,
				};
			});
		},
	});
	return {
		spaceId: query.data?.spaceId,
		profileId: query.data?.profileId,
		replacedDefaultSpaceId: query.data?.replacedDefaultSpaceId,
		ready: query.isSuccess,
		error: query.error?.message,
		retry: () => {
			return query.refetch();
		},
	};
}
