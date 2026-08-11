import { describe, expect, it } from "vitest";
import {
	createStartShellPrepareReadinessDisplay,
	type StartShellPrepareProjectionForDisplay,
} from "./prepare-readiness-display";

function createPrepareProjection(
	overrides: Partial<StartShellPrepareProjectionForDisplay> = {}
): StartShellPrepareProjectionForDisplay {
	return {
		projectionStatus: overrides.projectionStatus ?? "ready",
		allRunnableCapabilitiesPrepared:
			overrides.allRunnableCapabilitiesPrepared ?? {
				value: true,
				status: "prepared",
				runnableCapabilityCount: 1,
				preparedCapabilityCount: 1,
				reasonCodes: ["runtime.ready", "capability.ready"],
			},
		runtimeReadiness: overrides.runtimeReadiness ?? {
			status: "ready",
			openMeldServiceRuntimeId: "runtime-1",
			deviceId: "device-1",
			lane: "openmeld-dev",
			displayName: "Felix MacBook Pro",
			reasonCodes: ["runtime.ready"],
		},
		capabilityStatuses: overrides.capabilityStatuses ?? [
			{
				agentControllerRef: "builtin:codex",
				displayName: "Codex",
				status: "ready",
				reasonCodes: ["capability.ready"],
			},
		],
		serviceReadiness: overrides.serviceReadiness ?? {
			status: "running",
			displayName: "OpenMeld Service",
			reasonCodes: ["service.ready"],
		},
		reasonCodes: overrides.reasonCodes ?? ["runtime.ready"],
		diagnosticPointer: overrides.diagnosticPointer,
		nextSteps: overrides.nextSteps,
		observedAt: overrides.observedAt,
		expiresAt: overrides.expiresAt,
		source: overrides.source ?? "runtime_projection",
	};
}

