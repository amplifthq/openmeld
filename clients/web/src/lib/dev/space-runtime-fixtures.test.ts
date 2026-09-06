import type { createSpaceApi } from "@openmeld/api-client";
import { getActiveSpaceWakeProgressResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { withLocalSpaceRuntimeFixtures } from "./space-runtime-fixtures";

vi.mock("./fixture-manifest", () => ({
	isLocalFixtureHost: () => true,
	currentFixtureManifest: () => ({
		profileId: "viewer",
		spaces: [
			{
				spaceId: "space",
				profileId: "agent",
				profileName: "Reviewer",
				sourceSignalId: "00000000-0000-4000-8000-000000000001",
				scenario: "permission",
			},
		],
	}),
}));

function setup() {
	const read = vi.fn().mockResolvedValue(
		getActiveSpaceWakeProgressResponseSchema.parse({
			query: { spaceId: "space", targetProfileId: null },
			items: [],
		})
	);
	const respond = vi.fn();
	const api = {
		getActiveWakeProgress: read,
		respondToAgentInteraction: respond,
	} as unknown as ReturnType<typeof createSpaceApi>;
	return {
		read,
		respond,
		api,
		local: withLocalSpaceRuntimeFixtures(api, "viewer"),
	};
}

describe("local runtime API fixtures", () => {
	it("preserves real access failures and leaves other viewers untouched", async () => {
		const { read, api, local } = setup();
		read.mockRejectedValueOnce(new Error("Access denied"));
		await expect(
			local.getActiveWakeProgress({ spaceId: "space" })
		).rejects.toThrow("Access denied");
		const other = withLocalSpaceRuntimeFixtures(api, "another-viewer");
		expect(
			(await other.getActiveWakeProgress({ spaceId: "space" })).items
		).toEqual([]);
	});

	it("validates permission responses and resolves the same request without sending a command", async () => {
		const { local, respond } = setup();
		const item = (await local.getActiveWakeProgress({ spaceId: "space" }))
			.items[0];
		if (!(item?.pendingInteraction && item.runtimeCoordinatorExecutionId)) {
			throw new Error("Expected an actionable seeded permission request");
		}
		const body = {
			interactionId: item.pendingInteraction.interactionId,
			runtimeCoordinatorExecutionId: item.runtimeCoordinatorExecutionId,
			response: { kind: "permission" as const, optionId: "unknown" },
		};
		expect(
			await local.respondToAgentInteraction({ spaceId: "space", body })
		).toMatchObject({ ok: false, status: "response_invalid" });
		body.response.optionId = "deny";
		expect(
			await local.respondToAgentInteraction({ spaceId: "space", body })
		).toMatchObject({ ok: true, status: "accepted" });
		const resolved = (await local.getActiveWakeProgress({ spaceId: "space" }))
			.items[0];
		expect(resolved?.pendingInteraction).toBeUndefined();
		expect(resolved?.phase).toBe("stopped");
		expect(respond).not.toHaveBeenCalled();
	});
});
