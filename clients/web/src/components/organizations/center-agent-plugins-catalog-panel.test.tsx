import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationPluginConnectionQueryKeys } from "#/query/organizations/plugin-connections";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentPluginsCatalogPanel } from "./center-agent-plugins-catalog-panel";
import { PLUGINS } from "./plugin-catalog";

const GITHUB_LINK_NAME = /GitHub/;
const GOOGLE_DRIVE_LINK_NAME = /Google Drive/;
const GMAIL_LINK_NAME = /Gmail/;
const FIGMA_LINK_NAME = /Figma/;
const NOTION_LINK_NAME = /Notion/;
const SLACK_LINK_NAME = /Slack/;
const TEAMS_LINK_NAME = /Microsoft Teams/;
const TRANSIENT_STATUS_COPY = /checking|updating/i;
const listAppConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...props
	}: {
		children: ReactNode;
		to: string;
		[key: string]: unknown;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/connector-connections", () => ({
	listCurrentOrganizationAppConnections: listAppConnectionsMock,
}));

describe("CenterAgentPluginsCatalogPanel", () => {
	beforeEach(() => {
		listAppConnectionsMock.mockReset().mockResolvedValue({
			connections: [activeConnection("github"), activeConnection("notion")],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
	});

	afterEach(cleanup);

	it("links every Plugin to its own detail route", () => {
		renderCatalog();

		expect(screen.getAllByRole("link")).toHaveLength(PLUGINS.length);
		expect(
			screen.getByRole("link", { name: GITHUB_LINK_NAME }).getAttribute("href")
		).toBe("/o/acme/center-agent/plugins/github");
		expect(screen.getByTestId("app-logo-googledrive").getAttribute("src")).toBe(
			"/app-logos/google-drive.svg"
		);
		expect(screen.queryByRole("link", { name: SLACK_LINK_NAME })).toBeNull();
		expect(screen.queryByRole("link", { name: TEAMS_LINK_NAME })).toBeNull();
		expect(screen.queryByText("Details")).toBeNull();
	});

	it("flattens the Catalog controls and gives every Plugin its own Card", () => {
		renderCatalog();

		const catalog = screen.getByRole("region", { name: "Plugin catalog" });
		const controls = screen.getByRole("group", { name: "Browse Plugins" });
		expect(
			screen.queryByRole("heading", { name: "Plugin catalog" })
		).toBeNull();
		expect(
			screen.queryByText("Choose an Plugin to review or manage its access.")
		).toBeNull();
		expect(within(controls).getByRole("button", { name: "All" })).toBeTruthy();
		expect(within(controls).getByLabelText("Search Plugins")).toBeTruthy();
		for (const appLink of screen.getAllByRole("link")) {
			expect(appLink.closest('[data-slot="card"]')).toBeTruthy();
			expect(appLink.closest("[data-fluid-card-item]")).toBeTruthy();
		}
		expect(catalog.matches('[data-slot="card"]')).toBe(false);
	});

	it("preserves Plugin identity while progressively disclosing phone card chrome", () => {
		renderCatalog();

		const githubLink = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		const status = githubLink.querySelector(
			'[data-slot="plugin-catalog-card-status"]'
		);
		const arrow = githubLink.querySelector(
			'[data-slot="plugin-catalog-card-arrow"]'
		);

		expect(status?.className).toContain("w-auto");
		expect(status?.className).toContain("sm:w-20");
		expect(arrow?.getAttribute("class")).toContain("hidden");
		expect(arrow?.getAttribute("class")).toContain("sm:block");
	});

	it("keeps Plugin navigation inert and uses silent shimmer while connection status is unknown", () => {
		listAppConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));

		renderCatalog();

		const catalog = screen.getByRole("region", { name: "Plugin catalog" });
		const githubLink = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		expect(catalog.getAttribute("aria-busy")).toBe("true");
		expect(githubLink.getAttribute("aria-disabled")).toBe("true");
		expect(githubLink.getAttribute("tabindex")).toBe("-1");
		expect(
			within(githubLink).getByTestId("plugin-connection-status-skeleton")
		).toBeTruthy();
		expect(screen.queryByText(TRANSIENT_STATUS_COPY)).toBeNull();
	});

	it("shows a restored connected-service summary while the Catalog refreshes", () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationPluginConnectionQueryKeys.statusSummary("org-acme"),
			{
				connectedServices: ["github"],
				organizationId: "org-acme",
			}
		);
		listAppConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));

		renderCatalog(queryClient);

		const catalog = screen.getByRole("region", { name: "Plugin catalog" });
		const githubLink = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		expect(catalog.getAttribute("aria-busy")).toBe("false");
		expect(githubLink.hasAttribute("aria-disabled")).toBe(false);
		expect(within(githubLink).getByText("Connected")).toBeTruthy();
		expect(
			within(githubLink).queryByTestId("plugin-connection-status-skeleton")
		).toBeNull();
	});

	it("shows Connected only for real Plugin connections", async () => {
		renderCatalog();

		const githubLink = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		expect(await within(githubLink).findByText("Connected")).toBeTruthy();
		expect(screen.queryByText("Available")).toBeNull();
		expect(
			within(
				screen.getByRole("link", { name: GOOGLE_DRIVE_LINK_NAME })
			).queryByText("Connected")
		).toBeNull();
		expect(
			within(screen.getByRole("link", { name: NOTION_LINK_NAME })).getByText(
				"Connected"
			)
		).toBeTruthy();
		expect(
			within(screen.getByRole("link", { name: FIGMA_LINK_NAME })).queryByText(
				"Connected"
			)
		).toBeNull();
		expect(screen.queryByText("Planned")).toBeNull();
		expect(listAppConnectionsMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
			signal: expect.any(AbortSignal),
		});
	});

	it("filters Plugins by search and category", () => {
		renderCatalog();

		fireEvent.change(screen.getByLabelText("Search Plugins"), {
			target: { value: "gmail" },
		});
		expect(screen.getAllByRole("link")).toHaveLength(1);
		expect(screen.getByRole("link", { name: GMAIL_LINK_NAME })).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Search Plugins"), {
			target: { value: "" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Communication" }));
		expect(screen.getAllByRole("link")).toHaveLength(1);
		expect(screen.getByRole("link", { name: GMAIL_LINK_NAME })).toBeTruthy();
		expect(screen.queryByRole("link", { name: SLACK_LINK_NAME })).toBeNull();
		expect(screen.queryByRole("link", { name: NOTION_LINK_NAME })).toBeNull();
	});

	it("makes a connection lookup failure explicit", async () => {
		listAppConnectionsMock.mockRejectedValue(
			new Error("connection lookup failed")
		);

		renderCatalog();

		expect(
			await screen.findByText(
				"OpenMeld could not load Plugin connection status."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByText("Connected")).toBeNull();
		expect(screen.queryByText("Available")).toBeNull();
	});
});

function renderCatalog(queryClient = createTestQueryClient()) {
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<CenterAgentPluginsCatalogPanel
				organizationId="org-acme"
				organizationSlug="acme"
			/>
		</TestQueryClientProvider>
	);
}

function activeConnection(service: "github" | "notion") {
	return {
		canDisconnect: true,
		connectionName: `org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__${service}`,
		createdAtMs: 1,
		disconnectedAtMs: null,
		organizationId: "org-acme",
		ownerDisplayName: "Felix",
		scope: "member",
		service,
		status: "active",
		updatedAtMs: 1,
		userId: "user-1",
	};
}
