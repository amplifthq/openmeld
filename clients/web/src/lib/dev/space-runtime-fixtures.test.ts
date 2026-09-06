import type { createSpaceApi } from "@openmeld/api-client";
import { getActiveSpaceWakeProgressResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
	withLocalAccountRuntimeFixtures,
	withLocalSpaceRuntimeFixtures,
} from "./space-runtime-fixtures";

vi.mock("./fixture-manifest", () => ({
	isLocalFixtureHost: () => true,
	currentFixtureManifest: () => ({
		profileId: "viewer",
		spaces: [
			{
				spaceId: "working-space",
				profileId: "worker",
				profileName: "Worker",
				sourceSignalId: "00000000-0000-4000-8000-000000000002",
				scenario: "working",
			},
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
	it("discovers active and pending Spaces before a visit, using the same detail snapshots", async () => {
		const { local } = setup();
		const result = await withLocalAccountRuntimeFixtures(
			{ generatedAtMs: Date.now(), items: [] },
			"viewer",
			(spaceId) => local.getActiveWakeProgress({ spaceId })
		);
		expect(result.summary.items.map((item) => item.spaceId)).toEqual([
			"working-space",
			"space",
		]);
		const pending = result.progress.find((item) => item.spaceId === "space")
			?.data.items[0];
		expect(pending?.pendingInteraction?.canRespond).toBe(true);
		expect(
			(await local.getActiveWakeProgress({ spaceId: "space" })).items[0]
		).toMatchObject({
			runtimeCoordinatorExecutionId: pending?.runtimeCoordinatorExecutionId,
		});
	});

	it("keeps working evidence fresh without restarting elapsed time after a long visit", async () => {
		const { local } = setup();
		const first = (
			await local.getActiveWakeProgress({ spaceId: "working-space" })
		).items[0];
		const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
		try {
			const next = (
				await local.getActiveWakeProgress({ spaceId: "working-space" })
			).items[0];
			expect(next?.startedAtMs).toBe(first?.startedAtMs);
			expect(next?.updatedAtMs).toBe(Date.now());
			expect(next?.phase).toBe("running");
		} finally {
			now.mockRestore();
		}
	});
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
		const untouched = await withLocalAccountRuntimeFixtures(
			{ generatedAtMs: 1, items: [] },
			"another-viewer",
			read
		);
		expect(untouched.progress).toEqual([]);
		read.mockRejectedValueOnce(new Error("Access denied"));
		await expect(
			withLocalAccountRuntimeFixtures(
				{ generatedAtMs: 1, items: [] },
				"viewer",
				read
			)
		).rejects.toThrow("Access denied");
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
		const account = await withLocalAccountRuntimeFixtures(
			{ generatedAtMs: Date.now(), items: [] },
			"viewer",
			(spaceId) => local.getActiveWakeProgress({ spaceId })
		);
		expect(
			account.summary.items.some((entry) => entry.spaceId === "space")
		).toBe(false);
	});
});
