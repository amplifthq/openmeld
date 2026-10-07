import type { ListSpaceThreadsResponse } from "@openmeld/schemas/types";
import { createWakeProgressItem } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildSpaceActiveWakeSummary } from "../../components/spaces/space-active-wake-presentation";
import { buildActiveWakeConversationItems } from "./active-wake-conversation";
import {
	buildSpaceActivityFocusHref,
	resolveSpaceThreadTarget,
} from "./thread-navigation";
import { resolveWakeStopTargetForProgressItem } from "./wake-stop-target";

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
		false,
		true,
	])("keeps a continuation discoverable before source history loads (stream: %s)", (hasStream) => {
		const progress = createWakeProgressItem({
			clientMessageId: null,
			dispatchId: "parent-continuation",
			targetProfileId: "agent",
			targetLabel: "Agent",
			phase: "running",
			updatedAtMs: 200,
			startedAtMs: 100,
			sourceSignalId: "parent-request",
			sourceContext: {
				threadId: null,
				messagePreview: "Summarize child task",
				profileId: "human",
				profileKind: "human",
				profileName: "Requester",
			},
		});
		const agentStreams = hasStream
			? [
					{
						profileId: "agent",
						dispatchId: "parent-continuation",
						triggerMessageId: "parent-request",
						replyThreadRootSignalId: null,
						createdAtMs: 100,
						updatedAtMs: 200,
						observedRevision: 1,
						sequence: 1,
						spaceId: "parent-space",
						streamId: "stream",
						status: "streaming" as const,
						reasonCode: null,
						text: "",
						textSequence: 0,
					},
				]
			: [];
		const summary = buildSpaceActiveWakeSummary({
			items: [progress],
			spaceId: "parent-space",
		});
		const rows = buildActiveWakeConversationItems({
			activityItems: [progress],
			profileEntriesById: new Map(),
			spaceId: "parent-space",
			threadId: null,
			agentStreams,
			timelineItems: [],
		});
		const href = buildSpaceActivityFocusHref({
			url: "/o/acme/chats/center-agent?session=parent-space",
			progress,
			threads: { threads: [], previews: [] },
			agentStreams,
		});
		expect(summary.activeWakeCount).toBe(1);
		expect(rows.filter((row) => row.activeWakeProgress)).toHaveLength(1);
		expect(
			new URL(href, "https://openmeld.invalid").searchParams.get(
				"focusSignalId"
			)
		).toBe("parent-request");
		expect(
			new URL(href, "https://openmeld.invalid").searchParams.get("session")
		).toBe("parent-space");
		expect(
			resolveWakeStopTargetForProgressItem({ item: progress }).selector
		).toEqual({
			by: "source_signal",
			sourceSignalId: "parent-request",
			targetProfileId: "agent",
		});
	});
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
