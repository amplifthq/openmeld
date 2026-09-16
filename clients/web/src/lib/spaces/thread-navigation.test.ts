import type { ListSpaceThreadsResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveSpaceThreadTarget } from "./thread-navigation";

const navigationCatalog: ListSpaceThreadsResponse = {
	threads: [
		{
			threadId: "thr_11111111-1111-4111-8111-111111111111",
			spaceId: "space-1",
			rootSignalId: "root-1",
			createdByProfileId: "human-1",
			createdAt: "2026-09-15T00:00:00Z",
			updatedAt: "2026-09-15T00:00:00Z",
		},
	],
	previews: [
		{
			threadId: "thr_11111111-1111-4111-8111-111111111111",
			replyCount: 2,
			signals: [],
			placements: [
				{
					threadId: "thr_11111111-1111-4111-8111-111111111111",
					signalId: "root-1",
					placement: "root",
					createdAt: "2026-09-15T00:00:00Z",
				},
				{
					threadId: "thr_11111111-1111-4111-8111-111111111111",
					signalId: "older-reply",
					placement: "thread",
					createdAt: "2026-09-15T00:00:00Z",
				},
			],
		},
	],
};

describe("Space message destination", () => {
	it("locates a Thread reply even when its body is outside the preview", () => {
		expect(
			resolveSpaceThreadTarget(navigationCatalog, {
				focusSignalId: "older-reply",
			})?.rootSignalId
		).toBe("root-1");
	});
	it.each([
		"root-1",
		"main-message",
		"unavailable",
	])("keeps %s out of a Thread without an explicit Thread target", (focusSignalId) => {
		expect(
			resolveSpaceThreadTarget(navigationCatalog, { focusSignalId })
		).toBeUndefined();
	});
	it("gives an explicit Thread target precedence and never substitutes another Thread", () => {
		expect(
			resolveSpaceThreadTarget(navigationCatalog, {
				focusThreadRootSignalId: "root-1",
			})?.threadId
		).toBe(navigationCatalog.threads[0].threadId);
		expect(
			resolveSpaceThreadTarget(navigationCatalog, {
				focusThreadRootSignalId: "missing",
				focusSignalId: "older-reply",
			})
		).toBeUndefined();
	});
});
