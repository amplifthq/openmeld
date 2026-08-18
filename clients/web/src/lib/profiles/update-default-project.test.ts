import { afterEach, describe, expect, it, vi } from "vitest";
import { updateAgentProfileDefaultProject } from "./update-default-project";

const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("updateAgentProfileDefaultProject", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("binds the route Organization to the Default Project request", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				Response.json({
					ok: true,
					profile: profileFixture({ defaultProjectId: "project-1" }),
				})
			)
		);
		vi.stubGlobal("fetch", fetchMock);

		await updateAgentProfileDefaultProject({
			actorProfileId: "human-1",
			defaultProjectId: "project-1",
			organizationId: "organization-route",
			profileId: PROFILE_ID,
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-id")
		).toBe("organization-route");
	});
});

function profileFixture(input: { defaultProjectId: string | null }) {
	return {
		createdAt: "2026-08-18T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: "human-1",
		defaultProjectId: input.defaultProjectId,
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		openMeldProfileId: PROFILE_ID,
		ownerUserId: "user-1",
		profileHandle: "research-agent",
		profileKind: "agent",
		profileName: "Research Agent",
		source: "manual",
		status: "active",
		updatedAt: "2026-08-18T00:00:00.000Z",
	};
}
