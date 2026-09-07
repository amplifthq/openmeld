import type {
	CurrentDeviceTargetResponse,
	CurrentLocalRuntimeReplyReadinessResponse,
	DaemonServiceLane,
	LocalRuntimeComputer,
	LocalRuntimesResponse,
} from "@openmeld/schemas/types";

export type ConnectedRuntimeTarget = {
	deviceId: string;
	runtimeLane: DaemonServiceLane;
};

/**
 * The minimal slice of the local-agent recovery controller these helpers read.
 * Typed structurally so connectivity surfaces can derive the liveness identity
 * without importing the controller hook (and so tests that mock the controller
 * with these query shapes get correct behavior without extra fields).
 */
export type ConnectedRuntimeSources = {
	currentDeviceTargetQuery: { data?: CurrentDeviceTargetResponse };
	currentLocalRuntimeReplyReadinessQuery?: {
		data?: CurrentLocalRuntimeReplyReadinessResponse;
	};
	localRuntimesQuery?: { data?: LocalRuntimesResponse };
};

/**
 * Resolves the Computer described by current local-runtime surfaces.
 *
 * Prefer the exact subject of the supplied readiness query. The caller chooses
 * whether this is a browser selection or an account routing preference; neither
 * establishes which physical computer hosts the browser. Binding is used only
 * as a selection preference before readiness is available, never as liveness.
 */
export function resolveConnectedRuntimeTarget(
	sources: ConnectedRuntimeSources
): ConnectedRuntimeTarget | null {
	const replyReadinessTarget =
		sources.currentLocalRuntimeReplyReadinessQuery?.data?.currentTarget;
	if (replyReadinessTarget?.availability === "resolved") {
		return {
			deviceId: replyReadinessTarget.deviceId,
			runtimeLane: replyReadinessTarget.runtimeLane,
		};
	}
	const currentDeviceTarget = sources.currentDeviceTargetQuery.data;
	if (currentDeviceTarget?.availability === "resolved") {
		return {
			deviceId: currentDeviceTarget.deviceId,
			runtimeLane: currentDeviceTarget.runtimeLane,
		};
	}
	return null;
}

/** The selected computer record. Connection is a separate Core fact. */
export function resolveConnectedLocalRuntime(
	sources: ConnectedRuntimeSources
): LocalRuntimeComputer | null {
	const target = resolveConnectedRuntimeTarget(sources);
	if (target === null) {
		return null;
	}
	return (
		sources.localRuntimesQuery?.data?.localRuntimes.find(
			(computer) =>
				computer.deviceId === target.deviceId ||
				computer.executionTargets?.some(
					(executionTarget) =>
						executionTarget.deviceId === target.deviceId &&
						executionTarget.runtimeLane === target.runtimeLane
				) === true ||
				computer.legacyDeviceIds?.includes(target.deviceId) === true
		) ?? null
	);
}
