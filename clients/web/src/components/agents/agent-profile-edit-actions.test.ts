import type { ListMemberAgentsResponse } from "@openmeld/schemas";
import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import { MIGRATED_LISTING } from "#/test-support/member-agent-fixtures";
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
		const profileDirectoryQueryKey =
			organizationQueryKeys.profileDirectory("org-acme");
		const otherDirectoryQueryKey = organizationQueryKeys.directory("org-other");
		const roleQueryKey = organizationQueryKeys.role("org-acme", "account-1");
		queryClient.setQueryData(profilesQueryKey, [
			createProfile("agt-edit", "Before"),
		]);
		queryClient.setQueryData(
			directoryQueryKey,
			createDirectory("org-acme", "agt-edit", "Before")
		);
		queryClient.setQueryData(
			profileDirectoryQueryKey,
			createProfileDirectory("org-acme", "agt-edit", "Before")
		);
		queryClient.setQueryData(
			otherDirectoryQueryKey,
			createDirectory("org-other", "agt-edit", "Other Organization Name")
		);
		queryClient.setQueryData(roleQueryKey, "owner");
		const memberAgentKey = memberAgentQueryKeys.all("org-acme");
		queryClient.setQueryData(memberAgentKey, {
			...MIGRATED_LISTING,
			memberAgents: MIGRATED_LISTING.memberAgents.map((agent) => ({
				...agent,
				profiles: agent.profiles.map((profile) =>
					profile.openMeldProfileId === "agt-codex"
						? {
								...profile,
								openMeldProfileId: "agt-edit",
								profileName: "Before",
							}
						: profile
				),
			})),
		});

		expect(() =>
			updateAgentProfileListCaches({
				organizationId: "org-acme",
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
			queryClient.getQueryData<OrganizationDirectoryResponse>(
				otherDirectoryQueryKey
			)?.agentProfiles[0]?.profileName
		).toBe("Other Organization Name");
		expect(
			queryClient.getQueryData<OrganizationDirectoryResponse>(directoryQueryKey)
				?.agentProfiles[0]?.profileName
		).toBe("After");
		expect(
			queryClient.getQueryData<OrganizationProfileDirectoryResponse>(
				profileDirectoryQueryKey
			)?.agentProfiles[0]?.profileName
		).toBe("After");
		expect(queryClient.getQueryData(roleQueryKey)).toBe("owner");
		expect(
			queryClient.getQueryData<ListMemberAgentsResponse>(memberAgentKey)
				?.memberAgents[1]?.profiles[0]?.profileName
		).toBe("After");
		expect(
			queryClient.getQueryData<ListMemberAgentsResponse>(memberAgentKey)
				?.memberAgents[0]?.profiles[0]?.profileName
		).toBe("Claude Code");
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

	it("does not cancel another Organization's directory load during a rename", async () => {
		const queryClient = new QueryClient();
		const otherDirectoryQueryKey = organizationQueryKeys.directory("org-other");
		let finishOtherDirectoryRead:
			| ((directory: OrganizationDirectoryResponse) => void)
			| undefined;
		const otherDirectoryRead = queryClient
			.fetchQuery({
				queryFn: async ({ signal }) =>
					await new Promise<OrganizationDirectoryResponse>(
						(resolve, reject) => {
							finishOtherDirectoryRead = resolve;
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
						}
					),
				queryKey: otherDirectoryQueryKey,
			})
			.then(
				(directory) => ({ directory, status: "resolved" as const }),
				(error: unknown) => ({ error, status: "rejected" as const })
			);
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
		finishOtherDirectoryRead?.(
			createDirectory("org-other", "agt-other", "Other Agent")
		);

		expect(await otherDirectoryRead).toMatchObject({
			directory: expect.objectContaining({ organizationId: "org-other" }),
			status: "resolved",
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

function createProfileDirectory(
	organizationId: string,
	profileId: string,
	profileName: string
): OrganizationProfileDirectoryResponse {
	return {
		agentProfiles: [{ profileId, profileName }],
		generatedAt: "2026-08-30T00:00:00.000Z",
		members: [],
		organizationId,
	} as unknown as OrganizationProfileDirectoryResponse;
}