describe("start shell prepare readiness display", () => {
	it("keeps a missing prepare projection out of the ready state", () => {
		expect(createStartShellPrepareReadinessDisplay(null)).toMatchObject({
			state: "unknown",
			statusLabel: "Local agent setup unknown",
			allRunnableCapabilitiesPrepared: null,
			reasonCodes: ["runtime.projection_missing"],
		});
	});

	it("does not use legacy prepare_local_agents compatibility as readiness truth", () => {
		const display = createStartShellPrepareReadinessDisplay({
			projectionStatus: "ready",
			allRunnableCapabilitiesPrepared: {
				value: null,
				status: "unknown",
				reasonCodes: ["runtime.projection_missing"],
			},
			runtimeReadiness: {
				status: "unknown",
				reasonCodes: ["runtime.projection_missing"],
			},
			capabilityStatuses: [],
			serviceReadiness: {
				status: "unknown",
				reasonCodes: ["service.ready"],
			},
			reasonCodes: ["local_agent_preparation.not_enabled"],
			source: "historical_local_agent_preparation_bridge",
		});

		expect(display.state).toBe("unknown");
		expect(display.allRunnableCapabilitiesPrepared).toBeNull();
		expect(display.summary).not.toContain("prepared");
		expect(display.reasonCodes).toContain(
			"local_agent_preparation.not_enabled"
		);
	});

	it("shows local agents connected only when projection value is true", () => {
		expect(
			createStartShellPrepareReadinessDisplay(createPrepareProjection())
		).toMatchObject({
			state: "ready",
			statusLabel: "Local agents connected",
			allRunnableCapabilitiesPrepared: true,
		});
	});

	it.each([
		{
			projectionStatus: "pending" as const,
			expectedState: "pending",
			expectedLabel: "Local agent setup pending",
		},
		{
			projectionStatus: "unavailable" as const,
			expectedState: "unavailable",
			expectedLabel: "Local agent setup unavailable",
		},
		{
			projectionStatus: "needs_prepare" as const,
			expectedState: "needs_prepare",
			expectedLabel: "Local agent setup needed",
		},
		{
			projectionStatus: "unknown" as const,
			expectedState: "unknown",
			expectedLabel: "Local agent setup unknown",
		},
	])("keeps $projectionStatus projection display out of the ready state", ({
		expectedLabel,
		expectedState,
		projectionStatus,
	}) => {
		expect(
			createStartShellPrepareReadinessDisplay(
				createPrepareProjection({
					projectionStatus,
					allRunnableCapabilitiesPrepared: {
						value: null,
						status: "unknown",
						reasonCodes: ["runtime.projection_missing"],
					},
				})
			)
		).toMatchObject({
			state: expectedState,
			statusLabel: expectedLabel,
			allRunnableCapabilitiesPrepared: null,
		});
	});

	it("keeps a stale prepare projection out of the ready state", () => {
		expect(
			createStartShellPrepareReadinessDisplay(
				createPrepareProjection({
					expiresAt: "2000-01-01T00:00:00.000Z",
					reasonCodes: [],
				})
			)
		).toMatchObject({
			state: "stale",
			statusLabel: "Local agent setup stale",
			allRunnableCapabilitiesPrepared: true,
			reasonCodes: expect.arrayContaining(["runtime.projection_stale"]),
		});
	});

	it("surfaces repair command display data without executing repair", () => {
		expect(
			createStartShellPrepareReadinessDisplay(
				createPrepareProjection({
					projectionStatus: "needs_repair",
					allRunnableCapabilitiesPrepared: {
						value: false,
						status: "not_prepared",
						reasonCodes: ["service.needs_repair"],
					},
					runtimeReadiness: {
						status: "needs_repair",
						reasonCodes: ["service.needs_repair"],
					},
					capabilityStatuses: [],
					serviceReadiness: {
						status: "needs_repair",
						displayName: "OpenMeld Service",
						reasonCodes: ["service.needs_repair"],
					},
					reasonCodes: ["service.needs_repair"],
					nextSteps: [
						{
							kind: "repair_service",
							label: "Repair OpenMeld Service",
							commandDisplay: {
								command: "openmeld doctor --repair",
								copyable: true,
							},
							blocksContinue: true,
							reasonCodes: ["service.needs_repair"],
						},
					],
					source: "prepare_attempt",
				})
			)
		).toMatchObject({
			state: "needs_repair",
			statusLabel: "Repair needed",
			commandDisplay: {
				command: "openmeld-dev doctor --repair",
				copyable: true,
			},
		});
	});

	it("surfaces reason codes and diagnostic pointers as display evidence", () => {
		const display = createStartShellPrepareReadinessDisplay(
			createPrepareProjection({
				allRunnableCapabilitiesPrepared: {
					value: true,
					status: "prepared",
					reasonCodes: ["all_runnable.prepared"],
				},
				capabilityStatuses: [
					{
						agentControllerRef: "builtin:codex",
						displayName: "Codex",
						status: "ready",
						reasonCodes: ["capability.ready"],
					},
				],
				diagnosticPointer: {
					type: "prepare_projection",
					source: "runtime_projection",
					correlationId: "correlation-1",
					openMeldServiceRuntimeId: "runtime-1",
					deviceId: "device-1",
					lane: "openmeld-dev",
					reasonCodes: ["runtime.projection_stale"],
					traceCommandDisplay:
						"openmeld service trace --runtime runtime-1 --view human",
				},
				serviceReadiness: {
					status: "running",
					displayName: "OpenMeld Service",
					reasonCodes: ["service.ready"],
				},
				reasonCodes: ["runtime.projection_stale"],
				runtimeReadiness: {
					status: "ready",
					reasonCodes: ["runtime.ready"],
				},
			})
		);

		expect(display.reasonCodes).toEqual(
			expect.arrayContaining([
				"all_runnable.prepared",
				"capability.ready",
				"runtime.ready",
				"runtime.projection_stale",
				"service.ready",
			])
		);
		expect(display.reasonCodes).toContain("runtime.projection_stale");
		expect(display.diagnosticPointer).toMatchObject({
			correlationId: "correlation-1",
			traceCommandDisplay:
				"openmeld-dev service trace --runtime runtime-1 --view human",
		});
	});
});
