import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	resolveComputerAttentionTone,
	resolveCurrentLocalRuntimeComputerAttentionToneForInventory,
	resolveCurrentLocalRuntimeComputerSummaryStatus,
	resolveCurrentLocalRuntimeComputerSummaryStatusDeviceId,
	resolveOrganizationComputerSummaryStatus,
} from "./computer-summary-status";

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
		localComponents: buildLocalComponents(),
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

function buildLocalComponents(
	input: {
		cliStatus?: "current" | "update_available" | "update_required";
		serviceStatus?: "current" | "update_available" | "update_required";
		skillsStatus?: "current" | "update_available" | "update_required";
	} = {}
): CurrentLocalRuntimeReplyReadinessResponse["localComponents"] {
	const cliStatus = input.cliStatus ?? "current";
	const serviceStatus = input.serviceStatus ?? "current";
	const skillsStatus = input.skillsStatus ?? "current";
	return {
		agentSetupCommand: "openmeld setup --view agent",
		cli: {
			commandContractVersion: null,
			installedPackageVersion: null,
			latestPackageVersion: null,
			reasonCodes: [],
			requiredCommandContractVersion: null,
			status: cliStatus,
			updatePolicy: resolveUpdatePolicy(cliStatus),
			wakeBlocked: cliStatus === "update_required",
		},
		generatedAt: "2026-07-06T00:00:00.000Z",
		humanSetupCommand: "openmeld setup",
		schemaVersion: 1,
		service: {
			installedVersion: null,
			latestVersion: null,
			reasonCodes: [],
			requiredVersion: null,
			status: serviceStatus,
			updatePolicy: resolveUpdatePolicy(serviceStatus),
			wakeBlocked: serviceStatus === "update_required",
		},
		setupAction: "none",
		setupActionDescription: "OpenMeld local components are aligned.",
		setupActionLabel: "Everything is up to date",
		skills: {
			expectedBundleHash: null,
			expectedTargetCount: 0,
			installedBundleHash: null,
			reasonCodes: [],
			skillContractVersion: null,
			status: skillsStatus,
			targetCount: null,
			updatePolicy: resolveUpdatePolicy(skillsStatus),
			wakeBlocked: skillsStatus === "update_required",
		},
	};
}

function resolveUpdatePolicy(
	status: "current" | "update_available" | "update_required"
): "ok" | "available" | "required" {
	switch (status) {
		case "update_available":
			return "available";
		case "update_required":
			return "required";
		default:
			return "ok";
	}
}

describe("computer summary status", () => {
	it("returns one ready status for a healthy current computer", () => {
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			readiness: buildReadiness(),
		});

		expect(status).toEqual({
			label: "OpenMeld Tools are ready",
			reason: "ready",
			showLabel: false,
			tone: "ready",
		});
		expect(resolveComputerAttentionTone(status)).toBeNull();
	});

	it("returns the same warning status consumed by the card and sidebar", () => {
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			readiness: buildReadiness({
				localComponents: buildLocalComponents({
					cliStatus: "update_available",
				}),
			}),
		});

		expect(status).toMatchObject({
			label: "Update available",
			reason: "openmeld_tools_update",
			tone: "warning",
		});
		expect(resolveComputerAttentionTone(status)).toBe("warning");
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatusDeviceId({
				readiness: buildReadiness(),
			})
		).toBe("device-1");
	});

	it("returns danger when an update is required", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					localComponents: buildLocalComponents({
						serviceStatus: "update_required",
					}),
				}),
			})
		).toMatchObject({ label: "Update required", tone: "danger" });
	});

	it("prioritizes the disconnected service outcome over a cached update", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					localComponents: buildLocalComponents({
						cliStatus: "update_available",
					}),
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
				}),
			})
		).toMatchObject({
			label: "OpenMeld Service is not connected",
			reason: "service_not_connected",
			tone: "danger",
		});
	});

	it("returns danger for a real local-agent repair blocker", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					canReplyFromThisComputer: false,
					nextAction: "run_setup",
					primaryBlocker: "agent_controller_report_not_ready",
					status: "blocked",
				}),
			})
		).toMatchObject({ label: "Local agents need repair", tone: "danger" });
	});

	it("shows an incomplete controller check as unavailable without global attention", () => {
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			readiness: buildReadiness({
				canReplyFromThisComputer: false,
				nextAction: "run_setup",
				primaryBlocker: "agent_controller_report_not_ready",
				runtime: {
					...buildReadiness().runtime,
					executionTargetStatus: "not_ready",
					reasonCodes: ["controller.interface.check_failed"],
				},
				status: "blocked",
			}),
		});

		expect(status).toMatchObject({
			reason: "status_unavailable",
			tone: "muted",
		});
		expect(resolveComputerAttentionTone(status)).toBeNull();
	});

	it("does not escalate mixed ready and incomplete controller checks to global attention", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				executionTargetStatus: "partial",
				reasonCodes: [
					"runtime.agent_controller_report.ready",
					"controller.interface.check_failed",
				],
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({
			reason: "status_unavailable",
			tone: "muted",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBeNull();
	});

	it("keeps global repair attention when an incomplete check accompanies real repair evidence", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					canReplyFromThisComputer: false,
					nextAction: "run_setup",
					primaryBlocker: "agent_controller_report_not_ready",
					runtime: {
						...buildReadiness().runtime,
						executionTargetStatus: "partial",
						reasonCodes: [
							"runtime.agent_controller_report.ready",
							"controller.interface.check_failed",
							"controller.interface.error",
						],
					},
					status: "blocked",
				}),
			})
		).toMatchObject({
			reason: "agent_needs_setup",
			tone: "danger",
		});
	});

	it("replaces cached attention with checking while all surfaces reconcile", () => {
		const readiness = buildReadiness({
			localComponents: buildLocalComponents({
				cliStatus: "update_available",
			}),
		});
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			isReconcilingStatus: true,
			readiness,
		});

		expect(status).toMatchObject({ reason: "checking", tone: "checking" });
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				isReconcilingStatus: true,
				localRuntimeCount: 1,
				readiness,
			})
		).toBeNull();
	});

	it("uses checking when Core is actively refreshing stale agent evidence", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					nextAction: "check_status",
					primaryBlocker: "agent_controller_report_stale",
					status: "checking",
				}),
			})
		).toMatchObject({ reason: "checking", tone: "checking" });
	});

	it("does not show sidebar attention before a computer exists", () => {
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 0,
				readiness: buildReadiness({
					primaryBlocker: "service_not_connected",
				}),
			})
		).toBeNull();
	});

	it.each([
		["connected", "ready", "OpenMeld Tools are ready"],
		["needs_attention", "warning", "OpenMeld Tools need an update"],
		["not_connected", "danger", "OpenMeld Tools are not connected"],
		["unknown", "muted", "OpenMeld Tools status unavailable"],
	] as const)("maps an Organization computer's %s projection to %s", (serviceState, tone, label) => {
		expect(
			resolveOrganizationComputerSummaryStatus(serviceState)
		).toMatchObject({ label, tone });
	});
});
