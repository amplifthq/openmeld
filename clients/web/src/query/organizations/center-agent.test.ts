import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openCurrentCenterAgentDirectMessageSpace } from "#/lib/organizations/center-agent";
import {
	centerAgentDirectMessageOpenQueryOptions,
	centerAgentDirectMessageSpaceProjectionQueryOptions,
} from "./center-agent";

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		openCurrentCenterAgentDirectMessageSpace: vi.fn(),
	};
});

describe("centerAgentDirectMessageOpenQueryOptions", () => {
	beforeEach(() => {
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockReset();
	});

	it("deduplicates concurrent opens within one organization", async () => {
		const queryClient = new QueryClient();
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockResolvedValue({
			centerAgentProfileId: "agent-center",
			created: false,
			memberProfileId: "human-1",
			organizationId: "org-acme",
			spaceId: "space-ca-dm",
		});
		const options = centerAgentDirectMessageOpenQueryOptions({
			organizationId: "org-acme",
		});

		const [first, second] = await Promise.all([
			queryClient.fetchQuery(options),
			queryClient.fetchQuery(options),
		]);

		expect(first).toEqual(second);
		expect(openCurrentCenterAgentDirectMessageSpace).toHaveBeenCalledTimes(1);
		expect(openCurrentCenterAgentDirectMessageSpace).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-acme",
			})
		);
	});

	it("keeps different organizations in separate cache boundaries", () => {
		expect(
			centerAgentDirectMessageOpenQueryOptions({ organizationId: "org-a" })
				.queryKey
		).not.toEqual(
			centerAgentDirectMessageOpenQueryOptions({ organizationId: "org-b" })
				.queryKey
		);
	});

	it("keeps stable Direct Message identity fresh for five minutes", () => {
		expect(
			centerAgentDirectMessageOpenQueryOptions({ organizationId: "org-acme" })
				.staleTime
		).toBe(300_000);
		expect(
			centerAgentDirectMessageSpaceProjectionQueryOptions({
				enabled: true,
				organizationId: "org-acme",
			}).staleTime
		).toBe(300_000);
	});

	it("rejects a mismatched organization before caching a DM open", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		vi.mocked(openCurrentCenterAgentDirectMessageSpace).mockResolvedValue({
			centerAgentProfileId: "agent-center",
			created: false,
			memberProfileId: "human-1",
			organizationId: "org-other",
			spaceId: "space-ca-dm",
		});
		const options = centerAgentDirectMessageOpenQueryOptions({
			organizationId: "org-acme",
		});

		await expect(queryClient.fetchQuery(options)).rejects.toMatchObject({
			code: "gateway.invalid_response",
			schemaIssuePath: "organizationId",
		});
		expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
	});
});
