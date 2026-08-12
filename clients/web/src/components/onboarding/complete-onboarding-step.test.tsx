import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompleteOnboardingStep } from "./complete-onboarding-step";

const state = {
	appNames: [],
	channelNames: [],
	computerName: null,
	invitationCount: 0,
	isPersonal: true,
	localAgentNames: [],
	memoryEnabled: true,
	organizationId: "organization-123",
	organizationName: "Personal Workspace",
};

describe("CompleteOnboardingStep", () => {
	afterEach(cleanup);

	it("makes the enabled personal Workspace memory default visible", () => {
		render(<CompleteOnboardingStep onContinue={vi.fn()} state={state} />);

		expect(screen.getByText("Workspace memory is on")).toBeTruthy();
		expect(
			screen.getByText(
				"Your Center Agent can remember useful context from Spaces and connected channels."
			)
		).toBeTruthy();
	});

	it("waits for workspace initialization before allowing another continue", () => {
		const onContinue = vi.fn(() => new Promise<void>(() => undefined));
		render(<CompleteOnboardingStep onContinue={onContinue} state={state} />);

		fireEvent.click(screen.getByRole("button", { name: "Open OpenMeld" }));

		const openingButton = screen.getByRole("button", {
			name: "Opening OpenMeld…",
		});
		expect((openingButton as HTMLButtonElement).disabled).toBe(true);
		expect(onContinue).toHaveBeenCalledOnce();
	});

	it("keeps onboarding open and explains when initialization fails", async () => {
		const onContinue = vi.fn().mockRejectedValue(new Error("not ready"));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		render(<CompleteOnboardingStep onContinue={onContinue} state={state} />);

		fireEvent.click(screen.getByRole("button", { name: "Open OpenMeld" }));

		expect(
			await screen.findByText(
				"OpenMeld couldn’t finish setting up your workspace. Try again."
			)
		).not.toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Open OpenMeld",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		consoleError.mockRestore();
	});
});
