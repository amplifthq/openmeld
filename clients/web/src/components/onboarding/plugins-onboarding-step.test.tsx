import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { PluginsOnboardingStep } from "./plugins-onboarding-step";

const REQUESTED_SALESFORCE_BUTTON_NAME = /Requested “Salesforce”/u;

const api = vi.hoisted(() => ({
	createRequest: vi.fn(),
	listCatalog: vi.fn(),
	listConnections: vi.fn(),
	listRequests: vi.fn(),
}));
const githubCardProps = vi.hoisted(() => vi.fn());

vi.mock(
	"#/components/organizations/center-agent-github-connection-card",
	() => ({
		CenterAgentGitHubConnectionCard: (props: Record<string, unknown>) => {
			githubCardProps(props);
			return <div data-testid="github-onboarding-connection-card" />;
		},
	})
);

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
		currentUserId: "user-1",
	}),
}));

vi.mock("#/lib/organizations/connector-connections", () => ({
	createCurrentOrganizationConnectorAppRequest: api.createRequest,
}));

vi.mock("#/query/organizations/plugin-connections", () => ({
	organizationPluginConnectionQueryKeys: {
		catalog: (organizationId: string) => [
			"connector-connections",
			organizationId,
			"catalog",
		],
		requests: (organizationId: string) => [
			"connector-connections",
			organizationId,
			"requests",
		],
	},
	organizationPluginConnectionCatalogQueryOptions: () => ({
		queryFn: api.listConnections,
		queryKey: ["connector-connections", "org-acme", "catalog"],
	}),
	organizationPluginProviderCatalogQueryOptions: () => ({
		queryFn: api.listCatalog,
		queryKey: ["connector-connections", "org-acme", "providers"],
	}),
	organizationPluginRequestsQueryOptions: () => ({
		queryFn: api.listRequests,
		queryKey: ["connector-connections", "org-acme", "requests"],
	}),
}));

vi.mock("#/query/organizations/organization-directory", () => ({
	organizationMemberRoleQueryOptions: () => ({
		queryFn: async () => "owner",
		queryKey: ["organization", "org-acme", "role", "user-1"],
	}),
}));

describe("PluginsOnboardingStep", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("shows an active Organization Plugin connection on the catalog card", async () => {
		api.listCatalog.mockResolvedValue({
			organizationId: "org-acme",
			providers: [
				{
					authTypes: ["oauth"],
					categories: [
						{ displayName: "Developer tools", id: "developer-tools" },
					],
					displayName: "GitHub",
					homepageUrl: "https://github.com",
					iconUrl: null,
					service: "github",
				},
			],
		});
		api.listConnections.mockResolvedValue({
			connections: [
				{
					canDisconnect: true,
					connectionName: "github-organization",
					createdAtMs: 1,
					disconnectedAtMs: null,
					organizationId: "org-acme",
					ownerDisplayName: "Felix",
					scope: "shared",
					service: "github",
					status: "active",
					updatedAtMs: 1,
					userId: "user-1",
				},
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		api.listRequests.mockResolvedValue({
			currentUserId: "user-1",
			organizationId: "org-acme",
			requests: [],
		});

		render(
			<TestQueryClientProvider>
				<PluginsOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		const connectedLabel = await screen.findByText("Connected");
		const providerButton = connectedLabel.closest("button");
		expect(providerButton?.textContent).toContain("GitHub");
		expect(providerButton?.closest('[data-slot="card"]')).toBeTruthy();
		fireEvent.click(providerButton as HTMLButtonElement);
		expect(
			await screen.findByTestId("github-onboarding-connection-card")
		).toBeTruthy();
		expect(githubCardProps).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "all",
				organizationId: "org-acme",
				presentation: "onboarding",
			})
		);
	});

	it("shows a persisted freeform Plugin request before reopening its details", async () => {
		api.listCatalog.mockResolvedValue({
			organizationId: "org-acme",
			providers: [],
		});
		api.listConnections.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		api.listRequests.mockResolvedValue({
			currentUserId: "user-1",
			organizationId: "org-acme",
			requests: [
				{
					availableAtMs: null,
					createdAtMs: 1,
					id: "request-salesforce",
					notifiedAtMs: null,
					organizationId: "org-acme",
					providerId: null,
					providerName: "Salesforce",
					requestedCapabilities: [],
					requesterMemberId: "member-1",
					requesterUserId: "user-1",
					source: "freeform",
					status: "requested",
					updatedAtMs: 1,
					useCase: null,
				},
			],
		});

		render(
			<TestQueryClientProvider>
				<PluginsOnboardingStep onContinue={vi.fn()} />
			</TestQueryClientProvider>
		);

		fireEvent.change(
			await screen.findByPlaceholderText("Search GitHub, Notion, Salesforce…"),
			{ target: { value: "Salesforce" } }
		);

		expect(
			await screen.findByRole("button", {
				name: REQUESTED_SALESFORCE_BUTTON_NAME,
			})
		).toBeTruthy();
	});
});
