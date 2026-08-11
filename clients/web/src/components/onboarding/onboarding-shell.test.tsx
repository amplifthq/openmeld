import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingShell } from "./onboarding-shell";

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
				step="apps"
				steps={["organization", "apps", "local-agents", "complete"]}
				title="Apps"
			>
				<div>Apps step</div>
			</OnboardingShell>
		);

		const progress = screen.getByRole("progressbar");
		expect(progress.getAttribute("aria-label")).toBe("Step 2 of 3");
		expect(progress.getAttribute("aria-valuemax")).toBe("3");
	});

	it("returns the document and step panel to the top when the step changes", () => {
		const scrollTo = vi
			.spyOn(window, "scrollTo")
			.mockImplementation(() => undefined);
		const { container, rerender } = render(
			<main>
				<OnboardingShell
					demo={<div>Channels demo</div>}
					description="Channels description"
					eyebrow="Channels"
					step="channels"
					steps={[
						"organization",
						"channels",
						"apps",
						"local-agents",
						"setup",
						"invite",
						"complete",
					]}
					title="Channels"
				>
					<div>Channels step</div>
				</OnboardingShell>
			</main>
		);
		const appViewport = container.querySelector("main");
		const stepPanel = container.querySelector("section");
		if (!(appViewport && stepPanel)) {
			throw new Error("Expected the onboarding scroll surfaces to render.");
		}
		appViewport.scrollTop = 95;
		stepPanel.scrollTop = 240;
		scrollTo.mockClear();

		rerender(
			<main>
				<OnboardingShell
					demo={<div>Apps demo</div>}
					description="Apps description"
					eyebrow="Apps"
					step="apps"
					steps={[
						"organization",
						"channels",
						"apps",
						"local-agents",
						"setup",
						"invite",
						"complete",
					]}
					title="Apps"
				>
					<div>Apps step</div>
				</OnboardingShell>
			</main>
		);

		expect(scrollTo).toHaveBeenCalledWith({
			behavior: "auto",
			left: 0,
			top: 0,
		});
		expect(appViewport.scrollTop).toBe(0);
		expect(stepPanel.scrollTop).toBe(0);
	});
});
