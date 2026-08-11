import type { LocalRuntimesResponse } from "@openmeld/schemas/types";

export function resolveCurrentLocalRuntime(
	localRuntimes: LocalRuntimesResponse | undefined
) {
	if (!localRuntimes) {
		return null;
	}

	return (
		localRuntimes.localRuntimes.find((device) => device.isCurrent) ??
		(localRuntimes.currentDeviceId && localRuntimes.currentRuntimeLane
			? (localRuntimes.localRuntimes.find(
					(device) =>
						device.deviceId === localRuntimes.currentDeviceId &&
						device.executionTargets.some(
							(target) =>
								target.runtimeLane === localRuntimes.currentRuntimeLane &&
								target.isCurrent
						)
				) ?? null)
			: null)
	);
}
