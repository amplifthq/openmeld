import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpaceAgentThinking } from "./space-agent-thinking";

afterEach(cleanup);

describe("SpaceAgentThinking", () => {
	it("keeps live model thinking collapsed with the active Mobius indicator", () => {
		render(
			<SpaceAgentThinking thinking="Checking the repository before answering." />
		);

		const trigger = screen.getByRole("button", {
			name: "Thinking… Checking the repository before answering.",
		});
		const thinkingSteps = trigger.closest('[data-slot="thinking-steps"]');
		expect(thinkingSteps?.classList.contains("w-full")).toBe(true);
		expect(thinkingSteps?.classList.contains("max-w-full")).toBe(true);
		expect(thinkingSteps?.classList.contains("max-w-xl")).toBe(false);
		expect(trigger.classList.contains("px-0")).toBe(true);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(
			trigger.querySelector('[data-slot="animated-mobius-icon"]')
		).not.toBeNull();
		expect(trigger.querySelector("[data-space-agent-orb-state]")).toBeNull();

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const output = screen.getByRole("status");
		expect(output.textContent).toBe(
			"Checking the repository before answering."
		);
		expect(output.classList.contains("block")).toBe(true);
		expect(output.classList.contains("w-full")).toBe(true);
		expect(output.classList.contains("px-1")).toBe(false);
		expect(
			output
				.closest('[data-slot="thinking-steps-content"]')
				?.classList.contains("px-1")
		).toBe(false);
	});
});
