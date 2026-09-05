import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	advanceOnboardingProgress,
	completeOnboardingProgress,
	createInitialOnboardingProgress,
	readOnboardingProgress,
	writeOnboardingProgress,
} from "#/lib/onboarding/onboarding-progress";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { OnboardingEntryGate } from "./onboarding-entry-gate";

const navigateMock = vi.fn((_input: unknown): Promise<void> | void =>
	Promise.resolve()
);

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/openmeld-logo-weak", () => ({
	OpenMeldLogo: () => <div>OpenMeld</div>,
}));

const currentOrganization: OrganizationSummary = {
	id: "org-acme",
	name: "Acme",
	slug: "acme",
};
const selectedOrganization: OrganizationSummary = {
	id: "org-beta",
	name: "Beta",
	slug: "beta",
};
let storageScope = "account-test";

describe("OnboardingEntryGate", () => {
	beforeEach(() => {
		window.localStorage.clear();
		navigateMock.mockClear();
		storageScope = `account-${crypto.randomUUID()}`;
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});
	it("preserves an explicit Space destination without marking setup complete", async () => {
		render(
			<OnboardingEntryGate
				currentOrganization={currentOrganization}
				currentSection="spaces"
				hasExplicitSpaceDestination
				organizations={[currentOrganization]}
				storageScope={storageScope}
			>
				App content
			</OnboardingEntryGate>
		);
		expect(await screen.findByText("App content")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
		expect(
			readOnboardingProgress({ storage: window.localStorage, storageScope })
		).toBeNull();
	});

	it("opens onboarding even when browser storage cannot be read", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Storage is blocked");
		});

		renderGate();

		await expectOnboardingRedirect();
		expect(screen.queryByText("App content")).toBeNull();
	});

	it("opens onboarding even when browser storage cannot be written", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Storage is full");
		});

		renderGate();

		await expectOnboardingRedirect();
		expect(screen.queryByText("App content")).toBeNull();
	});

	it("supports routers that schedule navigation synchronously", async () => {
		navigateMock.mockImplementationOnce(() => undefined);

		renderGate();

		await expectOnboardingRedirect();
		expect(screen.queryByText("App content")).toBeNull();
	});

	it("renders the product immediately after this onboarding version is complete", async () => {
		writeOnboardingProgress({
			progress: completeOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
			}),
			storage: window.localStorage,
			storageScope,
		});

		renderGate();

		expect(await screen.findByText("App content")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("keeps onboarding completion when browser storage is unavailable", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("Storage is blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("Storage is blocked");
		});
		writeOnboardingProgress({
			progress: completeOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
			}),
			storage: window.localStorage,
			storageScope,
		});

		renderGate();

		expect(await screen.findByText("App content")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("resumes onboarding inside the Organization the user selected", async () => {
		writeOnboardingProgress({
			progress: advanceOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
				selectedOrganizationId: selectedOrganization.id,
				step: "apps",
			}),
			storage: window.localStorage,
			storageScope,
		});

		renderGate({
			organizations: [currentOrganization, selectedOrganization],
		});

		await expectOnboardingRedirect("/o/beta/onboarding");
	});

	it("resets an unavailable selected Organization before onboarding continues", async () => {
		writeOnboardingProgress({
			progress: advanceOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
				selectedOrganizationId: "org-unavailable",
				step: "apps",
			}),
			storage: window.localStorage,
			storageScope,
		});

		renderGate();

		await expectOnboardingRedirect();
		expect(
			readOnboardingProgress({
				storage: window.localStorage,
				storageScope,
			})
		).toMatchObject({
			currentStep: "organization",
			selectedOrganizationId: null,
		});
	});

	it("corrects a direct onboarding route before mounting Organization steps", async () => {
		writeOnboardingProgress({
			progress: advanceOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
				selectedOrganizationId: selectedOrganization.id,
				step: "apps",
			}),
			storage: window.localStorage,
			storageScope,
		});

		renderGate({
			currentSection: "onboarding",
			organizations: [currentOrganization, selectedOrganization],
		});

		await expectOnboardingRedirect("/o/beta/onboarding");
		expect(screen.queryByText("App content")).toBeNull();
	});
});

function renderGate(input?: {
	currentSection?: "onboarding" | "space";
	organizations?: OrganizationSummary[];
}) {
	return render(
		<OnboardingEntryGate
			currentOrganization={currentOrganization}
			currentSection={input?.currentSection ?? "space"}
			organizations={input?.organizations ?? [currentOrganization]}
			storageScope={storageScope}
		>
			<div>App content</div>
		</OnboardingEntryGate>
	);
}

async function expectOnboardingRedirect(to = "/o/acme/onboarding") {
	await waitFor(() => {
		expect(navigateMock).toHaveBeenCalledWith({
			replace: true,
			to,
		});
	});
}
