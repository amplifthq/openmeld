import { createWakeProgressItem } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildSpaceMessageFocusHref } from "#/lib/spaces/thread-navigation";
import {
	buildSpaceActiveWakeSummary,
	resolveSpaceActiveWakePresentation,
	resolveSpaceActiveWakeTarget,
} from "./space-active-wake-presentation";

describe("Space working identity", () => {
	it("locates the same priority as the indicator and excludes completed work", () => {
		const running = createWakeProgressItem({
			clientMessageId: "running",
			sourceSignalId: "thread-reply",
			targetProfileId: "agent",
			targetLabel: "Agent",
			phase: "running",
			dispatchId: "run",
			updatedAtMs: 1,
		});
		const queued = {
			...running,
			phase: "queued" as const,
			sourceSignalId: "queued-message",
			startedAtMs: 0,
		};
		const connecting = {
			...running,
			phase: "connecting" as const,
			sourceSignalId: "connecting-message",
			startedAtMs: 0,
		};
		const finished = {
			...running,
			terminal: true,
			phase: "replied" as const,
			sourceSignalId: "finished",
		};
		const items = [queued, connecting, finished, running];
		expect(resolveSpaceActiveWakeTarget(items)?.sourceSignalId).toBe(
			"thread-reply"
		);
		expect(
			buildSpaceActiveWakeSummary({ items, spaceId: "space" }).focusSignalId
		).toBe("thread-reply");
		expect(resolveSpaceActiveWakeTarget([finished])).toBeUndefined();
		expect(
			buildSpaceMessageFocusHref(
				"/o/acme/chats/center-agent?session=space&view=files",
				"thread-reply"
			)
		).toBe(
			"/o/acme/chats/center-agent?session=space&focusSignalId=thread-reply"
		);
		expect(buildSpaceMessageFocusHref("/o/acme/spaces/space", null)).toBe(
			"/o/acme/spaces/space"
		);
	});
	it.each([
		"Amplift Center Agent",
		"agt_legacy_name",
	])("handles legacy target labels with summary name %s", (profileName) => {
		const profileId = "agt_legacy_name";
		const summary = buildSpaceActiveWakeSummary({
			spaceId: "space",
			fallbackSummary: {
				spaceId: "space",
				activeWakeCount: 1,
				activeTargets: [{ profileId, profileName, activeWakeCount: 1 }],
			},
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message",
					sourceSignalId: "source-signal",
					targetProfileId: profileId,
					targetLabel: profileId,
					phase: "running",
					dispatchId: "dispatch",
					updatedAtMs: 1,
				}),
			],
		});
		expect(resolveSpaceActiveWakePresentation(summary).label).toBe(
			profileName === profileId
				? "Agent · Working…"
				: "Amplift Center Agent · Working…"
		);
		expect(
			resolveSpaceActiveWakePresentation({
				activeWakeCount: 1,
				spaceId: "space",
				activeTargets: [
					{ profileId, profileName: profileId, activeWakeCount: 1 },
				],
			}).label
		).not.toContain(profileId);
	});
});
