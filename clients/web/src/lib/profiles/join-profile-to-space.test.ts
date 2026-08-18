import type { AuthProfileView } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { joinProfileToSpace } from "./join-profile-to-space";

vi.mock("#/lib/onboarding/record-profile-space-history", () => ({
	recordProfileSpaceHistory: vi.fn(() => Promise.resolve()),
}));

describe("joinProfileToSpace", () => {
	const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("binds the route Organization when adding the created profile", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				Response.json({
					addedMemberIds: [agentProfileId],
					alreadyMemberIds: [],
					items: [],
				})
			)
		);
		vi.stubGlobal("fetch", fetchMock);

		const input = {
			actingHumanProfile: humanProfileFixture(),
			memberProfileIds: [agentProfileId],
			organizationId: "organization-route",
			queryClient: new QueryClient(),
			spaceId: "space-1",
			spaceName: "Design",
		} satisfies Parameters<typeof joinProfileToSpace>[0];
		await joinProfileToSpace(input);

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-id")
		).toBe("organization-route");
	});
});

function humanProfileFixture(): AuthProfileView {
	return {
		createdAt: "2026-08-18T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: null,
		managedRole: null,
		openMeldProfileId: "22222222-2222-4222-8222-222222222222",
		ownerUserId: "user-1",
		profileHandle: "felix",
		profileKind: "human",
		profileName: "Felix",
		source: "manual",
		status: "active",
		updatedAt: "2026-08-18T00:00:00.000Z",
	};
}
