import { findPluginDefinition } from "@openmeld/product-catalog/plugins";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationPluginDetailPage } from "./organization-plugin-detail-page";
import type { PluginDetailLayout } from "./plugin-detail-connection";

vi.mock("./plugin-agent-access", () => ({ PluginAgentAccess: () => null }));
vi.mock("./plugin-scope-tabs", () => ({
	PluginScopeTabs: () => null,
	usePluginScope: () => "personal",
}));

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
		renderDetail,
	}: {
		canManage: boolean;
		isPersonalWorkspace: boolean;
		mode: string;
		renderDetail: PluginDetailLayout;
	}) =>
		renderDetail(
			null,
			<div
				data-can-manage={String(canManage)}
				data-mode={mode}
				data-personal={String(isPersonalWorkspace)}
				data-testid="github-access"
			/>
		),
}));

vi.mock("./plugin-connection-card", () => ({
	PluginConnectionCard: ({
		isPersonalWorkspace,
		renderDetail,
	}: {
		isPersonalWorkspace: boolean;
		renderDetail: PluginDetailLayout;
	}) =>
		renderDetail(
			null,
			<div
				data-personal={String(isPersonalWorkspace)}
				data-testid="plugin-access"
			/>
		),
}));

describe("OrganizationPluginDetailPage", () => {
	afterEach(cleanup);

	it("shows known identity and navigation without enabling setup before catalog readiness", () => {
		const github = findPluginDefinition("github");
		if (!github) {
			throw new Error("Missing GitHub fixture");
		}
		render(
			<OrganizationPluginDetailPage
				canManageSharedPlugins={false}
				catalogPending
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationName="Acme"
				organizationSlug="acme"
				plugin={github}
			/>
		);
		expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "All Plugins" })).toBeTruthy();
		expect(screen.getByLabelText("Loading Plugin settings")).toBeTruthy();
		expect(screen.queryByTestId("github-access")).toBeNull();
		expect(screen.queryByTestId("plugin-access")).toBeNull();
		expect(screen.queryByText("Sign-in unavailable")).toBeNull();
	});

	it("keeps GitHub connection management on its own page", () => {
		const github = findPluginDefinition("github");
		expect(github).not.toBeNull();
		if (!github) {
			return;
		}

		render(
			<OrganizationPluginDetailPage
				canManageSharedPlugins
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationName="Acme"
				organizationSlug="acme"
				plugin={github}
			/>
		);

		expect(screen.getByRole("heading", { name: "GitHub" })).toBeTruthy();
		expect(
			screen.getByTestId("github-access").getAttribute("data-can-manage")
		).toBe("true");
		expect(
			screen.getByRole("link", { name: "All Plugins" }).getAttribute("href")
		).toBe("/o/acme/plugins");
		expect(screen.getByTestId("github-access").getAttribute("data-mode")).toBe(
			"member"
		);
	});

	it("shows connection controls for an available OAuth App", () => {
		const googleDrive = findPluginDefinition("googledrive");
		expect(googleDrive).not.toBeNull();
		if (!googleDrive) {
			return;
		}

		render(
			<OrganizationPluginDetailPage
				canManageSharedPlugins={false}
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationName="Acme"
				organizationSlug="acme"
				plugin={googleDrive}
			/>
		);

		expect(screen.getByTestId("plugin-access")).toBeTruthy();
		expect(screen.queryByText("Available")).toBeNull();
		expect(
			screen.queryByText("Google Drive is planned and cannot be connected yet.")
		).toBeNull();
		expect(screen.queryByTestId("github-access")).toBeNull();
	});

	it("shows connection controls for an available credential Plugin", () => {
		const figma = findPluginDefinition("figma");
		expect(figma).not.toBeNull();
		if (!figma) {
			return;
		}

		render(
			<OrganizationPluginDetailPage
				canManageSharedPlugins
				isPersonalWorkspace={false}
				organizationId="org-acme"
				organizationName="Acme"
				organizationSlug="acme"
				plugin={figma}
			/>
		);

		expect(screen.getByTestId("plugin-access")).toBeTruthy();
		expect(
			screen.queryByText("Figma is planned and cannot be connected yet.")
		).toBeNull();
	});

	it("uses workspace language for Plugin access in a personal workspace", () => {
		const googleDrive = findPluginDefinition("googledrive");
		expect(googleDrive).not.toBeNull();
		if (!googleDrive) {
			return;
		}

		render(
			<OrganizationPluginDetailPage
				canManageSharedPlugins
				isPersonalWorkspace
				organizationId="org-personal"
				organizationName="Felix"
				organizationSlug="felix"
				plugin={googleDrive}
			/>
		);

		expect(
			screen.getByTestId("plugin-access").getAttribute("data-personal")
		).toBe("true");
	});
});
