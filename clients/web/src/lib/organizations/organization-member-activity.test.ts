import { afterEach, describe, expect, it, vi } from "vitest";
import { recordCurrentOrganizationWebActivity } from "./organization-member-activity";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("recordCurrentOrganizationWebActivity", () => {
	it("records the signed-in member's explicit Web activity", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				lastActiveAt: "2026-08-28T03:00:00.000Z",
				organizationId: "org-1",
				userId: "user-1",
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		await recordCurrentOrganizationWebActivity({ organizationId: "org-1" });

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/v1/organizations/current/member-activity/web"),
			expect.objectContaining({ credentials: "include", method: "POST" })
		);
	});
});
