import type { AuthProfileView } from "@openmeld/schemas/types";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { TestQueryClientProvider } from "#/test-support/query-client";

const {
	appOrganizationMock,
	appSpaceShellMock,
	listOrganizationSpacesMock,
	listStartProfilesMock,
	spaceWindowShellMock,
	welcomeFirstRunMock,
} = vi.hoisted(() => ({
	appOrganizationMock: {
		currentOrganization: {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		} as OrganizationSummary,
	},
	appSpaceShellMock: vi.fn(
		(input: {
			children: ReactNode;
			currentProfileId: string;
			currentSpaceId: string;
			showSpacesSidebar?: boolean;
		}) => (
			<section
				data-show-spaces-sidebar={String(input.showSpacesSidebar ?? true)}
				data-testid="app-space-shell"
			>
				{input.children}
			</section>
		)
	),
	listOrganizationSpacesMock: vi.fn(),
	listStartProfilesMock: vi.fn(),
	spaceWindowShellMock: vi.fn((input: { children: ReactNode }) => (
		<section data-testid="space-window-shell">{input.children}</section>
	)),
	welcomeFirstRunMock: vi.fn(() => <div data-testid="new-space-view" />),
}));

vi.mock("#/components/spaces/app-space-shell", () => ({
	AppSpaceShell: appSpaceShellMock,
	SpaceWindowShell: spaceWindowShellMock,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
	};
});

vi.mock("#/components/welcome/welcome-first-run", () => ({
	WelcomeFirstRun: welcomeFirstRunMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => appOrganizationMock,
}));

vi.mock("#/lib/organizations/organization-spaces", () => ({
	listCurrentOrganizationSpaces: () => listOrganizationSpacesMock(),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: () => listStartProfilesMock(),
}));

import { AppNewSpaceContent } from "./new-space";

describe("new Space route", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		appOrganizationMock.currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		appSpaceShellMock.mockClear();
		spaceWindowShellMock.mockClear();
		welcomeFirstRunMock.mockClear();
		listStartProfilesMock.mockReset().mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock
			.mockReset()
			.mockResolvedValue(createOrganizationSpacesResponse({ spaces: [] }));
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("keeps the inner Spaces sidebar hidden for a new account with no Spaces", async () => {
		renderNewSpace();

		expect(await screen.findByTestId("new-space-view")).toBeTruthy();
		await waitFor(() => {
			expect(appSpaceShellMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					currentProfileId: "selected-human",
					currentSpaceId: "",
					showSpacesSidebar: false,
				}),
				undefined
			);
		});
		expect(welcomeFirstRunMock).toHaveBeenLastCalledWith(
			{ showBack: false },
			undefined
		);

		const backLink = screen.getByRole("link", { name: "Back to Spaces" });
		expect(backLink.getAttribute("href")).toBe("/o/acme/spaces");
		const header = document.querySelector(
			'[data-slot="app-main-content-header"]'
		);
		expect(header?.className).toContain("border-b-0");
		expect(header?.classList.contains("border-b")).toBe(false);
		const body = document.querySelector('[data-slot="app-main-content-body"]');
		expect(
			body?.querySelector('[data-slot="scroll-area-viewport"]')
		).not.toBeNull();
	});

	it("shows the inner Spaces sidebar when the current organization has Spaces", async () => {
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({
				spaces: [
					{
						joined: true,
						name: "Planning",
						spaceId: "space-planning",
						visibility: "public",
					},
				],
			})
		);

		renderNewSpace();

		expect(await screen.findByTestId("new-space-view")).toBeTruthy();
		await waitFor(() => {
			expect(appSpaceShellMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					showSpacesSidebar: true,
				}),
				undefined
			);
		});
		expect(welcomeFirstRunMock).toHaveBeenLastCalledWith(
			{ showBack: false },
			undefined
		);
		expect(
			screen.getByRole("link", { name: "Back to Spaces" }).getAttribute("href")
		).toBe("/o/acme/spaces");
		expect(
			document
				.querySelector('[data-slot="app-main-content-header"]')
				?.classList.contains("border-b")
		).toBe(true);
	});
});

function renderNewSpace() {
	return render(
		<TestQueryClientProvider>
			<StartFlowStateProvider storageScope="user-123">
				<AppNewSpaceContent />
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

function createProfile(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		openMeldProfileId: overrides.openMeldProfileId ?? "human-profile",
		createdAt: overrides.createdAt ?? "2026-04-19T00:00:00.000Z",
		createdByUserId: overrides.createdByUserId ?? "user-123",
		creatorProfileId: overrides.creatorProfileId ?? null,
		isDefault: overrides.isDefault ?? false,
		lastUsedAt: overrides.lastUsedAt ?? null,
		managedRole: overrides.managedRole ?? null,
		ownerUserId: overrides.ownerUserId ?? "user-123",
		profileHandle: overrides.profileHandle ?? "human",
		profileKind: overrides.profileKind ?? "human",
		profileName: overrides.profileName ?? "Human",
		source: overrides.source ?? "auth_bootstrap",
		status: overrides.status ?? "active",
		updatedAt: overrides.updatedAt ?? "2026-04-19T00:00:00.000Z",
	};
}

function createOrganizationSpacesResponse(input?: {
	spaces?: readonly {
		joined: boolean;
		name: string;
		spaceId: string;
		visibility: "private" | "public";
	}[];
}) {
	return {
		generatedAt: "2026-07-08T00:00:00.000Z",
		organizationId: "org-acme",
		spaces: input?.spaces ?? [],
	};
}
