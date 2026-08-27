import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveCurrentLocalRuntimeServiceActionLabel } from "#/components/agents/agents-page-service-action";
import { resolveCurrentLocalRuntimeComputerSummaryStatus } from "../computer-summary-status";
import { mapCurrentLocalRuntimeReplyReadinessQueryState } from "./current-local-runtime-readiness";

const disconnectedReadiness: CurrentLocalRuntimeReplyReadinessResponse = {
	canReplyFromThisComputer: false,
	currentTarget: {
		availability: "resolved",
		deviceId: "device-office",
		runtimeLane: "prod",
	},
	generatedAt: "2026-05-31T00:00:00.000Z",
	localComponents: {
		agentSetupCommand:
			"npm install -g openmeld@latest && openmeld setup --view agent",
		generatedAt: "2026-05-31T00:00:00.000Z",
		humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
		schemaVersion: 1,
		cli: {
			commandContractVersion:
				"openmeld-cli-command-contract-2026-05-local-components-v1",
			installedPackageVersion: "1.0.0",
			latestPackageVersion: "1.0.0",
			reasonCodes: [],
			requiredCommandContractVersion: null,
			status: "current",
			updatePolicy: "ok",
			wakeBlocked: false,
		},
		service: {
			installedVersion: null,
			latestVersion: "1.0.0",
			reasonCodes: ["service.not_connected"],
			requiredVersion: "1.0.0",
			status: "unknown",
			updatePolicy: "required",
			wakeBlocked: false,
		},
		skills: {
			expectedBundleHash: null,
			expectedTargetCount: 1,
			installedBundleHash: null,
			reasonCodes: [],
			skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
			status: "current",
			targetCount: 1,
			updatePolicy: "ok",
			wakeBlocked: false,
		},
		setupAction: "none",
		setupActionDescription:
			"OpenMeld local components are aligned for this computer.",
		setupActionLabel: "Everything is up to date",
	},
	message:
		"OpenMeld Service is not connected for this account on this computer.",
	nextAction: "reconnect_service",
	primaryBlocker: "service_not_connected",
	runtime: {
		deviceDisplayName: "Office Mac",
		deviceId: "device-office",
		executionTargetStatus: "ready",
		lastObservedAtMs: Date.parse("2026-05-31T00:00:00.000Z"),
		reasonCodes: [],
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "runtime_office",
		},
		runtimeLane: "prod",
		signInOnlyBlockers: false,
	},
	service: {
		connected: false,
		executionCompatibility: null,
		matchingCurrentRuntime: false,
		reasonCodes: ["service.current_runtime_session_missing"],
		sessionDeviceId: null,
		sessionLane: null,
	},
	status: "blocked",
};

const updateRequiredReadiness: CurrentLocalRuntimeReplyReadinessResponse = {
	...disconnectedReadiness,
	canReplyFromThisComputer: false,
	localComponents: {
		...disconnectedReadiness.localComponents,
		service: {
			installedVersion: null,
			latestVersion: "1.0.0",
			reasonCodes: ["service.version_not_reported"],
			requiredVersion: "1.0.0",
			status: "update_required",
			updatePolicy: "required",
			wakeBlocked: true,
		},
		setupAction: "update_service",
		setupActionDescription:
			"Update OpenMeld Service before this computer receives local Wake work.",
		setupActionLabel: "Update OpenMeld Service",
	},
	primaryBlocker: "none",
	service: {
		connected: true,
		executionCompatibility: {
			expectedEpoch:
				"daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
			observedEpoch:
				"daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
			reasonCode: "daemon.runtime_contract.compatible",
			status: "compatible",
		},
		matchingCurrentRuntime: true,
		reasonCodes: [],
		sessionDeviceId: "device-office",
		sessionLane: "prod",
	},
	status: "ready",
};

const retryableControllerCheckReadiness: CurrentLocalRuntimeReplyReadinessResponse =
	{
		...disconnectedReadiness,
		canReplyFromThisComputer: false,
		localComponents: {
			...disconnectedReadiness.localComponents,
			service: {
				...disconnectedReadiness.localComponents.service,
				reasonCodes: [],
				status: "current",
				updatePolicy: "ok",
			},
		},
		message:
			"OpenMeld could not finish checking one or more local agents on this computer. Check again before they reply in Spaces.",
		nextAction: "check_status",
		primaryBlocker: "agent_controller_report_not_ready",
		runtime: {
			...disconnectedReadiness.runtime,
			executionTargetStatus: "partial",
			reasonCodes: [
				"runtime.agent_controller_report.ready",
				"controller.interface.check_failed",
			],
		},
		service: {
			connected: true,
			executionCompatibility: {
				expectedEpoch:
					"daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
				observedEpoch:
					"daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
				reasonCode: "daemon.runtime_contract.compatible",
				status: "compatible",
			},
			matchingCurrentRuntime: true,
			reasonCodes: [],
			sessionDeviceId: "device-office",
			sessionLane: "prod",
		},
		status: "blocked",
	};

describe("mapCurrentLocalRuntimeReplyReadinessQueryState", () => {
	it("keeps hard disconnected service evidence actionable while a fresh check is running", () => {
		expect(
			mapCurrentLocalRuntimeReplyReadinessQueryState({
				isFetching: true,
				isPending: false,
				readiness: disconnectedReadiness,
			})
		).toMatchObject({
			detailReasonCode: "service.current_runtime_session_missing",
			reasonCode: "background_helper.not_running",
			status: "needs_repair",
		});
	});

	it("keeps a completed disconnected service check actionable", () => {
		expect(
			mapCurrentLocalRuntimeReplyReadinessQueryState({
				isFetching: false,
				isPending: false,
				readiness: disconnectedReadiness,
			})
		).toMatchObject({
			detailReasonCode: "service.current_runtime_session_missing",
			reasonCode: "background_helper.not_running",
			status: "needs_repair",
		});
	});

	it("maps a wake-blocking local component update to Update OpenMeld Service even if the primary blocker is stale", () => {
		expect(
			mapCurrentLocalRuntimeReplyReadinessQueryState({
				isFetching: false,
				isPending: false,
				readiness: updateRequiredReadiness,
			})
		).toMatchObject({
			detailReasonCode: "service.version_not_reported",
			reasonCode: "background_helper.update_required",
			status: "needs_repair",
		});
	});

	it("keeps Computers, Agents, and Spaces aligned on a retryable controller check", () => {
		expect(
			resolveCurrentLocalRuntimeComputerSummaryStatus({
				readiness: retryableControllerCheckReadiness,
			})
		).toMatchObject({
			reason: "agent_check_failed",
			tone: "warning",
		});
		const mappedReadiness = mapCurrentLocalRuntimeReplyReadinessQueryState({
			isFetching: false,
			isPending: false,
			readiness: retryableControllerCheckReadiness,
		});
		expect(mappedReadiness).toMatchObject({
			detailReasonCode: "runtime.agent_controller_report.ready",
			reasonCode: "device_reply_readiness.unknown",
			status: "unknown",
		});
		expect(
			resolveCurrentLocalRuntimeServiceActionLabel(mappedReadiness)
		).toBeNull();
	});
});
