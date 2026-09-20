import type { ListSpaceThreadsResponse } from "@openmeld/schemas/types";
import { createWakeProgressItem } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
	buildSpaceActivityFocusHref,
	resolveSpaceThreadTarget,
} from "./thread-navigation";

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
	it.each([
		"root-1",
		null,
		undefined,
	])("opens the work destination, respecting explicit main placement: %s", (placement) => {
		const progress = createWakeProgressItem({
			clientMessageId: "request",
			dispatchId: "run",
			targetProfileId: "agent",
			targetLabel: "Agent",
			phase: "running",
			updatedAtMs: 1,
			sourceSignalId: placement === "root-1" ? "root-1" : "older-reply",
			sourceContext: {
				threadId:
					placement === "root-1" ? null : navigationCatalog.threads[0].threadId,
				messagePreview: "Request",
				profileId: "human-1",
				profileKind: "human",
				profileName: "Jordan",
			},
		});
		const href = buildSpaceActivityFocusHref({
			url: "/o/acme/chats/center-agent?session=space&view=files",
			progress,
			threads: navigationCatalog,
			agentStreams: [
				{
					profileId: "agent",
					dispatchId: "run",
					triggerMessageId: progress.sourceSignalId ?? "",
					replyThreadRootSignalId: placement,
				},
			],
		});
		const params = new URL(href, "https://openmeld.invalid").searchParams;
		expect(params.get("session")).toBe("space");
		expect(
			resolveSpaceThreadTarget(navigationCatalog, {
				focusSignalId: params.get("focusSignalId") ?? undefined,
				focusThreadRootSignalId:
					params.get("focusThreadRootSignalId") ?? undefined,
			})?.rootSignalId
		).toBe(placement === null ? undefined : "root-1");
	});
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
