import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocalAgentsOnboardingDemo } from "./local-agents-onboarding-demo";

describe("LocalAgentsOnboardingDemo", () => {
	it("shows every featured local agent in product priority order", () => {
		render(<LocalAgentsOnboardingDemo />);

		const grid = screen.getByTestId("onboarding-local-agent-grid");
		const logos = [
			"codex",
			"claude-code",
			"grok-build",
			"opencode",
			"cursor",
		].map((agentId) => within(grid).getByTestId(`local-agent-logo-${agentId}`));

		expect(within(grid).getByText("Grok Build")).toBeTruthy();
		for (const [index, logo] of logos.entries()) {
			const nextLogo = logos[index + 1];
			if (nextLogo) {
				expect(logo.compareDocumentPosition(nextLogo)).toBe(
					Node.DOCUMENT_POSITION_FOLLOWING
				);
			}
		}
	});
});
