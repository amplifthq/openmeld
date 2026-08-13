import { describe, expect, it } from "vitest";
import { formatSpaceAgentControlLabel } from "./space-agent-control-label";

describe("formatSpaceAgentControlLabel", () => {
	it("uses the product label for the hosted Center Agent canonical ref", () => {
		expect(
			formatSpaceAgentControlLabel({
				agentControllerRef: "hosted:center-agent",
				controllerDisplay: "hosted:center-agent",
				profileKind: "agent",
				runtimeDeviceDisplayName: "hosted:center-agent",
			})
		).toBe("Hosted by OpenMeld");
		expect(
			formatSpaceAgentControlLabel({
				agentControllerRef: "hosted:center-agent",
				controllerDisplay: null,
				profileKind: "agent",
				runtimeDeviceDisplayName: null,
			})
		).toBe("Hosted by OpenMeld");
	});

	it("keeps workstation controller and device labels visible", () => {
		expect(
			formatSpaceAgentControlLabel({
				agentControllerRef: "builtin:codex",
				controllerDisplay: "Codex",
				profileKind: "agent",
				runtimeDeviceDisplayName: "Felix's MacBook Pro",
			})
		).toBe("Controlled by Felix's MacBook Pro Codex");
	});
});
