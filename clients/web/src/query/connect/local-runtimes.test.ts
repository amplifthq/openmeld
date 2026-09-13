import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	boundedCurrentLocalRuntimeReplyReadinessRefetchInterval,
	currentLocalRuntimeReplyReadinessQueryOptions,
	LOCAL_RUNTIME_CATALOG_CHECK_RECOVERY_INTERVAL_MS,
	LOCAL_RUNTIME_USAGE_LIMIT_REFRESH_INTERVAL_MS,
	localRuntimeCatalogCheckRecoveryRefetchInterval,
	resolveLocalRuntimeCatalogReadyReconcileKey,
	shouldReconcileLocalRuntimeCatalogAfterReplyReady,
} from "./local-runtimes";

const REFRESH_INTERVAL_MS = 2000;

function buildReadiness(
	overrides: Partial<CurrentLocalRuntimeReplyReadinessResponse> = {}
): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: false,
		primaryBlocker: "service_not_connected",
		status: "blocked",
		...overrides,
	} as CurrentLocalRuntimeReplyReadinessResponse;
}

function buildQuery(
	data: CurrentLocalRuntimeReplyReadinessResponse | undefined
) {
	return { state: { data, dataUpdateCount: 0 } };
}

function buildLocalRuntimes(
	overrides: Partial<
		LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number]
	> = {}
): LocalRuntimesResponse {
	return {
		currentDeviceId: "device-1",
		currentRuntimeLane: "dev-local",
		localRuntimes: [
			{
				deviceDisplayName: "Felix's MacBook Pro",
				deviceDisplayNameSource: "observed",
				deviceId: "device-1",
				deviceType: "laptop",
				executionTargets: [
					{
						capabilities: [],
						deviceId: "device-1",
						isCurrent: true,
						lastObservedAtMs: 1_700_000_000_000,
						localAgentCatalog: {
							detectedNotSupportedYet: 0,
							detectedSupported: 1,
							entries: [
								{
									agentId: "codex",
									detected: true,
									displayName: "Codex",
									enabled: true,
									launchStatus: "ready",
									lifecycleStatus: "active",
									selectable: true,
									selectableReason: null,
									targetKind: "builtin",
								},
							],
							needsChoice: 0,
							needsRepair: 0,
							notDetected: 0,
							totalBuiltins: 1,
						},
						localAgentControl: { refreshCatalog: true, setEnabled: true },
						reasonCodes: [],
						openMeldServiceRuntimeId: null,
						runtimeLane: "dev-local",
						status: "ready",
						userFacingCommand: "openmeld-dev",
						...overrides,
					},
				],
				firstSeenAtMs: 1_700_000_000_000,
				isCurrent: true,
				lastObservedAtMs: 1_700_000_000_000,
				osVersion: "15.0",
				platformFamily: "macOS",
			},
		],
	};
}

describe("boundedCurrentLocalRuntimeReplyReadinessRefetchInterval", () => {
	it("re-checks Service liveness whenever a status surface mounts", () => {
		const options = currentLocalRuntimeReplyReadinessQueryOptions({
			enabled: true,
			storageScope: "owner-1",
		});

		expect(options.refetchOnMount).toBe("always");
	});

	it("does not poll before the first readiness response arrives", () => {
		expect(
			boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(
				buildQuery(undefined)
			)
		).toBe(false);
	});

	it("does not poll when the runtime can already reply", () => {
		expect(
			boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(
				buildQuery(
					buildReadiness({
						canReplyFromThisComputer: true,
						primaryBlocker: "none",
						status: "ready",
					})
				)
			)
		).toBe(false);
	});

	it("polls while an OpenMeld Tools update is active", () => {
		const query = buildQuery(
			buildReadiness({
				canReplyFromThisComputer: true,
				localComponents: {
					updateOperation: {
						operationId: "update-1",
						phase: "updating",
						requestSource: "web",
						requestedAt: "2026-08-26T00:00:00.000Z",
						targetVersion: "0.8.0",
						updatedAt: "2026-08-26T00:00:00.000Z",
						urgency: "available",
					},
				} as CurrentLocalRuntimeReplyReadinessResponse["localComponents"],
				primaryBlocker: "none",
				status: "ready",
			})
		);

		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			REFRESH_INTERVAL_MS
		);
		query.state.dataUpdateCount += 1;
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			4000
		);
	});

	it("backs off only after settled reads, independently of observer evaluations", () => {
		const query = buildQuery(buildReadiness());
		for (const delay of [2000, 4000, 8000, 16_000, 30_000, 30_000]) {
			for (let observer = 0; observer < 5; observer += 1) {
				expect(
					boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)
				).toBe(delay);
			}
			query.state.dataUpdateCount += 1;
		}
	});

	it("resets backoff when server evidence changes", () => {
		const query = buildQuery(buildReadiness());

		boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query);
		query.state.dataUpdateCount += 1;
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			4000
		);

		query.state.data = buildReadiness({
			primaryBlocker: "service_update_required",
		});
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			REFRESH_INTERVAL_MS
		);
	});

	it("clears the budget on recovery so a later relapse polls again", () => {
		const query = buildQuery(buildReadiness());

		boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query);
		query.state.dataUpdateCount += 1;
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			4000
		);

		query.state.data = buildReadiness({
			canReplyFromThisComputer: true,
			primaryBlocker: "none",
			status: "ready",
		});
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			false
		);

		query.state.data = buildReadiness();
		expect(boundedCurrentLocalRuntimeReplyReadinessRefetchInterval(query)).toBe(
			REFRESH_INTERVAL_MS
		);
	});
});

