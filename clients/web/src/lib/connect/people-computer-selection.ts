import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import { peopleComputerTargetSchema } from "@openmeld/schemas";
import type {
	CurrentDeviceTargetResponse,
	PeopleComputersResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";

export function selectPeopleComputerTarget(input: {
	inventory?: PeopleComputersResponse;
	routingPreference?: CurrentDeviceTargetResponse;
	completedSetup: {
		deviceId: string | null;
		runtimeLane: string | null;
		humanProfileId: string;
	} | null;
	selectedHumanProfileId?: string | null;
	selection?: "browser" | "routing" | "setup";
	explicitTarget?: PeopleComputerTarget;
}): PeopleComputerTarget | null {
	const computers = input.inventory?.computers ?? [];
	const explicitTarget = input.explicitTarget;
	if (explicitTarget) {
		return computers.some((computer) =>
			peopleComputerContainsDevice(computer, explicitTarget.deviceId)
		)
			? explicitTarget
			: null;
	}
	const setup = peopleComputerTargetSchema.safeParse({
		deviceId: input.completedSetup?.deviceId,
		runtimeLane: input.completedSetup?.runtimeLane,
	});
	if (
		(input.selection === "browser" || input.selection === "setup") &&
		setup.success &&
		input.completedSetup?.humanProfileId === input.selectedHumanProfileId &&
		computers.some((computer) =>
			peopleComputerContainsDevice(computer, setup.data.deviceId)
		)
	) {
		return setup.data;
	}
	// Account routing is not evidence that this browser completed a handoff.
	if (input.selection === "setup") {
		return null;
	}
	const preference = input.routingPreference;
	if (
		preference?.availability === "resolved" &&
		computers.some((computer) =>
			peopleComputerContainsDevice(computer, preference.deviceId)
		)
	) {
		return {
			deviceId: preference.deviceId,
			runtimeLane: preference.runtimeLane,
		};
	}
	const sessions = computers.flatMap(
		(computer) => computer.connection.sessions
	);
	const onlySession = sessions.length === 1 ? sessions[0] : undefined;
	return onlySession
		? { deviceId: onlySession.deviceId, runtimeLane: onlySession.runtimeLane }
		: null;
}
