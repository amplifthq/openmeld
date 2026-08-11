import type {
	CurrentDeviceTargetResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	resolveConnectedLocalRuntime,
	resolveConnectedRuntimeTarget,
} from "./connected-runtime";

// A Binding identifies the routed Computer. Without one, the reply-readiness
// subject keeps a freshly connected, unbound Computer visible.

function replyReadinessWithTarget(
	currentTarget: CurrentLocalRuntimeReplyReadinessResponse["currentTarget"]
): CurrentLocalRuntimeReplyReadinessResponse {
	return { currentTarget } as CurrentLocalRuntimeReplyReadinessResponse;
}

function computer(deviceId: string): LocalRuntimeComputer {
	return { deviceId } as LocalRuntimeComputer;
}

function localRuntimes(
	devices: readonly LocalRuntimeComputer[]
): LocalRuntimesResponse {
	return { localRuntimes: devices } as LocalRuntimesResponse;
}

describe("resolveConnectedRuntimeTarget", () => {
	it("prefers the Binding-derived current device when it is resolved", () => {
		const currentDeviceTarget: CurrentDeviceTargetResponse = {
			availability: "resolved",
			deviceId: "device-binding",
			runtimeLane: "prod",
		};
		expect(
			resolveConnectedRuntimeTarget({
				currentDeviceTargetQuery: { data: currentDeviceTarget },
				currentLocalRuntimeReplyReadinessQuery: {
					data: replyReadinessWithTarget({
						availability: "resolved",
						deviceId: "device-live",
						runtimeLane: "prod",
					}),
				},
			})
		).toEqual({ deviceId: "device-binding", runtimeLane: "prod" });
	});

	it("falls back to the live ServiceRuntime subject when no Binding names a current device", () => {
		expect(
			resolveConnectedRuntimeTarget({
				currentDeviceTargetQuery: { data: { availability: "missing" } },
				currentLocalRuntimeReplyReadinessQuery: {
					data: replyReadinessWithTarget({
						availability: "resolved",
						deviceId: "device-live",
						runtimeLane: "prod",
					}),
				},
			})
		).toEqual({ deviceId: "device-live", runtimeLane: "prod" });
	});

	it("returns null when neither a Binding nor a live ServiceRuntime subject exists", () => {
		expect(
			resolveConnectedRuntimeTarget({
				currentDeviceTargetQuery: { data: { availability: "missing" } },
				currentLocalRuntimeReplyReadinessQuery: {
					data: replyReadinessWithTarget({ availability: "missing" }),
				},
			})
		).toBeNull();
	});

	it("returns null when the readiness query has not loaded and there is no Binding", () => {
		expect(
			resolveConnectedRuntimeTarget({
				currentDeviceTargetQuery: { data: { availability: "missing" } },
			})
		).toBeNull();
	});
});

describe("resolveConnectedLocalRuntime", () => {
	it("returns the connected computer record matching the liveness target", () => {
		expect(
			resolveConnectedLocalRuntime({
				currentDeviceTargetQuery: { data: { availability: "missing" } },
				currentLocalRuntimeReplyReadinessQuery: {
					data: replyReadinessWithTarget({
						availability: "resolved",
						deviceId: "device-live",
						runtimeLane: "prod",
					}),
				},
				localRuntimesQuery: {
					data: localRuntimes([
						computer("device-other"),
						computer("device-live"),
					]),
				},
			})
		).toEqual(computer("device-live"));
	});

	it("matches a re-enrolled device inside the same connected computer record", () => {
		const reconnectedComputer = {
			deviceId: "device-binding",
			executionTargets: [{ deviceId: "device-live", runtimeLane: "prod" }],
			legacyDeviceIds: ["device-binding", "device-live"],
		} as LocalRuntimeComputer;

		expect(
			resolveConnectedLocalRuntime({
				currentDeviceTargetQuery: {
					data: {
						availability: "resolved",
						deviceId: "device-binding",
						runtimeLane: "prod",
					},
				},
				currentLocalRuntimeReplyReadinessQuery: {
					data: replyReadinessWithTarget({
						availability: "resolved",
						deviceId: "device-live",
						runtimeLane: "prod",
					}),
				},
				localRuntimesQuery: {
					data: localRuntimes([reconnectedComputer]),
				},
			})
		).toBe(reconnectedComputer);
	});

	it("returns null when no computer matches the resolved target", () => {
		expect(
			resolveConnectedLocalRuntime({
				currentDeviceTargetQuery: {
					data: {
						availability: "resolved",
						deviceId: "device-missing",
						runtimeLane: "prod",
					},
				},
				localRuntimesQuery: { data: localRuntimes([computer("device-other")]) },
			})
		).toBeNull();
	});
});
