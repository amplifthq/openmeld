import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { messageChannelQueryKeys } from "#/query/organizations/message-channels";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationMessageChannelsPage } from "./organization-message-channels-page";
import { OrganizationPluginsPage } from "./organization-plugins-page";

const getActiveOrganizationMemberRoleMock = vi.hoisted(() => vi.fn());
const readCurrentCenterAgentDesignationMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationMessageChannelsMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationLarkPlatformRegistrationsMock = vi.hoisted(() =>
	vi.fn()
);

let currentOrganization: OrganizationSummary = {
	id: "org-acme",
	name: "Acme",
	slug: "acme",
};
let pluginsSelectedService: string | null = null;
const CONNECT_ACTION_NAME = /Connect/;
const REPAIR_ACTION_NAME = /Repair/;

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		search,
		to,
		...props
	}: {
		children: ReactNode;
		search?: Record<string, string | undefined>;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(search ?? {})) {
			if (value) {
				params.set(key, value);
			}
		}
		const query = params.toString();
		return (
			<a href={query ? `${to}?${query}` : to} {...props}>
				{children}
			</a>
		);
	},
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getActiveOrganizationMemberRole: getActiveOrganizationMemberRoleMock,
}));

vi.mock("#/query/organizations/organization-directory", async () => {
	const actual = await vi.importActual<
		typeof import("#/query/organizations/organization-directory")
	>("#/query/organizations/organization-directory");
	return {
		...actual,
		organizationMemberRoleQueryOptions: (input: {
			enabled: boolean;
			organizationId: string;
			userId: string;
		}) => ({
			enabled: input.enabled,
			queryFn: () => getActiveOrganizationMemberRoleMock(),
			queryKey: actual.organizationQueryKeys.role(
				input.organizationId,
				input.userId
			),
			retry: false,
			staleTime: 60_000,
		}),
	};
});

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		connectCurrentCenterAgentSlackWorkspace: vi.fn(),
		disconnectCurrentCenterAgentSlackWorkspace: vi.fn(),
		readCurrentCenterAgentDesignation: readCurrentCenterAgentDesignationMock,
	};
});

vi.mock("#/lib/organizations/message-channels", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/message-channels")
	>("#/lib/organizations/message-channels");
	return {
		...actual,
		beginCurrentOrganizationLarkPlatformRegistration: vi.fn(),
		disconnectCurrentOrganizationLarkPlatform: vi.fn(),
		listCurrentOrganizationMessageChannels:
			listCurrentOrganizationMessageChannelsMock,
		listCurrentOrganizationLarkPlatformRegistrations:
			listCurrentOrganizationLarkPlatformRegistrationsMock,
		pollCurrentOrganizationLarkPlatformRegistration: vi.fn(),
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization,
		currentUserId: "user-123",
	}),
}));

vi.mock("./center-agent-route-state", () => ({
	useCenterAgentRouteState: () => ({ pluginsSelectedService }),
}));

vi.mock("./center-agent-github-connection-card", () => ({
	CenterAgentGitHubConnectionCard: ({
		canManage,
		mode,
	}: {
		canManage: boolean;
		mode: string;
	}) => (
		<div
			data-can-manage={String(canManage)}
			data-mode={mode}
			data-testid="github-access"
		/>
	),
}));

vi.mock("./center-agent-plugins-catalog-panel", () => ({
	CenterAgentPluginsCatalogPanel: ({
		organizationSlug,
	}: {
		organizationSlug: string;
	}) => (
		<div data-organization-slug={organizationSlug} data-testid="apps-catalog" />
	),
}));

vi.mock("./organization-plugin-detail-page", () => ({
	OrganizationPluginDetailPage: ({
		canManageSharedPlugins,
		permissionNotice,
	}: {
		canManageSharedPlugins: boolean;
		permissionNotice?: ReactNode;
	}) => (
		<div
			data-can-manage={String(canManageSharedPlugins)}
			data-testid="app-detail"
		>
			{permissionNotice}
		</div>
	),
	OrganizationPluginNotFoundPage: () => <div data-testid="app-not-found" />,
}));

