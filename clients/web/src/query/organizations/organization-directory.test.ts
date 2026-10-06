import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildOrganizationDirectoryAddCandidates,
	filterAddMemberGroups,
} from "#/components/spaces/people-agent-picker-model";
import {
	readCurrentOrganizationAgentRuntimeOverview,
	readCurrentOrganizationDirectory,
	readCurrentOrganizationProfileDirectory,
} from "#/lib/organizations/organization-directory";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationDirectoryQueryFilters,
	organizationDirectoryQueryOptions,
	organizationMemberOpenMeldServiceStatusesQueryOptions,
	organizationMemberRoleQueryOptions,
	organizationProfileDirectoryQueryOptions,
	organizationQueryKeys,
	organizationSpaceProfileCandidatesQueryOptions,
} from "./organization-directory";

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationAgentRuntimeOverview: vi.fn(),
	readCurrentOrganizationDirectory: vi.fn(),
	readCurrentOrganizationProfileDirectory: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(readCurrentOrganizationAgentRuntimeOverview).mockReset();
	vi.mocked(readCurrentOrganizationDirectory).mockReset();
	vi.mocked(readCurrentOrganizationProfileDirectory).mockReset();
});

describe("organization profile projections", () => {
	it("keeps Center Agent settings separate from the full directory and updates both identity caches", async () => {
		const queryClient = new QueryClient();
		const fullDirectory = createDirectory({
			organizationId: "org-acme",
			role: "owner",
			userId: "user-123",
		});
		vi.mocked(readCurrentOrganizationDirectory).mockResolvedValueOnce({
			...fullDirectory,
			members: [],
		});
		const settings = organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: "org-acme",
			centerAgentOnly: true,
		});
		await queryClient.fetchQuery(settings);
		expect(
			queryClient.getQueryData(organizationQueryKeys.directory("org-acme"))
		).toBeUndefined();
		queryClient.setQueryData(
			organizationQueryKeys.directory("org-acme"),
			fullDirectory
		);
		queryClient.setQueryData(
			organizationQueryKeys.profileIdentityDirectory("org-acme"),
			fullDirectory
		);
		expect(
			queryClient.getQueriesData(
				organizationDirectoryQueryFilters({ organizationId: "org-acme" })
			)
		).toHaveLength(3);
		expect(readCurrentOrganizationDirectory).toHaveBeenCalledWith({
			organizationId: "org-acme",
			centerAgentOnly: true,
			signal: expect.any(AbortSignal),
		});
		expect(
			queryClient.getQueryData(organizationQueryKeys.directory("org-acme"))
		).toEqual(fullDirectory);
		queryClient.clear();
	});
	it("keeps stable identity and changing runtime state in separate caches", () => {
		const profileDirectory = organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: "org-acme",
		});
		const runtimeOverview = organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId: "org-acme",
		});

		expect(profileDirectory.queryKey).toEqual([
			"organizations",
			"org-acme",
			"profile-directory",
		]);
		expect(runtimeOverview.queryKey).toEqual([
			"organizations",
			"org-acme",
			"agent-runtime-overview",
		]);
		expect(profileDirectory.refetchOnWindowFocus).toBe(true);
		expect(profileDirectory.refetchInterval).toBe(5 * 60_000);
		expect(profileDirectory.refetchIntervalInBackground).toBe(false);
		expect(runtimeOverview.refetchOnWindowFocus).toBe(true);
		expect(runtimeOverview.staleTime).toBe(10_000);
	});

	it("finds a newly created Remote Agent from the same identity directory as Team", async () => {
		const profile = {
			agentControllerRef: "hosted:remote-agent",
			avatarUrl: undefined,
			createdAt: "2026-09-23T08:00:00.000Z",
			createdByUserId: "user-123",
			creatorProfileId: null,
			isCenterAgent: false,
			isDefault: false as const,
			lastUsedAt: null,
			managedRole: null,
			organizationId: "org-acme",
			ownerName: "Felix Lu",
			ownerUserId: "user-123",
			profileHandle: "felix-remote-gpt-6-sol",
			profileId: "agt_33333333-3333-4333-8333-333333333333",
			profileKind: "agent" as const,
			profileName: "Felix Lu’s Remote GPT 6 Sol",
			source: "user",
			status: "active" as const,
			updatedAt: "2026-09-23T08:00:00.000Z",
		};
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue({
			...createDirectory({
				organizationId: "org-acme",
				role: "owner",
				userId: "user-123",
			}),
			agentProfiles: [profile],
		});
		const queryClient = new QueryClient();
		const options = organizationSpaceProfileCandidatesQueryOptions({
			enabled: true,
			organizationId: "org-acme",
		});
		const directory = await queryClient.fetchQuery(options);
		const candidates = options.select?.(directory);
		const matches = filterAddMemberGroups(
			buildOrganizationDirectoryAddCandidates({
				directory: candidates ?? null,
				organizationName: "Acme",
				snapshot: null,
			}),
			"remote"
		);

		expect(options.queryKey).toEqual(
			organizationProfileDirectoryQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).queryKey
		);
		expect(candidates?.agentProfiles).toEqual([
			expect.objectContaining({
				profileId: profile.profileId,
				profileName: profile.profileName,
			}),
		]);
		expect(matches.personGroups[0]?.agentCandidates[0]?.profileId).toBe(
			profile.profileId
		);
		expect(readCurrentOrganizationDirectory).not.toHaveBeenCalled();
		queryClient.clear();
	});
});

