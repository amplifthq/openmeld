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
 * A resolved Binding identifies the routed Computer. When no Binding exists,
 * the reply-readiness subject lets a freshly connected, unbound Computer remain
 * visible without creating a separate browser-owned selection.
 *
 * Prefer the Binding target when present because it is the account's routing
 * intent. Otherwise read the reply-readiness subject, which lets a connected
 * but unbound computer surface without inventing a browser-owned pointer.
 */
export function resolveConnectedRuntimeTarget(
	sources: ConnectedRuntimeSources
): ConnectedRuntimeTarget | null {
	const currentDeviceTarget = sources.currentDeviceTargetQuery.data;
	if (currentDeviceTarget?.availability === "resolved") {
		return {
			deviceId: currentDeviceTarget.deviceId,
			runtimeLane: currentDeviceTarget.runtimeLane,
		};
	}
	const replyReadinessTarget =
		sources.currentLocalRuntimeReplyReadinessQuery?.data?.currentTarget;
	if (replyReadinessTarget?.availability === "resolved") {
		return {
			deviceId: replyReadinessTarget.deviceId,
			runtimeLane: replyReadinessTarget.runtimeLane,
		};
	}
	return null;
}

/** The connected computer record (liveness-first), or null if none is connected. */
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
