import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAppDefinition } from "./app-catalog";
import { OrganizationAppDetailPage } from "./organization-app-detail-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

vi.mock("./center-agent-github-connection-card", () => ({
	CenterAgentGitHubConnectionCard: ({
		canManage,
		isPersonalWorkspace,
		mode,
	}: {
		canManage: boolean;
		isPersonalWorkspace: boolean;
		mode: string;
	}) => (
		<div
			data-can-manage={String(canManage)}
			data-mode={mode}
			data-personal={String(isPersonalWorkspace)}
			data-testid="github-access"
		/>
	),
}));

vi.mock("./center-agent-app-connection-card", () => ({
	CenterAgentAppConnectionCard: ({
		isPersonalWorkspace,
	}: {
		isPersonalWorkspace: boolean;
	}) => (
		<div data-personal={String(isPersonalWorkspace)} data-testid="app-access" />
	),
}));

describe("OrganizationAppDetailPage", () => {
	afterEach(cleanup);

	it("keeps GitHub connection management on its own page", () => {
		const github = findAppDefinition("github");
		expect(github).not.toBeNull();
		if (!github) {
			return;
		}

		render(
			<OrganizationAppDetailPage
				app={github}
				canManageSharedApps
				connectionMode="all"
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationSlug="acme"
			/>
		);

		expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
		expect(
			screen.getByTestId("github-access").getAttribute("data-can-manage")
		).toBe("true");
		expect(
			screen.getByRole("link", { name: "All Apps" }).getAttribute("href")
		).toBe("/o/acme/center-agent/apps");
		const appSummary = screen.getByTestId("app-detail-summary");
		expect(appSummary.className).toContain("rounded-md");
		expect(appSummary.className).toContain("bg-card");
		const appAccess = screen.getByTestId("app-detail-access");
		expect(appAccess.className).toContain("rounded-md");
		expect(appAccess.className).toContain("bg-card");
	});

	it("shows connection controls for an available OAuth App", () => {
		const googleDrive = findAppDefinition("googledrive");
		expect(googleDrive).not.toBeNull();
		if (!googleDrive) {
			return;
		}

		render(
			<OrganizationAppDetailPage
				app={googleDrive}
				canManageSharedApps={false}
				connectionMode="all"
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationSlug="acme"
			/>
		);

		expect(screen.getByTestId("app-access")).toBeTruthy();
		expect(screen.queryByText("Available")).toBeNull();
		expect(
			screen.queryByText("Google Drive is planned and cannot be connected yet.")
		).toBeNull();
		expect(screen.queryByTestId("github-access")).toBeNull();
	});

	it("shows connection controls for an available credential App", () => {
		const figma = findAppDefinition("figma");
		expect(figma).not.toBeNull();
		if (!figma) {
			return;
		}

		render(
			<OrganizationAppDetailPage
				app={figma}
				canManageSharedApps
				connectionMode="all"
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationSlug="acme"
			/>
		);

		expect(screen.getByTestId("app-access")).toBeTruthy();
		expect(
			screen.queryByText("Figma is planned and cannot be connected yet.")
		).toBeNull();
	});

	it("uses workspace language for App access in a personal workspace", () => {
		const googleDrive = findAppDefinition("googledrive");
		expect(googleDrive).not.toBeNull();
		if (!googleDrive) {
			return;
		}

		render(
			<OrganizationAppDetailPage
				app={googleDrive}
				canManageSharedApps
				connectionMode="all"
				isPersonalWorkspace
				organizationId="org-personal"
				organizationSlug="felix"
			/>
		);

		expect(
			screen.getByText(
				"Your connection stays private to your requests. Workspace access is available to your Center Agent and Routines."
			)
		).toBeTruthy();
		expect(screen.getByTestId("app-access").getAttribute("data-personal")).toBe(
			"true"
		);
	});
});
