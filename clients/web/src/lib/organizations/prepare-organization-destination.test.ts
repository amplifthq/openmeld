import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openCurrentCenterAgentDirectMessageSpace } from "#/lib/organizations/center-agent";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { prepareOrganizationDestination } from "./prepare-organization-destination";

vi.mock("#/lib/organizations/center-agent", () => ({
	openCurrentCenterAgentDirectMessageSpace: vi.fn(),
}));

describe("prepareOrganizationDestination", () => {
	beforeEach(() => {
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockReset();
	});

	it("initializes the Center Agent and invalidates cached identity before entering the Organization", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			centerAgentQueryKeys.designation("organization-123"),
			{ designation: null }
		);
		queryClient.setQueryData(
			organizationQueryKeys.directory("organization-123"),
			{ agentProfiles: [] }
		);
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockResolvedValue({
			centerAgentProfileId: "center-agent-123",
			created: true,
			memberProfileId: "member-123",
			organizationId: "organization-123",
			spaceId: "space-123",
		});

		await prepareOrganizationDestination({
			organizationId: "organization-123",
			queryClient,
		});

		expect(openCurrentCenterAgentDirectMessageSpace).toHaveBeenCalledWith({
			organizationId: "organization-123",
			signal: expect.any(AbortSignal),
		});
		expect(
			queryClient.getQueryState(
				centerAgentQueryKeys.designation("organization-123")
			)?.isInvalidated
		).toBe(true);
		expect(
			queryClient.getQueryState(
				organizationQueryKeys.directory("organization-123")
			)?.isInvalidated
		).toBe(true);
	});
});
