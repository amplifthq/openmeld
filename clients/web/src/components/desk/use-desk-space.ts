import type { AuthProfileView } from "@openmeld/schemas/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readCurrentCenterAgentDesignation } from "#/lib/organizations/center-agent";
import { listAccountSpaceItems } from "#/lib/spaces/account-spaces";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
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
	async function prepareWelcome(spaceId: string) {
		if (
			!profile ||
			readWelcomeSpace(input.storageScope, spaceId) !== "prepare"
		) {
			return;
		}
		const { designation } = await readCurrentCenterAgentDesignation({
			organizationId: input.organizationId,
		});
		if (designation?.agentProfileId) {
			await createOrganizationScopedWebSpaceApi({
				organizationId: input.organizationId,
				openMeldProfileId: profile.openMeldProfileId,
			}).addOrganizationDirectoryProfilesToSpace({
				spaceId,
				directoryProfileIds: [designation.agentProfileId],
				expectedCenterAgentProfileId: designation.agentProfileId,
			});
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
				const sections = await listAccountSpaceItems({
					profileId: profile.openMeldProfileId,
				});
				if (saved && saved !== "creating") {
					await prepareWelcome(saved);
					return {
						spaceId: saved,
						profileId: profile.openMeldProfileId,
					};
				}
				const existing = [...sections.pinnedItems, ...sections.spaceItems].find(
					(item) =>
						item.organizationId === input.organizationId &&
						!item.directMessageProfileIds &&
						item.joinedProfiles.some(
							(joined) => joined.profileId === profile.openMeldProfileId
						)
				);
				if (existing) {
					localStorage.setItem(key, existing.spaceId);
					return {
						spaceId: existing.spaceId,
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
				saveWelcomeSpace(input.storageScope, created.spaceId, "prepare");
				await prepareWelcome(created.spaceId);
				await client.invalidateQueries({ queryKey: accountSpaceQueryKeys.all });
				return {
					spaceId: created.spaceId,
					profileId: profile.openMeldProfileId,
				};
			});
		},
	});
	const restart = useMutation({
		mutationFn: async () => {
			if (!profile) {
				throw new Error("Choose a profile first.");
			}
			await navigator.locks.request(key, async () => {
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
				saveWelcomeSpace(input.storageScope, created.spaceId, "prepare");
				await client.invalidateQueries({ queryKey: accountSpaceQueryKeys.all });
			});
			await query.refetch({ throwOnError: true });
		},
	});
	return {
		spaceId: query.data?.spaceId,
		profileId: query.data?.profileId,
		ready: query.isSuccess,
		error: query.error?.message ?? restart.error?.message,
		restart: () => restart.mutateAsync(),
		isRestarting: restart.isPending,
		retry: () => {
			restart.reset();
			return query.refetch();
		},
	};
}
