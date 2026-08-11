import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCurrentOrganizationDirectory } from "#/lib/organizations/organization-directory";
import {
	organizationMemberOpenMeldServiceStatusesQueryOptions,
	organizationMemberRoleQueryOptions,
} from "./organization-directory";

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationDirectory: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(readCurrentOrganizationDirectory).mockReset();
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
	it("derives the current account role from the URL organization's directory", async () => {
		vi.mocked(readCurrentOrganizationDirectory).mockResolvedValue(
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
		expect(readCurrentOrganizationDirectory).toHaveBeenCalledWith({
			organizationId: "org-beta",
		});
		expect(
			organizationMemberRoleQueryOptions({
				enabled: true,
				organizationId: "org-beta",
				userId: "user-123",
			}).queryKey
		).toEqual(["organizations", "org-beta", "role", "user-123"]);
	});

	it("fails closed when the directory resolves for another organization", async () => {
		vi.mocked(readCurrentOrganizationDirectory).mockResolvedValue(
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
