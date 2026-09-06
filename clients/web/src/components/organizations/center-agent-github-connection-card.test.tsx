import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationPluginConnectionQueryKeys } from "#/query/organizations/plugin-connections";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";

const disconnectOrganizationGitHubConnectionMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationGitHubConnectionsMock = vi.hoisted(() => vi.fn());
const startCurrentMemberGitHubAuthorizationMock = vi.hoisted(() => vi.fn());
const startCurrentOrganizationSharedGitHubAuthorizationMock = vi.hoisted(() =>
	vi.fn()
);
const TRANSIENT_STATUS_COPY = /checking|updating/i;
const CONNECT_BUTTON_NAME = /Connect/i;
const GITHUB_NOT_CONNECTED_COPY = /You have not connected GitHub/i;
const GITHUB_SETUP_TIMEOUT_COPY =
	"GitHub setup timed out. Start again when you are ready.";
const NO_ORGANIZATION_ACCESS_COPY = /No Organization access/i;

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

vi.mock("#/lib/organizations/connector-connections", () => ({
	disconnectOrganizationGitHubConnection:
		disconnectOrganizationGitHubConnectionMock,
	disconnectSharedOrganizationGitHubConnection: vi.fn(),
	listCurrentOrganizationGitHubConnections:
		listCurrentOrganizationGitHubConnectionsMock,
	listCurrentOrganizationConnectorConnections:
		listCurrentOrganizationGitHubConnectionsMock,
	resolveConnectorConnectionErrorMessage: (error: unknown) => String(error),
	startCurrentMemberGitHubAuthorization:
		startCurrentMemberGitHubAuthorizationMock,
	startCurrentOrganizationSharedGitHubAuthorization:
		startCurrentOrganizationSharedGitHubAuthorizationMock,
}));

