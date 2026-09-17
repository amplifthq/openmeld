import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingShell } from "./onboarding-shell";
import { OnboardingStepLayout } from "./onboarding-step-layout";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("OnboardingShell", () => {
	it("shows only the steps in the selected workspace path", () => {
		render(
			<OnboardingShell
				demo={<div>Personal demo</div>}
				description="Personal description"
				eyebrow="Workspace"
				step="plugins"
				steps={["organization", "plugins", "local-agents", "complete"]}
				title="Plugins"
			>
				<div>Plugins step</div>
			</OnboardingShell>
		);

		const progress = screen.getByRole("progressbar");
		expect(progress.getAttribute("aria-label")).toBe("Step 2 of 3");
		expect(progress.getAttribute("aria-valuemax")).toBe("3");
	});

	it("keeps the step action outside the scrolling content", () => {
		const onContinue = vi.fn();
		const { container } = render(
			<OnboardingShell
				demo={<div>Plugins demo</div>}
				description="Plugins description"
				eyebrow="Plugins"
				step="plugins"
				steps={["organization", "plugins", "local-agents", "complete"]}
				title="Plugins"
			>
				<OnboardingStepLayout
					body={<div>Long plugin list</div>}
					footer={
						<button onClick={onContinue} type="button">
							Continue
						</button>
					}
				/>
			</OnboardingShell>
		);

		const scrollArea = container.querySelector(
			'[data-slot="onboarding-step-scroll-area"]'
		);
		const viewport = scrollArea?.querySelector(
			'[data-slot="scroll-area-viewport"]'
		);
		const footer = container.querySelector(
			'[data-slot="onboarding-step-footer"]'
		);
		expect(viewport?.contains(screen.getByText("Long plugin list"))).toBe(true);
		expect(viewport?.contains(footer)).toBe(false);

		fireEvent.click(screen.getByText("Continue"));
		expect(onContinue).toHaveBeenCalledOnce();
	});
});
