import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { WebMemberActivityReporter } from "./web-member-activity-reporter";

const recordWebActivityMock = vi.hoisted(() => vi.fn());

vi.mock("#/lib/organizations/organization-member-activity", () => ({
	recordCurrentOrganizationWebActivity: recordWebActivityMock,
}));

afterEach(() => {
	cleanup();
	recordWebActivityMock.mockReset();
	vi.restoreAllMocks();
});

describe("WebMemberActivityReporter", () => {
	it("records entry into the Web app and updates an existing People directory", async () => {
		const queryClient = new QueryClient();
		const directory = {
			agentProfiles: [],
			generatedAt: "2026-08-28T00:00:00.000Z",
			members: [
				{
					humanProfile: null,
					joinedAt: "2026-08-01T00:00:00.000Z",
					lastActiveAt: "2026-08-28T00:00:00.000Z",
					memberId: "member-1",
					organizationId: "org-1",
					role: "owner",
					user: {
						email: "felix@example.com",
						id: "user-1",
						image: null,
						name: "Felix",
					},
					userId: "user-1",
				},
			],
			organizationId: "org-1",
		};
		queryClient.setQueryData(
			organizationQueryKeys.directory("org-1"),
			directory
		);
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-1"),
			directory
		);
		recordWebActivityMock.mockResolvedValue({
			lastActiveAt: "2026-08-28T03:00:00.000Z",
			organizationId: "org-1",
			userId: "user-1",
		});

		renderWithQueryClient(
			<WebMemberActivityReporter
				currentUserId="user-1"
				organizationId="org-1"
			/>,
			queryClient
		);

		await waitFor(() => {
			expect(recordWebActivityMock).toHaveBeenCalledWith({
				organizationId: "org-1",
			});
		});
		expect(
			queryClient.getQueryData<{
				members: Array<{ lastActiveAt?: string }>;
			}>(organizationQueryKeys.directory("org-1"))?.members[0]?.lastActiveAt
		).toBe("2026-08-28T03:00:00.000Z");
		expect(
			queryClient.getQueryData<{
				members: Array<{ lastActiveAt?: string }>;
			}>(organizationQueryKeys.profileDirectory("org-1"))?.members[0]
				?.lastActiveAt
		).toBe("2026-08-28T03:00:00.000Z");
	});
});

function renderWithQueryClient(children: ReactNode, queryClient: QueryClient) {
	return render(
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
