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
	it.each([
		{
			reason: "access_check_unavailable" as const,
			label: "Waiting to verify access for Runner",
			cause: "Space access",
		},
		{
			reason: "service_draining" as const,
			label: "Waiting for Runner to accept new work",
			cause: "finishing existing work",
		},
	])("preserves the $reason explanation", ({ reason, label, cause }) => {
		const status = resolveWakeProgressStatus({
			phase: "request_sent",
			targetLabel: "Runner",
			deviceWait: { deadlineAtMs: deviceWait.deadlineAtMs, reason },
		});
		expect(status?.label).toBe(label);
		expect(status?.description).toContain(cause);
	});
	it("preserves an explicitly selected Wake and its waiting deadline", () => {
		const original = {
			restoredFromSignalId: "recalled-source",
			text: "@Runner check the report",
			messageEnvelope: normalizeMessageEnvelope({
				text: "@Runner check the report",
				activationTargets: [targetProfileId],
				referenceTargets: [],
				mentionTargets: [],
			}),
		};
		const result = applyDeviceWaitToSubmission(original, deviceWait);
		expect(result.restoredFromSignalId).toBe("recalled-source");
		expect(result.messageEnvelope?.activationTargets).toEqual([
			targetProfileId,
		]);
		expect(result.messageEnvelope?.referenceTargets).toEqual([]);
		expect(result.deviceWait).toEqual(deviceWait);
		expect(original.messageEnvelope.referenceTargets).toEqual([]);
		expect(
			applyDeviceWaitToSubmission(result, deviceWait).messageEnvelope
				?.activationTargets
		).toEqual([targetProfileId]);
	});
	it("rejects waiting for an explicitly authored Reference instead of upgrading it", () => {
		const submission = {
			text: "@Runner context",
			messageEnvelope: normalizeMessageEnvelope({
				text: "@Runner context",
				activationTargets: [],
				referenceTargets: [targetProfileId],
				mentionTargets: [],
			}),
		};
		expect(() => applyDeviceWaitToSubmission(submission, deviceWait)).toThrow(
			"Choose Wake"
		);
		expect(submission.messageEnvelope.activationTargets).toEqual([]);
	});

	it("formats queued device-wait deadlines for the user's locale", () => {
		const status = resolveWakeProgressStatus({
			phase: "queued",
			targetLabel: "Runner",
			deviceWait: {
				deadlineAtMs: deviceWait.deadlineAtMs,
				reason: "earlier_work",
			},
		});
		expect(status).toMatchObject({
			kind: "queued",
			label: "Runner is queued · Waiting for earlier tasks",
		});
		expect(status?.description).toContain(
			new Date(deviceWait.deadlineAtMs).toLocaleString()
		);
		expect(status?.description).not.toContain(
			new Date(deviceWait.deadlineAtMs).toISOString()
		);
		expect(status?.description).toContain("Earlier work must finish first.");
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
