import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
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

function buildExecutionTarget(input: {
	agentId: string;
	displayName: string;
	reasonCodes: string[];
}): LocalRuntimeExecutionTarget {
	return {
		capabilities: [
			{
				agentControllerInterface: null,
				agentControllerRef: `builtin:${input.agentId}`,
				enabled: true,
				reasonCodes: input.reasonCodes,
				status: "not_ready",
			},
		],
		deviceId: "device-1",
		isCurrent: true,
		lastObservedAtMs: 1_700_000_000_000,
		localAgentCatalog: {
			detectedNotSupportedYet: 0,
			detectedSupported: 1,
			entries: [
				{
					agentId: input.agentId,
					detected: true,
					displayName: input.displayName,
					enabled: true,
					lifecycleStatus: "active",
					launchStatus: "needs_repair",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
			],
			needsChoice: 0,
			needsRepair: 1,
			notDetected: 0,
			totalBuiltins: 1,
		},
		localAgentControl: { refreshCatalog: true, setEnabled: true },
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
		},
		reasonCodes: input.reasonCodes,
		runtimeLane: "dev-local",
		status: "not_ready",
		userFacingCommand: "openmeld-dev",
	};
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
			label: "Disconnected",
			reason: "service_not_connected",
			tone: "muted",
		});
	});

	it("asks for attention without making a generic setup claim", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: buildReadiness({
					canReplyFromThisComputer: false,
					nextAction: "run_setup",
					primaryBlocker: "agent_controller_report_not_ready",
					status: "blocked",
				}),
			})
		).toMatchObject({ label: "Local agents need attention", tone: "warning" });
	});

	it("keeps attention when one agent needs sign-in and another has a real failure", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				reasonCodes: [
					"controller.auth.unauthenticated",
					"controller.interface.check_failed",
				],
				signInOnlyBlockers: false,
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({
			label: "Local agents need attention",
			reason: "agent_needs_setup",
			tone: "warning",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBe("warning");
	});

	it("keeps sign-in quiet when an enabled local agent only needs its account connected", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				reasonCodes: ["controller.auth.unauthenticated"],
				signInOnlyBlockers: true,
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({
			label: "Sign in to a local agent",
			reason: "agent_sign_in_needed",
			tone: "muted",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBeNull();
	});

	it("prioritizes an available Tools update over a sign-in-only local agent", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			localComponents: buildLocalComponents({ cliStatus: "update_available" }),
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				reasonCodes: ["controller.auth.unauthenticated"],
				signInOnlyBlockers: true,
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({
			label: "Update available",
			reason: "openmeld_tools_update",
			tone: "warning",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBe("warning");
	});

	it("names and identifies one local agent that needs sign-in", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				reasonCodes: [
					"provider_account.access_required",
					"controller.auth.unauthenticated",
				],
				signInOnlyBlockers: true,
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				executionTarget: buildExecutionTarget({
					agentId: "claude-code",
					displayName: "Claude Code",
					reasonCodes: [
						"provider_account.access_required",
						"controller.auth.unauthenticated",
					],
				}),
				readiness,
			})
		).toMatchObject({
			label: "Sign in to Claude Code",
			localAgent: { agentId: "claude-code", displayName: "Claude Code" },
			reason: "agent_sign_in_needed",
			tone: "muted",
		});
	});

	it("uses clear installation guidance for one affected local agent", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				executionTarget: buildExecutionTarget({
					agentId: "claude-code",
					displayName: "Claude Code",
					reasonCodes: ["controller.launch.choice_required"],
				}),
				readiness,
			})
		).toMatchObject({
			label: "Choose a Claude Code installation",
			localAgent: { agentId: "claude-code", displayName: "Claude Code" },
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				executionTarget: buildExecutionTarget({
					agentId: "claude-code",
					displayName: "Claude Code",
					reasonCodes: ["controller.launch.needs_repair"],
				}),
				readiness,
			})
		).toMatchObject({
			label: "Claude Code can’t start",
			localAgent: { agentId: "claude-code", displayName: "Claude Code" },
		});
	});

	it("shows all-disabled local agents as an intentional quiet state", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "none",
			primaryBlocker: "agent_controller_report_not_ready",
			runtime: {
				...buildReadiness().runtime,
				executionTargetStatus: "not_ready",
				reasonCodes: ["local_agent_preparation.not_enabled"],
			},
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({
			label: "Local agents are off",
			reason: "local_agents_off",
			tone: "muted",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBeNull();
	});

	it("still shows an OpenMeld Tools update when all local agents are off", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			localComponents: buildLocalComponents({ cliStatus: "update_available" }),
			nextAction: "none",
			primaryBlocker: "agent_controller_report_not_ready",
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })
		).toMatchObject({ reason: "openmeld_tools_update", tone: "warning" });
	});

	it("keeps Computers attention when an enabled local agent needs setup", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "run_setup",
			primaryBlocker: "agent_controller_report_not_ready",
			status: "blocked",
		});

		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBe("warning");
	});

	it("maps an incomplete controller check to the same warning used in agent detail", () => {
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			readiness: buildReadiness({
				canReplyFromThisComputer: false,
				nextAction: "check_status",
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
			label: "Check delayed",
			reason: "agent_check_failed",
			tone: "warning",
		});
		expect(resolveComputerAttentionTone(status)).toBe("warning");
	});

	it("keeps mixed ready and incomplete controller checks warning-only", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: false,
			nextAction: "check_status",
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
			reason: "agent_check_failed",
			tone: "warning",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				localRuntimeCount: 1,
				readiness,
			})
		).toBe("warning");
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
			tone: "warning",
		});
	});

	it("retains a cached Tools update while background status reconciles", () => {
		const readiness = buildReadiness({
			localComponents: buildLocalComponents({
				cliStatus: "update_available",
			}),
		});
		const status = resolveCurrentLocalRuntimeComputerSummaryStatus({
			isReconcilingStatus: true,
			readiness,
		});

		expect(status).toMatchObject({
			label: "Update available",
			reason: "openmeld_tools_update",
			tone: "warning",
		});
		expect(
			resolveCurrentLocalRuntimeComputerAttentionToneForInventory({
				isReconcilingStatus: true,
				localRuntimeCount: 1,
				readiness,
			})
		).toBe("warning");
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
		["not_connected", "muted", "Disconnected"],
		["unknown", "muted", "OpenMeld Tools status unavailable"],
	] as const)("maps an Organization computer's %s projection to %s", (serviceState, tone, label) => {
		expect(
			resolveOrganizationComputerSummaryStatus(serviceState)
		).toMatchObject({ label, tone });
	});
});
