import { afterEach, describe, expect, it, vi } from "vitest";
import { readCurrentOrganizationDirectory } from "./organization-directory";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("readCurrentOrganizationDirectory", () => {
	it("requests Human Profile activity while remaining compatible with older gateways", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				agentProfiles: [],
				generatedAt: "2026-08-01T00:00:00.000Z",
				members: [],
				organizationId: "org-1",
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		await readCurrentOrganizationDirectory({ organizationId: "org-1" });

		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"/v1/organizations/current/directory?includeHumanProfileLastUsedAt=true"
			),
			expect.objectContaining({ credentials: "include" })
		);
	});
});