describe("organizationMemberOpenMeldServiceStatusesQueryOptions", () => {
	it("refreshes current member service status while Directory is visible", () => {
		const options = organizationMemberOpenMeldServiceStatusesQueryOptions({
			enabled: true,
			organizationId: "org-acme",
		});

		expect(options.queryKey).toEqual([
			"organizations",
			"org-acme",
			"member-openmeld-service-statuses",
		]);
		expect(options.refetchInterval).toBe(30_000);
		expect(options.refetchIntervalInBackground).toBe(false);
		expect(options.refetchOnWindowFocus).toBe(true);
	});
});

describe("organizationMemberRoleQueryOptions", () => {
	it("derives the current account role without reading Agent runtime state", async () => {
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue(
			createDirectory({
				organizationId: "org-beta",
				role: "admin",
				userId: "user-123",
			})
		);
		const queryClient = new QueryClient();

		const role = await queryClient.fetchQuery(
			organizationMemberRoleQueryOptions({
				enabled: true,
				organizationId: "org-beta",
				userId: "user-123",
			})
		);

		expect(role).toBe("admin");
		expect(readCurrentOrganizationProfileDirectory).toHaveBeenCalledWith({
			organizationId: "org-beta",
			signal: expect.any(AbortSignal),
		});
		expect(readCurrentOrganizationDirectory).not.toHaveBeenCalled();
		expect(readCurrentOrganizationAgentRuntimeOverview).not.toHaveBeenCalled();
		expect(
			organizationMemberRoleQueryOptions({
				enabled: true,
				organizationId: "org-beta",
				userId: "user-123",
			}).queryKey
		).toEqual(["organizations", "org-beta", "role", "user-123"]);
	});

	it("fails closed when the directory resolves for another organization", async () => {
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue(
			createDirectory({
				organizationId: "org-acme",
				role: "owner",
				userId: "user-123",
			})
		);

		await expect(
			new QueryClient({
				defaultOptions: { queries: { retry: false } },
			}).fetchQuery({
				...organizationMemberRoleQueryOptions({
					enabled: true,
					organizationId: "org-beta",
					userId: "user-123",
				}),
				retry: false,
			})
		).rejects.toThrow(
			"Organization directory resolved for a different organization."
		);
	});

	it("fails closed when the current account is missing from the profile directory", async () => {
		vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue(
			createDirectory({
				organizationId: "org-beta",
				role: "owner",
				userId: "another-user",
			})
		);

		await expect(
			new QueryClient().fetchQuery({
				...organizationMemberRoleQueryOptions({
					enabled: true,
					organizationId: "org-beta",
					userId: "user-123",
				}),
				retry: false,
			})
		).rejects.toThrow(
			"The current account is missing from the organization directory."
		);
	});
});

function createDirectory(input: {
	organizationId: string;
	role: string;
	userId: string;
}) {
	return {
		agentProfiles: [],
		generatedAt: "2026-07-24T00:00:00.000Z",
		members: [
			{
				humanProfile: null,
				joinedAt: "2026-07-24T00:00:00.000Z",
				memberId: "member-123",
				organizationId: input.organizationId,
				role: input.role,
				user: {
					email: "felix@example.com",
					id: input.userId,
					image: null,
					name: "Felix",
				},
				userId: input.userId,
			},
		],
		organizationId: input.organizationId,
	};
}
