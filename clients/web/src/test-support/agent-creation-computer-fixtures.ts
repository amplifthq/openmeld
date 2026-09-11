import type { PeopleComputer } from "@openmeld/schemas/types";
import type { useAgentCreationComputerRecovery } from "#/components/profiles/use-agent-creation-computer-recovery";

// Presentation fixtures use the shared PeopleComputer contract. They never
// represent a live runtime or authorize creation, setup, or a Wake.
export function agentCreationComputerFixture(
	name = "Office Mac",
	id = "office-mac"
): PeopleComputer {
	return {
		deviceId: id,
		connectedComputerId: `computer-${id}`,
		deviceDisplayName: name,
		deviceDisplayNameSource: "observed",
		platformFamily: "macOS",
		osVersion: "15.6",
		deviceType: "laptop",
		firstSeenAtMs: 1_789_000_000_000,
		lastObservedAtMs: 1_789_000_000_000,
		identityStatus: "enrolled",
		executionTargets: [],
		connection: { status: "disconnected", sessions: [], reasonCodes: [] },
	};
}

type Recovery = Parameters<
	typeof useAgentCreationComputerRecovery
>[0]["recovery"];

export function agentCreationRecoveryFixture(input: {
	computers: PeopleComputer[];
	deviceId: string | null;
	onSelect: Recovery["selectComputer"];
}): Recovery {
	// Only the computer projection and selection callback are consumed by this
	// hook. Full page/query ownership is tested by create-profile-dialog integration.
	return {
		deviceId: input.deviceId,
		selectComputer: input.onSelect,
		localRuntimesQuery: {
			data: { peopleComputers: { computers: input.computers } },
		},
	} as Recovery;
}