describe("shouldReconcileLocalRuntimeCatalogAfterReplyReady", () => {
	it("does not reconcile while reply readiness is still blocked", () => {
		expect(
			shouldReconcileLocalRuntimeCatalogAfterReplyReady({
				localRuntimes: buildLocalRuntimes({ status: "stale" }),
				readiness: buildReadiness(),
			})
		).toBe(false);
	});

	it("reconciles once reply readiness is ready but the current row is stale", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: true,
			currentTarget: {
				availability: "resolved",
				deviceId: "device-1",
				runtimeLane: "dev-local",
			},
			primaryBlocker: "none",
			service: {
				connected: true,
			},
			status: "ready",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(
			shouldReconcileLocalRuntimeCatalogAfterReplyReady({
				localRuntimes: buildLocalRuntimes({ status: "stale" }),
				readiness,
			})
		).toBe(true);
		expect(
			resolveLocalRuntimeCatalogReadyReconcileKey({
				localRuntimes: buildLocalRuntimes({ status: "stale" }),
				readiness,
			})
		).toBe("device-1|dev-local");
	});

	it("does not reconcile when the current row is already ready", () => {
		const readiness = buildReadiness({
			canReplyFromThisComputer: true,
			currentTarget: {
				availability: "resolved",
				deviceId: "device-1",
				runtimeLane: "dev-local",
			},
			primaryBlocker: "none",
			service: {
				connected: true,
			},
			status: "ready",
		} as Partial<CurrentLocalRuntimeReplyReadinessResponse>);

		expect(
			shouldReconcileLocalRuntimeCatalogAfterReplyReady({
				localRuntimes: buildLocalRuntimes(),
				readiness,
			})
		).toBe(false);
	});
});

describe("localRuntimeCatalogCheckRecoveryRefetchInterval", () => {
	it("keeps reconciling while a controller check is unavailable", () => {
		const localRuntimes = buildLocalRuntimes({
			capabilities: [
				{
					agentControllerInterface: {
						agentControllerRef: "builtin:cursor",
						auth: { status: "unknown" },
						capabilities: {
							approvals: false,
							cancel: false,
							interrupt: false,
							modelSelection: false,
							nativeEventStream: false,
							permissionModes: false,
							structuredUserInput: false,
						},
						check: {
							lastSucceededAt: null,
							status: "failed",
						},
						checkedAt: "2026-08-01T12:00:00.000Z",
						controllerId: "cursor",
						displayName: "Cursor",
						launch: {
							argsPrefix: [],
							commandPath: "/usr/local/bin/cursor-agent",
							installChoiceCount: 1,
							status: "ready",
						},
						message: "OpenMeld couldn't check this controller.",
						models: [],
						nativeInterface: "local-cli",
						schemaVersion: 1,
						skills: [],
						status: "unavailable",
						version: null,
					},
					agentControllerRef: "builtin:cursor",
					enabled: true,
					reasonCodes: ["controller.interface.check_failed"],
					status: "ready",
				},
			],
		});

		expect(
			localRuntimeCatalogCheckRecoveryRefetchInterval({
				state: { data: localRuntimes },
			})
		).toBe(LOCAL_RUNTIME_CATALOG_CHECK_RECOVERY_INTERVAL_MS);
	});

	it("keeps usage-limit evidence fresh after controller checks recover", () => {
		expect(
			localRuntimeCatalogCheckRecoveryRefetchInterval({
				state: { data: buildLocalRuntimes() },
			})
		).toBe(LOCAL_RUNTIME_USAGE_LIMIT_REFRESH_INTERVAL_MS);
	});
});
