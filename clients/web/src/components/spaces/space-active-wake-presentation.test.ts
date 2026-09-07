import { createWakeProgressItem } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
	buildSpaceActiveWakeSummary,
	resolveSpaceActiveWakePresentation,
} from "./space-active-wake-presentation";

describe("Space working identity", () => {
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
				? "Agent is working"
				: "Amplift Center Agent is working"
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
