import { describe, expect, it } from "vitest";
import { buildCenterAgentComputerSetupIntent } from "./center-agent-computer-setup-card";

const context = {
	orgSlug: "acme",
	profileId: "human_profile_1",
	spaceId: "center_agent_dm_1",
};

describe("buildCenterAgentComputerSetupIntent", () => {
	it("maps setup to the current Center Agent conversation without forcing a reset", () => {
		expect(
			buildCenterAgentComputerSetupIntent({
				context,
				target: { kind: "computer_setup", mode: "setup" },
			})
		).toEqual({
			agentProfileIds: [],
			kind: "space_recovery",
			profileId: "human_profile_1",
			resetThisComputer: false,
			spaceId: "center_agent_dm_1",
		});
	});

	it("maps reconnect and update to a fresh session for the exact computer", () => {
		expect(
			buildCenterAgentComputerSetupIntent({
				context,
				target: {
					connectedComputerId: "computer_1",
					kind: "computer_setup",
					mode: "reconnect",
				},
			})
		).toEqual({
			agentProfileIds: [],
			connectedComputerId: "computer_1",
			kind: "space_recovery",
			profileId: "human_profile_1",
			resetThisComputer: true,
			spaceId: "center_agent_dm_1",
		});

		expect(
			buildCenterAgentComputerSetupIntent({
				context,
				target: {
					connectedComputerId: "computer_1",
					kind: "computer_setup",
					mode: "update_service",
				},
			})
		).toEqual({
			agentProfileIds: [],
			connectedComputerId: "computer_1",
			kind: "space_recovery",
			profileId: "human_profile_1",
			resetThisComputer: true,
			serviceAction: "update_service",
			spaceId: "center_agent_dm_1",
		});
	});
});