describe("CenterAgentGitHubConnectionCard", () => {
	beforeEach(() => {
		disconnectOrganizationGitHubConnectionMock.mockReset().mockResolvedValue({
			connection: createConnection({ status: "disconnected" }),
		});
		listCurrentOrganizationGitHubConnectionsMock.mockReset().mockResolvedValue({
			connections: [createConnection()],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		startCurrentMemberGitHubAuthorizationMock.mockReset().mockResolvedValue({
			authorizationUrl: "https://github.example/authorize",
			connection: createConnection({ status: "pending" }),
		});
		startCurrentOrganizationSharedGitHubAuthorizationMock
			.mockReset()
			.mockResolvedValue({
				authorizationUrl: "https://github.example/authorize-shared",
				connection: createConnection({
					scope: "shared",
					status: "pending",
				}),
				expiresAtMs: Date.now() + 600_000,
			});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("uses silent section skeletons until GitHub connection status is known", () => {
		listCurrentOrganizationGitHubConnectionsMock.mockReturnValueOnce(
			new Promise(() => undefined)
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const statusRegion = screen.getByRole("region", {
			name: "GitHub connection status",
		});
		expect(statusRegion.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("heading", { name: "Your GitHub" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Member connections" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Organization GitHub Plugin" })
		).toBeTruthy();
		expect(
			screen.getAllByTestId("plugin-access-loading-skeleton")
		).toHaveLength(3);
		expect(screen.queryByText(TRANSIENT_STATUS_COPY)).toBeNull();
		expect(screen.queryByText(GITHUB_NOT_CONNECTED_COPY)).toBeNull();
		expect(screen.queryByText(NO_ORGANIZATION_ACCESS_COPY)).toBeNull();
		expect(
			screen.queryByRole("button", { name: CONNECT_BUTTON_NAME })
		).toBeNull();
	});

	it("keeps personal, member, and Organization GitHub access in separate sections", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [
				createConnection(),
				createConnection({
					connectionName: "github-member-2",
					ownerDisplayName: "Ashley",
					userId: "user-2",
				}),
				createConnection({
					connectionName: "github-organization",
					ownerDisplayName: "Morgan",
					scope: "shared",
					userId: "user-3",
				}),
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const yourAccess = screen.getByRole("region", { name: "Your GitHub" });
		const memberConnections = screen.getByRole("region", {
			name: "Member connections",
		});
		const organizationAccess = screen.getByRole("region", {
			name: "Organization GitHub Plugin",
		});
		expect(await within(yourAccess).findByText("Felix")).toBeTruthy();
		expect(
			within(yourAccess).getByText(
				"Your GitHub identity. Only you can use this connection."
			)
		).toBeTruthy();
		expect(within(memberConnections).getByText("Ashley")).toBeTruthy();
		expect(
			within(organizationAccess).getByText("OpenMeld GitHub Plugin")
		).toBeTruthy();
		expect(
			within(organizationAccess).getByText(
				"Installed by Morgan. Organization work runs as the OpenMeld bot."
			)
		).toBeTruthy();
		expect(within(yourAccess).queryByText("Ashley")).toBeNull();
	});

	it("keeps connected GitHub access manageable during onboarding", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [
				createConnection(),
				createConnection({
					connectionName: "github-organization",
					ownerDisplayName: "Morgan",
					scope: "shared",
					userId: "user-3",
				}),
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage
					mode="all"
					organizationId="org-acme"
					presentation="onboarding"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findAllByRole("button", { name: "Disconnect GitHub" })
		).toHaveLength(2);
	});

	it("uses workspace access and hides impossible member sections in a personal workspace", async () => {
		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage
					isPersonalWorkspace
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByRole("heading", { name: "Workspace GitHub Plugin" })
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Member connections" })
		).toBeNull();
		expect(
			await screen.findByText("No Workspace access is connected yet.")
		).toBeTruthy();
	});

	it("requires modal confirmation before disconnecting GitHub", async () => {
		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Felix")).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld can use only repositories included in an OpenMeld GitHub Plugin installation and allowed for this GitHub identity."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Review GitHub Plugin installations" })
				.getAttribute("href")
		).toBe("https://github.com/settings/installations");

		fireEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Disconnect GitHub?" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"This removes the connection from this OpenMeld workspace. It does not sign you out of GitHub or uninstall the OpenMeld GitHub Plugin."
			)
		).toBeTruthy();
		expect(disconnectOrganizationGitHubConnectionMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(disconnectOrganizationGitHubConnectionMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));

		fireEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));

		await waitFor(() => {
			expect(disconnectOrganizationGitHubConnectionMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				userId: "user-1",
			});
		});
	});

	it("shows an explicit optimistic state while GitHub disconnect is pending", async () => {
		let resolveDisconnect: ((value: unknown) => void) | undefined;
		disconnectOrganizationGitHubConnectionMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveDisconnect = resolve;
				})
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect GitHub" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Disconnect GitHub" }));

		const pendingButton = await screen.findByRole("button", {
			name: "Disconnecting GitHub",
		});
		expect(pendingButton.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();

		resolveDisconnect?.({
			connection: createConnection({ status: "disconnected" }),
		});
	});

	it("explains that Organization access installs the OpenMeld bot with selected repositories", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage
					mode="shared"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText(
				"Install the OpenMeld GitHub Plugin and choose the repositories the Center Agent can use. Organization work and Routines run as the OpenMeld bot."
			)
		).toBeTruthy();
		expect(
			await screen.findByRole("button", { name: "Install GitHub Plugin" })
		).toBeTruthy();
	});

	it("keeps cached GitHub status visible but disables actions after refresh fails", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationPluginConnectionQueryKeys.service("org-acme", "github"),
			{
				connections: [createConnection()],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: 1 }
		);
		listCurrentOrganizationGitHubConnectionsMock.mockRejectedValue(
			new Error("status refresh failed")
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Felix")).toBeTruthy();
		expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Disconnect GitHub" })
				.hasAttribute("disabled")
		).toBe(true);
		expect(screen.queryByTestId("plugin-access-loading-skeleton")).toBeNull();
	});

	it("does not call a background refresh disconnecting", async () => {
		const queryClient = createTestQueryClient();
		const queryKey = organizationPluginConnectionQueryKeys.service(
			"org-acme",
			"github"
		);
		queryClient.setQueryData(
			queryKey,
			{
				connections: [createConnection()],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: Date.now() }
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect GitHub" })
		);
		expect(
			screen.getByRole("button", { name: "Disconnect GitHub" })
		).toBeTruthy();

		listCurrentOrganizationGitHubConnectionsMock.mockReturnValueOnce(
			new Promise(() => undefined)
		);
		act(() => {
			queryClient
				.invalidateQueries({ exact: true, queryKey })
				.catch(() => undefined);
		});

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Checking connection status" })
					.hasAttribute("disabled")
			).toBe(true);
		});
		expect(
			screen.queryByRole("button", { name: "Disconnecting..." })
		).toBeNull();
		const cancelButton = screen.getByRole("button", { name: "Cancel" });
		expect(cancelButton.hasAttribute("disabled")).toBe(false);
		fireEvent.click(cancelButton);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("keeps onboarding visible while GitHub authorization runs and supports cancel", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		const popup = {
			close: vi.fn(),
			closed: false,
			focus: vi.fn(),
			location: { href: "about:blank" },
			opener: {},
		};
		const openSpy = vi
			.spyOn(window, "open")
			.mockReturnValue(popup as unknown as Window);
		const onAuthorizationStateChange = vi.fn();

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					onAuthorizationStateChange={onAuthorizationStateChange}
					organizationId="org-acme"
					presentation="onboarding"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect my GitHub",
		});
		await waitFor(() => {
			expect(connectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(connectButton);

		await waitFor(() => {
			expect(startCurrentMemberGitHubAuthorizationMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
			});
			expect(popup.location.href).toBe("https://github.example/authorize");
		});
		expect(openSpy).toHaveBeenCalledWith(
			"about:blank",
			"openmeld-github-authorization",
			"popup,width=720,height=760"
		);
		expect(
			screen.getByRole("button", { name: "Waiting for GitHub..." })
		).toBeTruthy();
		await waitFor(() => {
			expect(onAuthorizationStateChange).toHaveBeenLastCalledWith(true);
		});

		popup.closed = true;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1100);
		});
		expect(
			screen.getByRole("button", { name: "Waiting for GitHub..." })
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(popup.close).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(onAuthorizationStateChange).toHaveBeenLastCalledWith(false);
		});
		expect(
			screen.getByRole("button", { name: "Connect my GitHub" })
		).toBeTruthy();
	});

	it("waits for the Core-owned GitHub Plugin installation expiry", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(1_000_000);
		const expiresAtMs = Date.now() + 600_000;
		startCurrentOrganizationSharedGitHubAuthorizationMock.mockResolvedValue({
			authorizationUrl: "https://github.example/authorize-shared",
			connection: createConnection({
				scope: "shared",
				status: "pending",
			}),
			expiresAtMs,
		});
		const popup = await startSharedGitHubAuthorization();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_001);
		});
		expect(
			screen.getByRole("button", { name: "Waiting for GitHub..." })
		).toBeTruthy();
		expect(screen.queryByText(GITHUB_SETUP_TIMEOUT_COPY)).toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(expiresAtMs - Date.now());
		});
		expect(screen.getByText(GITHUB_SETUP_TIMEOUT_COPY)).toBeTruthy();
		expect(popup.close).toHaveBeenCalledTimes(1);
	});

	it("does not invent a GitHub Plugin expiry when the response omits it", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		vi.setSystemTime(1_000_000);
		startCurrentOrganizationSharedGitHubAuthorizationMock.mockResolvedValue({
			authorizationUrl: "https://github.example/authorize-shared",
			connection: createConnection({
				scope: "shared",
				status: "pending",
			}),
		});
		const popup = await startSharedGitHubAuthorization();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(600_001);
		});
		expect(
			screen.getByRole("button", { name: "Waiting for GitHub..." })
		).toBeTruthy();
		expect(screen.queryByText(GITHUB_SETUP_TIMEOUT_COPY)).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(popup.close).toHaveBeenCalledTimes(1);
	});

	it("keeps onboarding usable when the browser blocks the GitHub popup", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
					presentation="onboarding"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect my GitHub",
		});
		await waitFor(() => {
			expect(connectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(connectButton);

		expect(
			screen.getByText(
				"Your browser blocked the GitHub window. Allow pop-ups for OpenMeld and try again."
			)
		).toBeTruthy();
		expect(startCurrentMemberGitHubAuthorizationMock).not.toHaveBeenCalled();
		expect(connectButton.hasAttribute("disabled")).toBe(false);
		openSpy.mockRestore();
	});

	it("does not expose disconnect controls in onboarding", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
			connections: [createConnection()],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
					presentation="onboarding"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByRole("heading", { name: "Your GitHub" })
		).toBeTruthy();
		expect(await screen.findByText("Felix")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
	});

	it("keeps connector diagnostics out of onboarding and leaves a clear recovery path", async () => {
		listCurrentOrganizationGitHubConnectionsMock.mockRejectedValue(
			new Error("OpenConnector admin token is not configured.")
		);

		render(
			<TestQueryClientProvider>
				<CenterAgentGitHubConnectionCard
					canManage={false}
					mode="member"
					organizationId="org-acme"
					presentation="onboarding"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText(
				"GitHub is unavailable right now. Finish setup and connect it later in Center Agent → Plugins."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Connect my GitHub" })
				.hasAttribute("disabled")
		).toBe(true);
		expect(
			screen.queryByText("Error: OpenConnector admin token is not configured.")
		).toBeNull();
	});
});

