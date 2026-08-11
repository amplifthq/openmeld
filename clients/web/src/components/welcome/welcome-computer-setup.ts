import type { CurrentDeviceTargetResponse } from "@openmeld/schemas/types";

export function shouldOfferWelcomeComputerSetup(input: {
	currentDeviceTargetAvailability:
		| CurrentDeviceTargetResponse["availability"]
		| undefined;
	currentDeviceTargetReady: boolean;
	localRuntimeCount: number | undefined;
	localRuntimesReady: boolean;
}): boolean {
	if (!(input.currentDeviceTargetReady && input.localRuntimesReady)) {
		return false;
	}
	return (
		input.currentDeviceTargetAvailability !== "resolved" &&
		input.localRuntimeCount === 0
	);
}