describe("organization access management pages", () => {
	beforeEach(() => {
		currentOrganization = { id: "org-acme", name: "Acme", slug: "acme" };
		pluginsSelectedService = null;
		getActiveOrganizationMemberRoleMock.mockReset().mockResolvedValue("owner");
		readCurrentCenterAgentDesignationMock.mockReset().mockResolvedValue({
			designation: null,
			organizationId: "org-acme",
			remoteRuntimeAvailability: { selectable: true },
			slackConnection: {
				connected: true,
				slackTeamId: "T123",
				workspaceName: "Acme HQ",
			},
		});
		listCurrentOrganizationMessageChannelsMock
			.mockReset()
			.mockImplementation(async () => ({
				availableLarkPlatformProviders: ["lark"],
				connections: [
					{
						externalAccountId: "T123",
						externalAccountName: "Acme HQ",
						grantedCapabilityGroups: [],
						id: "slack:T123",
						lastVerifiedAt: null,
						permissionBundleVersion: null,
						provider: "slack",
						reasonCode: null,
						status: "connected",
						transport: "webhook",
					},
				],
				organizationId: currentOrganization.id,
			}));
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockImplementation(async () => ({
				organizationId: currentOrganization.id,
				registrations: [],
			}));
	});

	afterEach(cleanup);

	it.each([
		["owner", true],
		["admin", true],
		["member", false],
	])("makes organization Channels writable for %s", async (role, expected) => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue(role);
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByText("Lark");
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: "Connect Lark" }) !== null
			).toBe(expected);
		});
	});

	it("introduces the Channels page with its organization context and purpose", async () => {
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByRole("heading", { level: 2, name: "Lark" });
		expect(
			screen.getByRole("heading", { level: 1, name: "Channels" })
		).toBeTruthy();
		const description = screen.getByText(
			"Connect Slack, Lark, or Feishu so people in Acme can message the same Center Agent and receive replies in the same conversation."
		);
		expect(description).toBeTruthy();
		expect(description.classList.contains("max-w-none")).toBe(true);
		expect(screen.getByText("Organization")).toBeTruthy();
	});

	it("announces pending Plugin access without showing loading copy", () => {
		getActiveOrganizationMemberRoleMock.mockReturnValue(
			new Promise(() => undefined)
		);
		pluginsSelectedService = "github";
		render(
			<TestQueryClientProvider>
				<OrganizationPluginsPage />
			</TestQueryClientProvider>
		);

		const status = screen.getByRole("status");
		expect(status.textContent).toBe("Loading app access.");
		expect(status.classList.contains("sr-only")).toBe(true);
	});

	it.each([
		["owner", "true"],
		["admin", "true"],
		["member", "false"],
	])("uses %s permissions on the GitHub detail page", async (role, expected) => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue(role);
		pluginsSelectedService = "github";
		render(
			<TestQueryClientProvider>
				<OrganizationPluginsPage />
			</TestQueryClientProvider>
		);

		const detail = await screen.findByTestId("app-detail");
		await waitFor(() => {
			expect(detail.getAttribute("data-can-manage")).toBe(expected);
		});
	});

	it("shows the Plugin catalog without waiting for role access", () => {
		render(
			<TestQueryClientProvider>
				<OrganizationPluginsPage />
			</TestQueryClientProvider>
		);

		const apps = screen.getByTestId("apps-catalog");
		expect(apps.getAttribute("data-organization-slug")).toBe("acme");
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
	});

	it("renders Plugins for a personal workspace", async () => {
		currentOrganization = {
			id: "personal-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};
		render(
			<TestQueryClientProvider>
				<OrganizationPluginsPage />
			</TestQueryClientProvider>
		);

		const apps = await screen.findByTestId("apps-catalog");
		expect(apps.getAttribute("data-organization-slug")).toBe("felix");
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
	});

	it("keeps Channels visible in a personal workspace and guides setup through a new organization", async () => {
		currentOrganization = {
			id: "personal-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};
		readCurrentCenterAgentDesignationMock.mockResolvedValue({
			designation: null,
			organizationId: "personal-felix",
			remoteRuntimeAvailability: { selectable: true },
			slackConnection: {
				connected: false,
				slackTeamId: null,
				workspaceName: null,
			},
		});
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [],
			organizationId: "personal-felix",
		});
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByRole("heading", { level: 2, name: "Slack" });
		expect(
			screen.getByRole("heading", { level: 2, name: "Lark" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Feishu" })
		).toBeTruthy();
		expect(screen.queryByText("Loading channels.")).toBeNull();
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
		expect(
			listCurrentOrganizationLarkPlatformRegistrationsMock
		).not.toHaveBeenCalled();
		expect(screen.getByText("Personal workspace")).toBeTruthy();
		expect(
			screen.getByText(
				"Your Personal Workspace is only for you. Create an organization to connect Slack, Lark, or Feishu for your teammates."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("heading", {
				level: 2,
				name: "Create an organization to connect Channels",
			})
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Create organization" })
				.getAttribute("href")
		).toBe("/o/felix/new-organization?intent=slack-install");
		expect(screen.getAllByText("Organization required").length).toBeGreaterThan(
			0
		);
		expect(
			screen.queryByRole("button", { name: CONNECT_ACTION_NAME })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: REPAIR_ACTION_NAME })
		).toBeNull();
	});

	it("explains how to move an existing personal Slack connection", async () => {
		currentOrganization = {
			id: "personal-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText(
				"Slack is connected to this Personal Workspace from an earlier setup. Create an organization, then connect the same Slack workspace there to move it."
			)
		).toBeTruthy();
		expect(screen.getByText("Move required")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Manage Slack" })).toBeNull();
	});

	it("uses the Channels projection as the only Slack move truth", async () => {
		currentOrganization = {
			id: "personal-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [],
			organizationId: "personal-felix",
		});
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByRole("heading", { level: 2, name: "Slack" });
		expect(screen.queryByText("Move required")).toBeNull();
		expect(screen.getAllByText("Organization required").length).toBeGreaterThan(
			0
		);
		expect(readCurrentCenterAgentDesignationMock).not.toHaveBeenCalled();
	});

	it("offers disconnect cleanup for a historical Personal Workspace Lark connection", async () => {
		currentOrganization = {
			id: "personal-felix",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		};
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				{
					externalAccountId: "tenant_lark_1",
					externalAccountName: "Legacy Lark",
					grantedCapabilityGroups: ["conversation.text"],
					id: "connection_lark_1",
					lastVerifiedAt: "2026-07-18T00:00:00.000Z",
					permissionBundleVersion: "channel-only-2026-07-18",
					provider: "lark",
					reasonCode: null,
					status: "connected",
					transport: "webhook",
				},
			],
			organizationId: "personal-felix",
		});
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect Lark" })
		);
		expect(
			screen.getByRole("heading", { name: "Disconnect Lark" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"This connection belongs to your Personal Workspace. Disconnect it before connecting Lark to an organization."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Repair Lark" })).toBeNull();
	});

	it("refreshes formal connections when durable setup leaves the active list", async () => {
		const queryClient = createTestQueryClient();
		let registrationReadCount = 0;
		let finishConnectionRefresh: (() => void) | undefined;
		const connectionRefresh = new Promise<{
			availableLarkPlatformProviders: string[];
			connections: Record<string, unknown>[];
			organizationId: string;
		}>((resolve) => {
			finishConnectionRefresh = () =>
				resolve({
					availableLarkPlatformProviders: ["lark"],
					connections: [
						{
							externalAccountId: "tenant_lark_1",
							externalAccountName: "Acme Lark",
							grantedCapabilityGroups: ["conversation.text"],
							id: "connection_lark_1",
							lastVerifiedAt: "2026-07-21T09:00:10.000Z",
							permissionBundleVersion: "channel-only-2026-07-18",
							provider: "lark",
							reasonCode: null,
							status: "connected",
							transport: "webhook",
						},
					],
					organizationId: "org-acme",
				});
		});
		listCurrentOrganizationMessageChannelsMock
			.mockReset()
			.mockImplementation(async () =>
				registrationReadCount > 1
					? await connectionRefresh
					: {
							availableLarkPlatformProviders: ["lark"],
							connections: [],
							organizationId: "org-acme",
						}
			);
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockImplementation(() => {
				registrationReadCount += 1;
				return Promise.resolve({
					organizationId: "org-acme",
					registrations:
						registrationReadCount === 1
							? [
									{
										canResume: true,
										expiresAt: "2026-07-21T10:00:00.000Z",
										id: "attempt_lark_pending",
										nextPollAt: "2026-07-21T09:00:05.000Z",
										provider: "lark" as const,
										reasonCode: null,
										status: "pending_registration" as const,
									},
								]
							: [],
				});
			});
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByText(
			"Finish setup on the official Lark page in this browser."
		);
		expect(screen.getByText("Connecting")).toBeTruthy();
		const initialConnectionReads =
			listCurrentOrganizationMessageChannelsMock.mock.calls.length;

		let registrationRefresh: Promise<void> | undefined;
		act(() => {
			registrationRefresh = queryClient.invalidateQueries({
				queryKey: messageChannelQueryKeys.activeRegistrations("org-acme"),
			});
		});

		await waitFor(() => {
			expect(
				screen.getByText(
					"Finish setup on the official Lark page in this browser."
				)
			).toBeTruthy();
			expect(screen.getByText("Connecting")).toBeTruthy();
			expect(screen.queryByText("Connect Lark")).toBeNull();
		});
		expect(
			listCurrentOrganizationMessageChannelsMock.mock.calls.length
		).toBeGreaterThan(initialConnectionReads);

		await act(async () => {
			finishConnectionRefresh?.();
			await registrationRefresh;
		});
		await waitFor(() => {
			expect(screen.getByText("Acme Lark")).toBeTruthy();
			expect(screen.getByRole("button", { name: "Manage Lark" })).toBeTruthy();
		});
	});

	it("keeps the real Lark row connecting when the formal connection refresh fails", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			messageChannelQueryKeys.list("org-acme"),
			{
				availableLarkPlatformProviders: ["lark"],
				connections: [],
				organizationId: "org-acme",
			},
			{ updatedAt: Date.now() - 20_000 }
		);
		queryClient.setQueryData(
			messageChannelQueryKeys.activeRegistrations("org-acme"),
			{
				organizationId: "org-acme",
				registrations: [
					{
						canResume: true,
						expiresAt: "2026-07-21T10:00:00.000Z",
						id: "attempt_lark_pending",
						nextPollAt: "2026-07-21T09:00:05.000Z",
						provider: "lark",
						reasonCode: null,
						status: "pending_registration",
					},
				],
			},
			{ updatedAt: Date.now() - 10_000 }
		);
		listCurrentOrganizationMessageChannelsMock
			.mockReset()
			.mockRejectedValue(new Error("formal connection refresh unavailable"));
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockResolvedValue({
				organizationId: "org-acme",
				registrations: [],
			});

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"formal connection refresh unavailable"
		);
		await waitFor(() => {
			expect(
				screen.getByText(
					"OpenMeld could not refresh this setup. Refresh Channels before taking another action."
				)
			).toBeTruthy();
			expect(screen.getByText("Connecting")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
			expect(
				screen.queryByRole("button", { name: "Continue setup" })
			).toBeNull();
		});
	});

	it("keeps canonical Channels visible when setup progress cannot be read", async () => {
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockRejectedValue(new Error("registration projection unavailable"));
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByText(
			"OpenMeld is checking whether setup is already in progress."
		);
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
		expect((await screen.findByRole("alert")).textContent).toContain(
			"registration projection unavailable"
		);
	});

	it("keeps canonical Channels visible while setup progress is still loading", async () => {
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockImplementation(async () => await new Promise(() => undefined));
		render(
			<TestQueryClientProvider>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByText(
			"OpenMeld is checking whether setup is already in progress."
		);
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
		expect(screen.queryByText("Loading channels.")).toBeNull();
	});

	it("keeps cached empty setup progress neutral while it refreshes", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			messageChannelQueryKeys.activeRegistrations("org-acme"),
			{ organizationId: "org-acme", registrations: [] },
			{ updatedAt: Date.now() - 10_000 }
		);
		listCurrentOrganizationLarkPlatformRegistrationsMock
			.mockReset()
			.mockImplementation(async () => await new Promise(() => undefined));
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationMessageChannelsPage />
			</TestQueryClientProvider>
		);

		await screen.findByText(
			"OpenMeld is checking whether setup is already in progress."
		);
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
		expect(screen.queryByText("Loading channels.")).toBeNull();
	});
});
