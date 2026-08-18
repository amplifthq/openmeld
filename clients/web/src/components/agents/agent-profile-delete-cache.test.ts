import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	invalidateAgentProfileListCaches,
	optimisticallyRemoveAgentProfileFromListCaches,
	restoreAgentProfileListCaches,
} from "./agent-profile-delete-cache";

const REMOVED_PROFILE_ID = "agt-remove";

describe("Agent Profile delete list caches", () => {
	it("removes the Agent from every matching list cache and restores the exact snapshots", async () => {
		const queryClient = new QueryClient();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-1");
		const otherAccountProfilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-2");
		const acmeDirectoryQueryKey = organizationQueryKeys.directory("org-acme");
		const betaDirectoryQueryKey = organizationQueryKeys.directory("org-beta");
		const roleQueryKey = organizationQueryKeys.role("org-acme", "account-1");
		const profiles = [
			createProfile(REMOVED_PROFILE_ID),
			createProfile("agt-keep"),
		];
		const acmeDirectory = createDirectory("org-acme", [REMOVED_PROFILE_ID]);
		const betaDirectory = createDirectory("org-beta", [
			REMOVED_PROFILE_ID,
			"agt-keep",
		]);
		queryClient.setQueryData(profilesQueryKey, profiles);
		queryClient.setQueryData(otherAccountProfilesQueryKey, [
			createProfile(REMOVED_PROFILE_ID),
		]);
		queryClient.setQueryData(acmeDirectoryQueryKey, acmeDirectory);
		queryClient.setQueryData(betaDirectoryQueryKey, betaDirectory);
		queryClient.setQueryData(roleQueryKey, "owner");

		const snapshot = await optimisticallyRemoveAgentProfileFromListCaches({
			agentProfileId: REMOVED_PROFILE_ID,
			queryClient,
			storageScope: "account-1",
		});

		expect(queryClient.getQueryData(profilesQueryKey)).toEqual([
			createProfile("agt-keep"),
		]);
		expect(queryClient.getQueryData(otherAccountProfilesQueryKey)).toEqual([
			createProfile(REMOVED_PROFILE_ID),
		]);
		expect(
			queryClient.getQueryData<OrganizationDirectoryResponse>(
				acmeDirectoryQueryKey
			)?.agentProfiles
		).toEqual([]);
		expect(
			queryClient
				.getQueryData<OrganizationDirectoryResponse>(betaDirectoryQueryKey)
				?.agentProfiles.map((profile) => profile.profileId)
		).toEqual(["agt-keep"]);
		expect(queryClient.getQueryData(roleQueryKey)).toBe("owner");

		restoreAgentProfileListCaches(queryClient, snapshot);

		expect(queryClient.getQueryData(profilesQueryKey)).toEqual(profiles);
		expect(queryClient.getQueryData(acmeDirectoryQueryKey)).toEqual(
			acmeDirectory
		);
		expect(queryClient.getQueryData(betaDirectoryQueryKey)).toEqual(
			betaDirectory
		);
	});

	it("invalidates only the current account Profile lists and Organization directories", async () => {
		const queryClient = new QueryClient();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-1");
		const otherAccountProfilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-2");
		const directoryQueryKey = organizationQueryKeys.directory("org-acme");
		const roleQueryKey = organizationQueryKeys.role("org-acme", "account-1");
		queryClient.setQueryData(profilesQueryKey, [
			createProfile(REMOVED_PROFILE_ID),
		]);
		queryClient.setQueryData(otherAccountProfilesQueryKey, [
			createProfile(REMOVED_PROFILE_ID),
		]);
		queryClient.setQueryData(
			directoryQueryKey,
			createDirectory("org-acme", [REMOVED_PROFILE_ID])
		);
		queryClient.setQueryData(roleQueryKey, "owner");

		await invalidateAgentProfileListCaches({
			queryClient,
			storageScope: "account-1",
		});

		expect(queryClient.getQueryState(profilesQueryKey)?.isInvalidated).toBe(
			true
		);
		expect(queryClient.getQueryState(directoryQueryKey)?.isInvalidated).toBe(
			true
		);
		expect(
			queryClient.getQueryState(otherAccountProfilesQueryKey)?.isInvalidated
		).toBe(false);
		expect(queryClient.getQueryState(roleQueryKey)?.isInvalidated).toBe(false);
	});
});

function createProfile(profileId: string): AuthProfileView {
	return {
		openMeldProfileId: profileId,
	} as AuthProfileView;
}

function createDirectory(
	organizationId: string,
	profileIds: readonly string[]
): OrganizationDirectoryResponse {
	return {
		agentProfiles: profileIds.map((profileId) => ({ profileId })),
		generatedAt: "2026-08-18T00:00:00.000Z",
		members: [],
		organizationId,
	} as unknown as OrganizationDirectoryResponse;
}