async function startSharedGitHubAuthorization() {
	listCurrentOrganizationGitHubConnectionsMock.mockResolvedValue({
		connections: [],
		currentUserId: "user-1",
		organizationId: "org-acme",
	});
	const popup = {
		close: vi.fn(),
		closed: false,
		focus: vi.fn(),
		location: { href: "about:blank" },
		opener: {},
	};
	vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

	render(
		<TestQueryClientProvider>
			<CenterAgentGitHubConnectionCard
				canManage
				mode="shared"
				organizationId="org-acme"
			/>
		</TestQueryClientProvider>
	);

	const installButton = await screen.findByRole("button", {
		name: "Install GitHub Plugin",
	});
	await waitFor(() => {
		expect(installButton.hasAttribute("disabled")).toBe(false);
	});
	fireEvent.click(installButton);
	await waitFor(() => {
		expect(
			screen.getByRole("button", { name: "Waiting for GitHub..." })
		).toBeTruthy();
	});

	return popup;
}

function createConnection(
	overrides: Partial<{
		connectionName: string;
		ownerDisplayName: string;
		scope: "member" | "shared";
		status: "active" | "disconnected" | "pending";
		userId: string;
	}> = {}
) {
	return {
		canDisconnect: true,
		connectionName: overrides.connectionName ?? "github-member-connection",
		createdAtMs: 1,
		disconnectedAtMs: overrides.status === "disconnected" ? 2 : null,
		organizationId: "org-acme",
		ownerDisplayName: overrides.ownerDisplayName ?? "Felix",
		scope: overrides.scope ?? ("member" as const),
		service: "github" as const,
		status: overrides.status ?? ("active" as const),
		updatedAtMs: 1,
		userId: overrides.userId ?? "user-1",
	};
}
