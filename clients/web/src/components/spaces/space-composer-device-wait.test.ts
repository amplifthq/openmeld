import { normalizeMessageEnvelope } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { resolveWakeProgressStatus } from "#/lib/spaces/wake-progress-status";
import { applyDeviceWaitToSubmission } from "./space-composer-device-wait";

const targetProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const deviceWait = {
	bindingId: "binding-1",
	openMeldServiceRuntimeId: "runtime-1",
	targetProfileId,
	deadlineAtMs: 1_900_000_000_000,
};

describe("Space device waiting authoring and progress", () => {
	it("turns the explicitly selected Reference into one Wake and preserves the deadline", () => {
		const original = {
			text: "@Runner check the report",
			messageEnvelope: normalizeMessageEnvelope({
				text: "@Runner check the report",
				activationTargets: [],
				referenceTargets: [targetProfileId],
				mentionTargets: [],
			}),
		};
		const result = applyDeviceWaitToSubmission(original, deviceWait);
		expect(result.messageEnvelope?.activationTargets).toEqual([
			targetProfileId,
		]);
		expect(result.messageEnvelope?.referenceTargets).toEqual([]);
		expect(result.deviceWait).toEqual(deviceWait);
		expect(original.messageEnvelope.referenceTargets).toEqual([
			targetProfileId,
		]);
		expect(
			applyDeviceWaitToSubmission(result, deviceWait).messageEnvelope
				?.activationTargets
		).toEqual([targetProfileId]);
	});

	it("presents waiting, its deadline and cause without showing running work", () => {
		const status = resolveWakeProgressStatus({
			phase: "request_sent",
			targetLabel: "Runner",
			deviceWait: {
				deadlineAtMs: deviceWait.deadlineAtMs,
				reason: "device_offline",
			},
		});
		expect(status).toMatchObject({
			kind: "waiting_for_device",
			status: "pending",
			label: "Waiting for Runner’s computer to come online",
		});
		expect(status?.description).toContain(
			new Date(deviceWait.deadlineAtMs).toLocaleString()
		);
		expect(status?.description).toContain("offline");
		expect(status?.description).toContain("No work has started");
		expect(
			resolveWakeProgressStatus({
				phase: "running",
				targetLabel: "Runner",
				deviceWait: {
					deadlineAtMs: deviceWait.deadlineAtMs,
					reason: "device_offline",
				},
			})?.kind
		).toBe("working");
	});
});
