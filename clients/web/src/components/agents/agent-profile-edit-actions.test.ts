import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	renameAgentProfile,
	updateAgentProfileListCaches,
} from "./agent-profile-edit-actions";

const renameOpenMeldProfileMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/profiles/rename-profile", () => ({
	renameOpenMeldProfile: renameOpenMeldProfileMock,
}));

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

	it("refreshes only Agent list and directory projections after a rename", async () => {
		const queryClient = new QueryClient();
		const cancelQueries = vi
			.spyOn(queryClient, "cancelQueries")
			.mockResolvedValue(undefined);
		const invalidateQueries = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue(undefined);
		const profile = createProfile("agt-edit", "Before");
		renameOpenMeldProfileMock.mockResolvedValueOnce(
			createProfile("agt-edit", "After")
		);

		await renameAgentProfile({
			context: {
				actorProfileId: "human-1",
				deviceId: null,
				executionTarget: null,
				organizationId: "org-acme",
				profile,
				queryClient,
				runtimeLane: null,
				storageScope: "account-1",
			},
			profileName: "After",
		});

		expect(cancelQueries).toHaveBeenCalledWith({
			queryKey: startQueryKeys.profilesForStorageScope("account-1"),
		});
		expect(cancelQueries).toHaveBeenCalledWith(
			expect.objectContaining({
				predicate: expect.any(Function),
				queryKey: organizationQueryKeys.all,
			})
		);
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: startQueryKeys.profilesForStorageScope("account-1"),
			refetchType: "none",
		});
		expect(invalidateQueries).toHaveBeenCalledWith(
			expect.objectContaining({
				predicate: expect.any(Function),
				queryKey: organizationQueryKeys.all,
				refetchType: "none",
			})
		);
		expect(invalidateQueries).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
	});

	it("keeps the saved name when an older profile read finishes late", async () => {
		const queryClient = new QueryClient();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("account-1");
		const profile = createProfile("agt-edit", "Before");
		queryClient.setQueryData(profilesQueryKey, [profile]);
		let finishStaleRead:
			| ((profiles: readonly AuthProfileView[]) => void)
			| undefined;
		const staleRead = queryClient
			.fetchQuery({
				queryFn: async () =>
					await new Promise<readonly AuthProfileView[]>((resolve) => {
						finishStaleRead = resolve;
					}),
				queryKey: profilesQueryKey,
			})
			.catch(() => undefined);
		renameOpenMeldProfileMock.mockResolvedValueOnce(
			createProfile("agt-edit", "After")
		);

		await renameAgentProfile({
			context: {
				actorProfileId: "human-1",
				deviceId: null,
				executionTarget: null,
				organizationId: "org-acme",
				profile,
				queryClient,
				runtimeLane: null,
				storageScope: "account-1",
			},
			profileName: "After",
		});
		finishStaleRead?.([profile]);
		await staleRead;

		expect(
			queryClient.getQueryData<readonly AuthProfileView[]>(
				profilesQueryKey
			)?.[0]?.profileName
		).toBe("After");
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
