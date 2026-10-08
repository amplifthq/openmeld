import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingEntryGate } from "./onboarding-entry-gate";

const navigate = vi.fn();
const tutorial = {
	hasStartedTutorial: false,
	loading: false,
	error: null as Error | null,
};
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("./walkthrough/walkthrough-context", () => ({
	useWalkthrough: () => tutorial,
}));
const organization = { id: "org-acme", name: "Acme", slug: "acme" };
const props = {
	currentOrganization: organization,
	currentSection: "home" as const,
	organizations: [organization],
	storageScope: "account-test",
};

describe("tutorial admission", () => {
	beforeEach(() => {
		window.localStorage.clear();
		navigate.mockReset().mockResolvedValue(undefined);
		tutorial.hasStartedTutorial = false;
		tutorial.loading = false;
		tutorial.error = null;
	});
	afterEach(cleanup);
	it("opens the new tutorial for a first entry", async () => {
		render(<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>);
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/onboarding",
			})
		);
		expect(screen.queryByText("Product")).toBeNull();
		expect(window.localStorage.length).toBe(0);
	});
	it("keeps an invitation destination and its subsequent navigation", async () => {
		const view = render(
			<OnboardingEntryGate
				{...props}
				currentSection="space"
				hasExplicitSpaceDestination
			>
				Space
			</OnboardingEntryGate>
		);
		expect(await screen.findByText("Space")).toBeTruthy();
		view.rerender(
			<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>
		);
		expect(await screen.findByText("Product")).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});
	it("does not restart first entry when an account switches to a workspace without a run", async () => {
		tutorial.hasStartedTutorial = true;
		render(<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>);
		expect(await screen.findByText("Product")).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});
	it("offers the new tutorial once even after completing the former onboarding", async () => {
		window.localStorage.setItem(
			"openmeld:onboarding:account-test:v1",
			JSON.stringify({ version: 1, completedAtMs: 2 })
		);
		const view = render(
			<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>
		);
		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/onboarding",
			})
		);
		tutorial.hasStartedTutorial = true;
		navigate.mockClear();
		view.rerender(
			<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>
		);
		expect(await screen.findByText("Product")).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
		expect(
			window.localStorage.getItem("openmeld:onboarding:account-test:v1")
		).toBe(JSON.stringify({ version: 1, completedAtMs: 2 }));
	});
	it("waits for admission, then leaves the product usable if progress cannot be read", async () => {
		tutorial.loading = true;
		const view = render(
			<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>
		);
		expect(screen.queryByText("Product")).toBeNull();
		expect(navigate).not.toHaveBeenCalled();
		tutorial.loading = false;
		tutorial.error = new Error("Network unavailable");
		view.rerender(
			<OnboardingEntryGate {...props}>Product</OnboardingEntryGate>
		);
		expect(await screen.findByText("Product")).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});
});
