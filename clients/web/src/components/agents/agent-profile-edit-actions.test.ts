import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import { updateAgentProfileListCaches } from "./agent-profile-edit-actions";

describe("Agent Profile edit list caches", () => {
	it("updates directory projections without treating other Organization queries as directories", () => {
		const queryClient = new QueryClient();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-1");
		const directoryQueryKey = organizationQueryKeys.directory("org-acme");
		const roleQueryKey = organizationQueryKeys.role("org-acme", "account-1");
		queryClient.setQueryData(profilesQueryKey, [
			createProfile("agt-edit", "Before"),
		]);
		queryClient.setQueryData(
			directoryQueryKey,
			createDirectory("org-acme", "agt-edit", "Before")
		);
		queryClient.setQueryData(roleQueryKey, "owner");

		expect(() =>
			updateAgentProfileListCaches({
				profile: createProfile("agt-edit", "After"),
				queryClient,
				storageScope: "account-1",
			})
		).not.toThrow();

		expect(
			queryClient.getQueryData<readonly AuthProfileView[]>(
				profilesQueryKey
			)?.[0]?.profileName
		).toBe("After");
		expect(
			queryClient.getQueryData<OrganizationDirectoryResponse>(directoryQueryKey)
				?.agentProfiles[0]?.profileName
		).toBe("After");
		expect(queryClient.getQueryData(roleQueryKey)).toBe("owner");
	});
});

function createProfile(
	profileId: string,
	profileName: string
): AuthProfileView {
	return {
		openMeldProfileId: profileId,
		profileHandle: profileName.toLowerCase(),
		profileName,
		updatedAt: "2026-08-30T00:00:00.000Z",
	} as AuthProfileView;
}

function createDirectory(
	organizationId: string,
	profileId: string,
	profileName: string
): OrganizationDirectoryResponse {
	return {
		agentProfiles: [{ profileId, profileName }],
		generatedAt: "2026-08-30T00:00:00.000Z",
		members: [],
		organizationId,
	} as unknown as OrganizationDirectoryResponse;
}
