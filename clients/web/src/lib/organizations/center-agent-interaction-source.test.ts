import { describe, expect, it } from "vitest";
import { formatCenterAgentInteractionClient } from "./center-agent-interaction-source";

describe("formatCenterAgentInteractionClient", () => {
	it("uses familiar product names", () => {
		expect(formatCenterAgentInteractionClient("codex")).toBe("Codex");
		expect(formatCenterAgentInteractionClient("claude-code")).toBe(
			"Claude Code"
		);
		expect(formatCenterAgentInteractionClient("openmeld-cli")).toBe(
			"OpenMeld CLI"
		);
	});

	it("keeps an unknown client label explicit", () => {
		expect(formatCenterAgentInteractionClient("my-company-agent")).toBe(
			"my-company-agent"
		);
	});
});
