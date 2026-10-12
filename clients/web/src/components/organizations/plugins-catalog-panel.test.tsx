import { PLUGINS } from "@openmeld/product-catalog/plugins";
import { connectorAppCatalogProviderSchema } from "@openmeld/schemas";
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
import capturedExpansionProviders from "../../../../../packages/product-catalog/test-support/openconnector-expansion-providers.json";
import capturedProviders from "../../../../../packages/product-catalog/test-support/openconnector-providers.json";
import { PluginsCatalogPanel } from "./plugins-catalog-panel";

const GITHUB_LINK_NAME = /GitHub/;
const CANVA_LINK_NAME = /Canva/;
const GOOGLE_DRIVE_LINK_NAME = /Google Drive/;
const GOOGLE_SHEETS_LINK_NAME = /Google Sheets/;
const GMAIL_LINK_NAME = /Gmail/;
const FIGMA_LINK_NAME = /Figma/;
const NOTION_LINK_NAME = /Notion/;
const SLACK_LINK_NAME = /Slack/;
const TEAMS_LINK_NAME = /Microsoft Teams/;
const TRANSIENT_STATUS_COPY = /checking|updating/i;
const listAppConnectionsMock = vi.hoisted(() => vi.fn());
const listProvidersMock = vi.hoisted(() => vi.fn());
const scopeState = vi.hoisted(() => ({
	value: "personal" as "personal" | "organization",
}));
vi.mock("./plugin-scope-tabs", () => ({
	PluginScopeTabs: () => null,
	usePluginScope: () => scopeState.value,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		search,
		...props
	}: {
		children: ReactNode;
		to: string;
		search?: { scope?: string };
		[key: string]: unknown;
	}) => (
		<a href={search?.scope ? `${to}?scope=${search.scope}` : to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/connector-connections", () => ({
	listCurrentOrganizationAppConnections: listAppConnectionsMock,
	listCurrentOrganizationConnectorAppCatalog: listProvidersMock,
}));

