import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	hasCurrentLocalRuntimeSettingsAttention,
	resolveCurrentLocalRuntimeServiceConnectionStatus,
	resolveCurrentLocalRuntimeSettingsAttention,
	resolveCurrentLocalRuntimeSettingsAttentionDeviceId,
	resolveCurrentLocalRuntimeSettingsAttentionToneForInventory,
} from "./settings-attention";

function buildReadiness(
	overrides: Partial<CurrentLocalRuntimeReplyReadinessResponse> = {}
): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: true,
		currentTarget: {
			availability: "resolved",
			deviceId: "device-1",
			runtimeLane: "dev-local",
		},
		generatedAt: "2026-07-06T00:00:00.000Z",
		localComponents: {
			cli: { status: "current", wakeBlocked: false },
			service: { status: "current", wakeBlocked: false },
			skills: { status: "current", wakeBlocked: false },
		},
		message: "This computer is ready.",
		nextAction: "none",
		primaryBlocker: "none",
		runtime: {
			deviceDisplayName: "Felix's MacBook Pro",
			deviceId: "device-1",
			executionTargetStatus: "ready",
			lastObservedAtMs: 1_700_000_000_000,
			reasonCodes: [],
			runtimeLane: "dev-local",
			openMeldServiceRuntimeId: null,
		},
		service: {
			connected: true,
			executionCompatibility: null,
			matchingCurrentRuntime: true,
			reasonCodes: [],
			sessionDeviceId: "device-1",
			sessionLane: "dev-local",
		},
		status: "ready",
		...overrides,
	} as CurrentLocalRuntimeReplyReadinessResponse;
}

describe("settings attention", () => {
	it("does not mark Settings when the current computer is ready", () => {
		expect(hasCurrentLocalRuntimeSettingsAttention(buildReadiness())).toBe(
			false
		);
		expect(
			resolveCurrentLocalRuntimeSettingsAttention(buildReadiness())
		).toBeNull();
	});

	it("marks Settings when OpenMeld tools updates are available", () => {
		const attention = resolveCurrentLocalRuntimeSettingsAttention(
			buildReadiness({
				localComponents: {
					cli: { status: "update_available", wakeBlocked: false },
					service: { status: "current", wakeBlocked: false },
					skills: { status: "current", wakeBlocked: false },
				},
			} as Partial<CurrentLocalRuntimeReplyReadinessResponse>)
		);

		expect(attention).toEqual({
			label: "Update available",
			reason: "openmeld_tools_update",
			tone: "warning",
		});
	});

	it("marks Settings as danger when OpenMeld tools updates are required", () => {
		const attention = resolveCurrentLocalRuntimeSettingsAttention(
			buildReadiness({
				localComponents: {
					cli: { status: "current", wakeBlocked: false },
					service: { status: "update_required", wakeBlocked: true },
					skills: { status: "current", wakeBlocked: false },
				},
			} as Partial<CurrentLocalRuntimeReplyReadinessResponse>)
		);

		expect(attention).toEqual({
			label: "Update required",
			reason: "openmeld_tools_update",
			tone: "danger",
		});
	});

	it("marks Settings as danger when an OpenMeld tools update blocks Wake", () => {
		const attention = resolveCurrentLocalRuntimeSettingsAttention(
			buildReadiness({
				localComponents: {
					cli: { status: "current", wakeBlocked: true },
					service: { status: "current", wakeBlocked: false },
					skills: { status: "current", wakeBlocked: false },
				},
			} as Partial<CurrentLocalRuntimeReplyReadinessResponse>)
		);

		expect(attention).toEqual({
			label: "Update required",
			reason: "openmeld_tools_update",
			tone: "danger",
		});
	});

	it("prioritizes OpenMeld Service disconnected over updates", () => {
		const readiness = buildReadiness({
			localComponents: {
				cli: { status: "update_available", wakeBlocked: false },
				service: { status: "current", wakeBlocked: false },
				skills: { status: "current", wakeBlocked: false },
			},
			nextAction: "reconnect_service",
			primaryBlocker: "service_not_connected",
			service: {
				connected: false,
				executionCompatibility: null,
				matchingCurrentRuntime: false,
				reasonCodes: ["daemon.session.missing"],
				sessionDeviceId: null,
				sessionLane: null,
			},
			status: "blocked",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(resolveCurrentLocalRuntimeSettingsAttention(readiness)).toEqual({
			label: "OpenMeld Service is not connected",
			reason: "service_not_connected",
			tone: "danger",
		});
		expect(resolveCurrentLocalRuntimeServiceConnectionStatus(readiness)).toBe(
			"not_connected"
		);
	});

	it("does not mark Settings as danger when no computers have been added", () => {
		const readiness = buildReadiness({
			nextAction: "reconnect_service",
			primaryBlocker: "service_not_connected",
			service: {
				connected: false,
				executionCompatibility: null,
				matchingCurrentRuntime: false,
				reasonCodes: ["daemon.session.missing"],
				sessionDeviceId: null,
				sessionLane: null,
			},
			status: "blocked",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(
			resolveCurrentLocalRuntimeSettingsAttentionToneForInventory({
				localRuntimeCount: 0,
				readiness,
			})
		).toBeNull();
	});

	it("keeps Settings attention when the local runtime inventory is not loaded yet", () => {
		expect(
			resolveCurrentLocalRuntimeSettingsAttentionToneForInventory({
				localRuntimeCount: undefined,
				readiness: buildReadiness({
					localComponents: {
						cli: { status: "update_available", wakeBlocked: false },
						service: { status: "current", wakeBlocked: false },
						skills: { status: "current", wakeBlocked: false },
					},
				} as Partial<CurrentLocalRuntimeReplyReadinessResponse>),
			})
		).toBe("warning");
	});

	it("marks setup attention as danger when Core blocks replies until setup runs", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			status: "blocked",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(resolveCurrentLocalRuntimeSettingsAttention(readiness)).toEqual({
			label: "Local agents need repair",
			reason: "agent_needs_setup",
			tone: "danger",
		});
		expect(resolveCurrentLocalRuntimeSettingsAttentionDeviceId(readiness)).toBe(
			"device-1"
		);
		expect(resolveCurrentLocalRuntimeServiceConnectionStatus(readiness)).toBe(
			"connected"
		);
	});

	it("keeps an incomplete controller check out of setup attention", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				deviceDisplayName: "Felix's MacBook Pro",
				deviceId: "device-1",
				executionTargetStatus: "not_ready",
				lastObservedAtMs: 1_700_000_000_000,
				reasonCodes: ["controller.interface.check_failed"],
				runtimeLane: "dev-local",
				openMeldServiceRuntimeId: null,
			},
			status: "blocked",
		});

		expect(resolveCurrentLocalRuntimeSettingsAttention(readiness)).toBeNull();
	});

	it("keeps real update attention while a controller check is incomplete", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			localComponents: {
				cli: { status: "update_available", wakeBlocked: false },
				service: { status: "current", wakeBlocked: false },
				skills: { status: "current", wakeBlocked: false },
			},
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				deviceDisplayName: "Felix's MacBook Pro",
				deviceId: "device-1",
				executionTargetStatus: "not_ready",
				lastObservedAtMs: 1_700_000_000_000,
				reasonCodes: ["controller.interface.check_failed"],
				runtimeLane: "dev-local",
				openMeldServiceRuntimeId: null,
			},
			status: "blocked",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(resolveCurrentLocalRuntimeSettingsAttention(readiness)).toEqual({
			label: "Update available",
			reason: "openmeld_tools_update",
			tone: "warning",
		});
	});
});
