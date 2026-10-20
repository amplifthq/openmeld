import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatPublicWakeabilityReason } from "#/lib/agents/agent-viewer-access";
import {
	AgentAccessIndicator,
	resolveAgentChatActionLabel,
} from "./agent-access-indicator";

describe("AgentAccessIndicator", () => {
	afterEach(cleanup);

	it("tells a colleague they can use the Agent", () => {
		render(
			<AgentAccessIndicator
				access={{ kind: "can_use", ownerName: "Tali Smoke" }}
			/>
		);
		expect(screen.getByTestId("agent-access-indicator").textContent).toBe(
			"You can use"
		);
	});

	it("names the owner who answers first", () => {
		render(
			<AgentAccessIndicator
				access={{ kind: "asks_owner", ownerName: "Tali Smoke" }}
			/>
		);
		expect(screen.getByTestId("agent-access-indicator").textContent).toBe(
			"Asks Tali Smoke"
		);
	});

	it("offers Ask to use only when the owner answers first", () => {
		expect(
			resolveAgentChatActionLabel({
				access: { kind: "asks_owner", ownerName: "Tali Smoke" },
				profileName: "Codex",
			})
		).toBe("Ask to use");
		expect(
			resolveAgentChatActionLabel({
				access: { kind: "can_use", ownerName: "Tali Smoke" },
				profileName: "Codex",
			})
		).toBe("Chat with Codex");
		expect(
			resolveAgentChatActionLabel({ access: null, profileName: "Codex" })
		).toBe("Chat with Codex");
	});
});

describe("formatPublicWakeabilityReason", () => {
	it.each([
		[{ code: "harness_turned_off" }, "Turned off on its computer"],
		[{ code: "no_working_folder" }, "No working folder"],
		[{ code: "computer_offline" }, "Computer offline"],
		[{ code: "usage_exhausted", resetAt: null }, "Usage limit reached"],
	] as const)("names %j neutrally", (reason, label) => {
		expect(formatPublicWakeabilityReason(reason)).toBe(label);
	});
});
