import { afterEach, describe, expect, it, vi } from "vitest";
import { joinOrganizationSpace } from "./organization-spaces";

describe("joinOrganizationSpace", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("binds the route Organization when joining a Space", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				Response.json({
					addedMemberIds: ["11111111-1111-4111-8111-111111111111"],
					alreadyMemberIds: [],
					items: [],
				})
			)
		);
		vi.stubGlobal("fetch", fetchMock);

		await joinOrganizationSpace({
			organizationId: "organization-route",
			spaceId: "space-1",
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-id")
		).toBe("organization-route");
	});
});