describe("PluginsCatalogPanel", () => {
	beforeEach(() => {
		scopeState.value = "personal";
		listAppConnectionsMock.mockReset().mockResolvedValue({
			connections: [activeConnection("github"), activeConnection("notion")],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		listProvidersMock.mockReset();
	});

	afterEach(cleanup);

	it("links selected Plugins to their detail routes without exposing the upstream directory", () => {
		renderCatalog();

		expect(screen.getAllByRole("link")).toHaveLength(PLUGINS.length);
		expect(
			screen.getByRole("link", { name: GITHUB_LINK_NAME }).getAttribute("href")
		).toBe("/o/acme/plugins/github?scope=personal");
		expect(screen.getByTestId("app-logo-googledrive").getAttribute("src")).toBe(
			"/app-logos/google-drive.svg"
		);
		expect(
			screen.getByRole("link", { name: SLACK_LINK_NAME }).getAttribute("href")
		).toBe("/o/acme/plugins/slack?scope=personal");
		expect(
			screen.getByRole("link", { name: TEAMS_LINK_NAME }).getAttribute("href")
		).toBe("/o/acme/plugins/microsoft_teams?scope=personal");
		expect(screen.queryByText("Details")).toBeNull();
		expect(screen.queryByText("17TRACK")).toBeNull();
	});

	it("keeps personal mail, calendars, and meetings out of the organization catalog and retains a cleanup link for older shared connections", async () => {
		scopeState.value = "organization";
		listAppConnectionsMock.mockResolvedValue({
			connections: [
				{ ...activeConnection("gmail"), scope: "shared", canDisconnect: true },
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		renderCatalog();
		expect(screen.queryByTestId("app-logo-gmail")).toBeNull();
		expect(screen.queryByTestId("app-logo-outlook")).toBeNull();
		expect(screen.queryByTestId("app-logo-googlecalendar")).toBeNull();
		expect(screen.queryByTestId("app-logo-googlemeet")).toBeNull();
		expect(screen.queryByTestId("app-logo-outlook_calendar")).toBeNull();
		expect(screen.queryByTestId("app-logo-zoom")).toBeNull();
		expect(
			screen.getByRole("link", { name: TEAMS_LINK_NAME }).getAttribute("href")
		).toBe("/o/acme/plugins/microsoft_teams?scope=organization");
		expect(
			screen.getByRole("link", { name: GOOGLE_SHEETS_LINK_NAME })
		).toBeTruthy();
		expect(
			(await screen.findByRole("link", { name: "Review Gmail" })).getAttribute(
				"href"
			)
		).toBe("/o/acme/plugins/gmail?scope=organization");
	});

	it("keeps Plugin navigation available while connection status loads", () => {
		listAppConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));

		renderCatalog();

		const catalog = screen.getByRole("region", { name: "Plugin catalog" });
		const githubLink = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		expect(catalog.getAttribute("aria-busy")).toBe("true");
		expect(githubLink.hasAttribute("aria-disabled")).toBe(false);
		expect(githubLink.getAttribute("tabindex")).toBeNull();
		expect(
			within(githubLink).getByTestId("plugin-connection-status-skeleton")
		).toBeTruthy();
		expect(screen.queryByText(TRANSIENT_STATUS_COPY)).toBeNull();
	});

	it("does not apply a legacy unscoped connection summary to personal accounts", () => {
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
		expect(catalog.getAttribute("aria-busy")).toBe("true");
		expect(githubLink.hasAttribute("aria-disabled")).toBe(false);
		expect(within(githubLink).queryByText("Connected")).toBeNull();
		expect(
			within(githubLink).queryByTestId("plugin-connection-status-skeleton")
		).toBeTruthy();
	});

	it.each([
		"personal",
		"organization",
	] as const)("shows only %s connections in the selected scope", async (scope) => {
		scopeState.value = scope;
		listAppConnectionsMock.mockResolvedValue({
			connections: [
				activeConnection("github"),
				{ ...activeConnection("notion"), scope: "shared" },
				{
					...activeConnection("github"),
					service: "figma",
					userId: "another-member",
				},
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		renderCatalog();
		const own = screen.getByRole("link", { name: GITHUB_LINK_NAME });
		const shared = screen.getByRole("link", { name: NOTION_LINK_NAME });
		expect(
			await within(scope === "personal" ? own : shared).findByText("Connected")
		).toBeTruthy();
		expect(
			within(scope === "personal" ? shared : own).queryByText("Connected")
		).toBeNull();
		expect(
			within(screen.getByRole("link", { name: FIGMA_LINK_NAME })).queryByText(
				"Connected"
			)
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
		fireEvent.click(
			screen.getByRole("button", { name: "View all Communication Plugins" })
		);
		expect(
			screen
				.getAllByRole("link")
				.map((link) => within(link).getByRole("heading").textContent)
				.sort()
		).toEqual([
			"Discord Bot",
			"Gmail",
			"Intercom",
			"Microsoft Teams",
			"Outlook",
			"Resend",
			"Slack",
			"Zendesk",
		]);
		expect(screen.getByRole("link", { name: GMAIL_LINK_NAME })).toBeTruthy();
		expect(screen.getByRole("link", { name: SLACK_LINK_NAME })).toBeTruthy();
		expect(screen.queryByRole("link", { name: NOTION_LINK_NAME })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "All Plugins" }));
		expect(screen.getAllByRole("link")).toHaveLength(PLUGINS.length);
		fireEvent.click(
			screen.getByRole("button", { name: "View all Productivity Plugins" })
		);
		expect(screen.getByRole("link", { name: CANVA_LINK_NAME })).toBeTruthy();
		expect(screen.queryByRole("link", { name: GITHUB_LINK_NAME })).toBeNull();
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
		fireEvent.click(screen.getByLabelText("Show connected Plugins"));
		expect(screen.queryByText("No Plugins found")).toBeNull();
	});

	it("renders known connections while the provider catalog is still pending", async () => {
		let releaseProviders!: (value: { providers: unknown[] }) => void;
		listProvidersMock.mockReturnValue(
			new Promise((resolve) => {
				releaseProviders = resolve;
			})
		);
		renderCatalog(createTestQueryClient(), false);
		expect(screen.getByLabelText("Loading Plugins")).toBeTruthy();
		expect(
			await screen.findByRole("link", { name: GITHUB_LINK_NAME })
		).toBeTruthy();
		expect(screen.getByLabelText("Loading Plugins")).toBeTruthy();
		releaseProviders({ providers: capturedProviders.data });
		expect(
			await screen.findByRole("link", { name: GOOGLE_DRIVE_LINK_NAME })
		).toBeTruthy();
		expect(screen.queryByLabelText("Loading Plugins")).toBeNull();
	});

	it("filters only the current member's connections, including those needing reconnection", async () => {
		listAppConnectionsMock.mockResolvedValue({
			connections: [
				{
					...activeConnection("github"),
					health: { state: "reconnect_required" },
				},
				{ ...activeConnection("notion"), userId: "another-user" },
				{ ...activeConnection("gmail"), scope: "shared" },
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		renderCatalog();
		await screen.findByText("Reconnect required");
		const filter = screen.getByLabelText("Show connected Plugins");
		fireEvent.click(filter);
		expect(filter.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getAllByRole("link")).toHaveLength(1);
		expect(screen.getByRole("link", { name: GITHUB_LINK_NAME })).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Search Plugins"), {
			target: { value: "notion" },
		});
		expect(screen.queryByRole("link")).toBeNull();
		fireEvent.click(screen.getByText("Clear filters"));
		expect(filter.getAttribute("aria-pressed")).toBe("false");
		expect(screen.getAllByRole("link")).toHaveLength(PLUGINS.length);
	});

	it("keeps a filtered cold load pending rather than claiming no connections", () => {
		listAppConnectionsMock.mockReturnValue(new Promise(() => undefined));
		renderCatalog();
		fireEvent.click(screen.getByLabelText("Show connected Plugins"));
		expect(screen.getByLabelText("Loading Plugins")).toBeTruthy();
		expect(screen.queryByText("No Plugins found")).toBeNull();
		fireEvent.click(screen.getByLabelText("Show connected Plugins"));
		expect(screen.getByRole("link", { name: GITHUB_LINK_NAME })).toBeTruthy();
	});
});

function renderCatalog(
	queryClient = createTestQueryClient(),
	seedProviders = true
) {
	// Captured vendor contract; these layout cases model configured OAuth clients.
	if (
		seedProviders &&
		!queryClient.getQueryData(
			organizationPluginConnectionQueryKeys.providers("org-acme")
		)
	) {
		queryClient.setQueryData(
			organizationPluginConnectionQueryKeys.providers("org-acme"),
			{
				providers: [
					...capturedProviders.data,
					...capturedExpansionProviders.data,
					{
						...capturedExpansionProviders.data[0],
						service: "17track",
						displayName: "17TRACK",
						iconUrl: null,
					},
				].map((item) => {
					const provider = connectorAppCatalogProviderSchema
						.strip()
						.parse(item);
					return {
						...provider,
						connectionAuth: {
							...provider.connectionAuth,
							oauth: true,
							credentials: provider.connectionAuth?.credentials ?? [],
						},
					};
				}),
			}
		);
	}
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<PluginsCatalogPanel
				organizationId="org-acme"
				organizationName="Acme"
				organizationSlug="acme"
			/>
		</TestQueryClientProvider>
	);
}

function activeConnection(service: "github" | "notion" | "gmail") {
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
