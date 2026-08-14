import { onlineManager } from "@tanstack/react-query";
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
import { organizationAppConnectionQueryKeys } from "#/query/organizations/app-connections";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { type AppDefinition, findAppDefinition } from "./app-catalog";
import { CenterAgentAppConnectionCard } from "./center-agent-app-connection-card";

const listConnectionsMock = vi.hoisted(() => vi.fn());
const startMemberAuthorizationMock = vi.hoisted(() => vi.fn());
const connectMemberCredentialMock = vi.hoisted(() => vi.fn());
const disconnectOrganizationConnectorConnectionMock = vi.hoisted(() => vi.fn());
const TRANSIENT_STATUS_COPY = /checking|updating/i;
const CONNECT_BUTTON_NAME = /Connect/i;

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

vi.mock("#/lib/organizations/connector-connections", () => ({
	connectCurrentMemberConnectorCredential: connectMemberCredentialMock,
	connectCurrentOrganizationSharedConnectorCredential: vi.fn(),
	disconnectOrganizationConnectorConnection:
		disconnectOrganizationConnectorConnectionMock,
	disconnectSharedOrganizationConnectorConnection: vi.fn(),
	isConnectorConnectionConfirmationRetryable: (error: unknown) => {
		const status = (error as { status?: number | null }).status;
		return status == null || status >= 500;
	},
	listCurrentOrganizationConnectorConnections: listConnectionsMock,
	resolveConnectorConnectionErrorMessage: (error: unknown, appName = "App") =>
		(error as { upstreamCode?: string }).upstreamCode ===
		"connector.organization_context_changed"
			? `Your active Organization changed in another tab. Refresh this page before updating ${appName}.`
			: String(error),
	startCurrentMemberConnectorAuthorization: startMemberAuthorizationMock,
	startCurrentOrganizationSharedConnectorAuthorization: vi.fn(),
}));

const linearApp = {
	availability: "available",
	category: "Developer tools",
	connection: {
		auth: { kind: "oauth" },
	},
	description: "Read issues and help maintain project workflows.",
	homepage: "https://linear.app",
	logoPath: "/app-logos/linear.svg",
	name: "Linear",
	service: "linear",
} as const satisfies Extract<AppDefinition, { availability: "available" }>;

const figmaApp = requireAvailableApp("figma");
const notionApp = requireAvailableApp("notion");
const posthogApp = requireAvailableApp("posthog");

describe("CenterAgentAppConnectionCard", () => {
	beforeEach(() => {
		listConnectionsMock.mockReset().mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		startMemberAuthorizationMock.mockReset().mockResolvedValue({
			authorizationUrl: "https://linear.example/authorize",
		});
		connectMemberCredentialMock.mockReset().mockResolvedValue({
			connection: {
				canDisconnect: true,
				connectionName:
					"org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__figma",
				createdAtMs: 1,
				disconnectedAtMs: null,
				organizationId: "org-acme",
				ownerDisplayName: "Felix",
				scope: "member",
				service: "figma",
				status: "active",
				updatedAtMs: 1,
				userId: "user-1",
			},
		});
		disconnectOrganizationConnectorConnectionMock
			.mockReset()
			.mockResolvedValue({
				connection: createLinearConnection({ status: "disconnected" }),
			});
	});

	afterEach(() => {
		cleanup();
		onlineManager.setOnline(true);
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("uses silent section skeletons until App connection status is known", () => {
		listConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const statusRegion = screen.getByRole("region", {
			name: "Linear connection status",
		});
		expect(statusRegion.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("heading", { name: "Your access" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Member connections" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Organization access" })
		).toBeTruthy();
		expect(screen.getAllByTestId("app-access-loading-skeleton")).toHaveLength(
			3
		);
		expect(screen.queryByText(TRANSIENT_STATUS_COPY)).toBeNull();
		expect(
			screen.queryByRole("button", { name: CONNECT_BUTTON_NAME })
		).toBeNull();
	});

	it("uses workspace access and hides impossible member sections in a personal workspace", async () => {
		listConnectionsMock.mockResolvedValue({
			connections: [
				createLinearConnection({
					connectionName: "linear-workspace",
					ownerDisplayName: "Felix",
					scope: "shared",
				}),
			],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage
					isPersonalWorkspace
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByRole("heading", { name: "Workspace access" })
		).toBeTruthy();
		expect(
			screen.getByText("Available to your Center Agent and Routines.")
		).toBeTruthy();
		expect(await screen.findByText("Workspace connection")).toBeTruthy();
		expect(
			screen.getByText(
				"Authorized by Felix. Available to your Center Agent and Routines."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Member connections" })
		).toBeNull();
	});

	it("keeps personal, member, and Organization App access in separate sections", async () => {
		listConnectionsMock.mockResolvedValue({
			connections: [
				createLinearConnection({ ownerDisplayName: "Felix", userId: "user-1" }),
				createLinearConnection({
					connectionName: "linear-member-2",
					ownerDisplayName: "Ashley",
					userId: "user-2",
				}),
				createLinearConnection({
					connectionName: "linear-organization",
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
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage
					mode="all"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const yourAccess = screen.getByRole("region", { name: "Your access" });
		const memberConnections = screen.getByRole("region", {
			name: "Member connections",
		});
		const organizationAccess = screen.getByRole("region", {
			name: "Organization access",
		});
		expect(await within(yourAccess).findByText("Felix")).toBeTruthy();
		expect(
			within(yourAccess).getByText(
				"Your account. Only you can use this connection."
			)
		).toBeTruthy();
		expect(within(memberConnections).getByText("Ashley")).toBeTruthy();
		expect(
			within(organizationAccess).getByText("Organization connection")
		).toBeTruthy();
		expect(
			within(organizationAccess).getByText(
				"Authorized by Morgan. Available to every member and Routine."
			)
		).toBeTruthy();
		expect(within(yourAccess).queryByText("Ashley")).toBeNull();
	});

	it("requires confirmation before disconnecting an App", async () => {
		listConnectionsMock.mockResolvedValue({
			connections: [createLinearConnection()],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const disconnectButton = await screen.findByRole("button", {
			name: "Disconnect Linear",
		});
		await waitFor(() => {
			expect(disconnectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(disconnectButton);

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Disconnect Linear?" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"This removes this connection from this OpenMeld workspace. It does not delete anything in Linear."
			)
		).toBeTruthy();
		expect(
			disconnectOrganizationConnectorConnectionMock
		).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("dialog")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Disconnect Linear" }));
		fireEvent.click(screen.getByRole("button", { name: "Disconnect Linear" }));

		await waitFor(() => {
			expect(
				disconnectOrganizationConnectorConnectionMock
			).toHaveBeenCalledWith({
				organizationId: "org-acme",
				service: "linear",
				userId: "user-1",
			});
		});
	});

	it("shows an explicit optimistic state while an App disconnect is pending", async () => {
		let resolveDisconnect: ((value: unknown) => void) | undefined;
		disconnectOrganizationConnectorConnectionMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveDisconnect = resolve;
				})
		);
		listConnectionsMock.mockResolvedValue({
			connections: [createLinearConnection()],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect Linear" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Disconnect Linear" }));

		const pendingButton = await screen.findByRole("button", {
			name: "Disconnecting Linear",
		});
		expect(pendingButton.hasAttribute("disabled")).toBe(true);
		expect(screen.queryByRole("button", { name: "Connect Linear" })).toBeNull();

		resolveDisconnect?.({
			connection: createLinearConnection({ status: "disconnected" }),
		});
	});

	it("keeps Cancel available when status refresh starts behind a dialog", async () => {
		const queryClient = createTestQueryClient();
		const queryKey = organizationAppConnectionQueryKeys.service(
			"org-acme",
			"linear"
		);
		queryClient.setQueryData(
			queryKey,
			{
				connections: [createLinearConnection()],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: Date.now() }
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect Linear" })
		);
		listConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));
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
		const cancelButton = screen.getByRole("button", { name: "Cancel" });
		expect(cancelButton.hasAttribute("disabled")).toBe(false);
		fireEvent.click(cancelButton);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("keeps cached status visible but disables actions after refresh fails", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationAppConnectionQueryKeys.service("org-acme", "linear"),
			{
				connections: [createLinearConnection()],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: 1 }
		);
		listConnectionsMock.mockRejectedValue(new Error("status refresh failed"));

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
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
				.getByRole("button", { name: "Disconnect Linear" })
				.hasAttribute("disabled")
		).toBe(true);
		expect(screen.queryByTestId("app-access-loading-skeleton")).toBeNull();
	});

	it("keeps cached empty status read-only and explains a paused refresh", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationAppConnectionQueryKeys.service("org-acme", "linear"),
			{
				connections: [],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: 1 }
		);
		onlineManager.setOnline(false);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Checking connection status",
		});
		expect(connectButton.hasAttribute("disabled")).toBe(true);
		expect(screen.getByText(TRANSIENT_STATUS_COPY)).toBeTruthy();
		expect(screen.queryByTestId("app-access-loading-skeleton")).toBeNull();
	});

	it("keeps a fresh mount snapshot usable after it naturally becomes stale", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-22T03:00:00.000Z"));
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			organizationAppConnectionQueryKeys.service("org-acme", "linear"),
			{
				connections: [],
				currentUserId: "user-1",
				organizationId: "org-acme",
			},
			{ updatedAt: Date.now() }
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = screen.getByRole("button", {
			name: "Connect Linear",
		});
		expect(connectButton.hasAttribute("disabled")).toBe(false);

		act(() => vi.advanceTimersByTime(30_001));

		expect(connectButton.hasAttribute("disabled")).toBe(false);
		expect(listConnectionsMock).not.toHaveBeenCalled();
	});

	it("keeps the connection form usable when the browser blocks OAuth", async () => {
		const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() => {
			expect(connectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(connectButton);

		expect(
			screen.getByText(
				"Your browser blocked the Linear window. Allow pop-ups for OpenMeld and try again."
			)
		).toBeTruthy();
		expect(startMemberAuthorizationMock).not.toHaveBeenCalled();
		expect(connectButton.hasAttribute("disabled")).toBe(false);
		openSpy.mockRestore();
	});

	it("keeps the authorization state stable while connection status refreshes", async () => {
		const queryClient = createTestQueryClient();
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		} as unknown as Window;
		vi.spyOn(window, "open").mockReturnValue(popup);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockReturnValueOnce(new Promise(() => undefined));
		act(() => {
			queryClient
				.invalidateQueries({
					exact: true,
					queryKey: organizationAppConnectionQueryKeys.service(
						"org-acme",
						"linear"
					),
				})
				.catch(() => undefined);
		});

		await waitFor(() => {
			expect(listConnectionsMock).toHaveBeenCalledTimes(2);
			expect(screen.getByText("Waiting for authorization…")).toBeTruthy();
			expect(screen.queryByText("Checking…")).toBeNull();
		});
	});

	it("stops waiting when the user closes the authorization window", async () => {
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");
		popup.closed = true;

		expect(
			await screen.findByText(
				"Linear wasn’t connected. Try again when you’re ready."
			)
		).toBeTruthy();
		expect(screen.queryByText("Waiting for authorization…")).toBeNull();
	});

	it("confirms connection truth before treating a closed authorization window as incomplete", async () => {
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockResolvedValueOnce({
			connections: [createLinearConnection()],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		popup.closed = true;

		expect(await screen.findByText("Connected")).toBeTruthy();
		expect(
			screen.queryByText(
				"Linear wasn’t connected. Try again when you’re ready."
			)
		).toBeNull();
		expect(listConnectionsMock).toHaveBeenCalledTimes(2);
	});

	it("settles a closed authorization window after a transient confirmation failure", async () => {
		const confirmationError = new Error("connection lookup failed");
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		let connectionLookupFails = true;
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockImplementation(() =>
			connectionLookupFails
				? Promise.reject(confirmationError)
				: Promise.resolve({
						connections: [],
						currentUserId: "user-1",
						organizationId: "org-acme",
					})
		);
		popup.closed = true;
		await waitFor(() =>
			expect(errorSpy).toHaveBeenCalledWith(
				"[openmeld.web.connector_authorization_confirmation_failed]",
				expect.objectContaining({ error: confirmationError })
			)
		);
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		connectionLookupFails = false;

		expect(
			await screen.findByText(
				"Linear wasn’t connected. Try again when you’re ready.",
				undefined,
				{ timeout: 3000 }
			)
		).toBeTruthy();
		expect(listConnectionsMock.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("surfaces a terminal confirmation failure without leaving authorization pending", async () => {
		const confirmationError = {
			code: "gateway.http_error",
			message: "Your active Organization changed.",
			status: 409,
			upstreamCode: "connector.organization_context_changed",
		};
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockRejectedValue(confirmationError);
		popup.closed = true;

		expect(
			await screen.findByText(
				"Your active Organization changed in another tab. Refresh this page before updating Linear."
			)
		).toBeTruthy();
		expect(screen.queryByText("Waiting for authorization…")).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(errorSpy).toHaveBeenCalledWith(
			"[openmeld.web.connector_authorization_confirmation_failed]",
			expect.objectContaining({ error: confirmationError })
		);
	});

	it("surfaces a terminal polling failure while the authorization window is open", async () => {
		const confirmationError = {
			code: "gateway.http_error",
			message: "Your active Organization changed.",
			status: 409,
			upstreamCode: "connector.organization_context_changed",
		};
		const errorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockRejectedValue(confirmationError);

		expect(
			await screen.findByText(
				"Your active Organization changed in another tab. Refresh this page before updating Linear.",
				undefined,
				{ timeout: 3000 }
			)
		).toBeTruthy();
		expect(screen.queryByText("Waiting for authorization…")).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(popup.close).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledWith(
			"[openmeld.web.connector_authorization_confirmation_failed]",
			expect.objectContaining({ error: confirmationError })
		);
	});

	it("offers a connection status retry after transient failures time out", async () => {
		const queryClient = createTestQueryClient();
		const transientError = {
			code: "gateway.http_error",
			message: "OpenConnector is temporarily unavailable.",
			status: 503,
		};
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		};
		let authorizationTimeout: (() => void) | undefined;
		const nativeSetTimeout = window.setTimeout.bind(window);
		vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
		vi.spyOn(window, "setTimeout").mockImplementation(
			(
				handler: TimerHandler,
				timeout?: number,
				...args: unknown[]
			): ReturnType<typeof window.setTimeout> => {
				if (timeout === 120_000 && typeof handler === "function") {
					authorizationTimeout = () => {
						Reflect.apply(handler, window, args);
					};
					return 1 as unknown as ReturnType<typeof window.setTimeout>;
				}
				return nativeSetTimeout(
					handler,
					timeout,
					...args
				) as unknown as ReturnType<typeof window.setTimeout>;
			}
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(connectButton);
		await screen.findByText("Waiting for authorization…");

		listConnectionsMock.mockRejectedValue(transientError);
		await act(async () => {
			await queryClient.invalidateQueries({
				exact: true,
				queryKey: organizationAppConnectionQueryKeys.service(
					"org-acme",
					"linear"
				),
			});
		});
		expect(authorizationTimeout).toBeTypeOf("function");
		act(() => authorizationTimeout?.());

		expect(
			screen.getByText(
				"Linear authorization timed out. Start again when you are ready."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(connectButton.hasAttribute("disabled")).toBe(true);

		listConnectionsMock.mockResolvedValue({
			connections: [],
			currentUserId: "user-1",
			organizationId: "org-acme",
		});
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() =>
			expect(connectButton.hasAttribute("disabled")).toBe(false)
		);
		expect(
			screen.queryByText(
				"Linear authorization timed out. Start again when you are ready."
			)
		).toBeNull();
	});

	it("does not carry an authorization attempt into another App", async () => {
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		} as unknown as Window;
		vi.spyOn(window, "open").mockReturnValue(popup);

		const view = render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={linearApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const linearButton = await screen.findByRole("button", {
			name: "Connect Linear",
		});
		await waitFor(() =>
			expect(linearButton.hasAttribute("disabled")).toBe(false)
		);
		fireEvent.click(linearButton);
		await screen.findByText("Waiting for authorization…");

		view.rerender(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={figmaApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Connect Figma" })
			).toBeTruthy();
			expect(screen.queryByText("Waiting for authorization…")).toBeNull();
			expect(popup.close).toHaveBeenCalledOnce();
		});
	});

	it("uses OAuth as the default PostHog connection path", async () => {
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		} as unknown as Window;
		const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
		startMemberAuthorizationMock.mockResolvedValueOnce({
			authorizationUrl: "https://oauth.posthog.example/authorize",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={posthogApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect PostHog",
		});
		expect(screen.queryByLabelText("Personal API key")).toBeNull();
		await waitFor(() => {
			expect(connectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(connectButton);

		await waitFor(() => {
			expect(startMemberAuthorizationMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				service: "posthog",
			});
		});
		expect(connectMemberCredentialMock).not.toHaveBeenCalled();
		expect(openSpy).toHaveBeenCalled();
		expect(popup.location.href).toBe("https://oauth.posthog.example/authorize");
	});

	it("uses OAuth as the Figma connection path", async () => {
		const popup = {
			closed: false,
			close: vi.fn(),
			focus: vi.fn(),
			location: { href: "" },
			opener: window,
		} as unknown as Window;
		const openSpy = vi.spyOn(window, "open").mockReturnValue(popup);
		startMemberAuthorizationMock.mockResolvedValueOnce({
			authorizationUrl: "https://www.figma.com/oauth?state=test",
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={figmaApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const connectButton = await screen.findByRole("button", {
			name: "Connect Figma",
		});
		expect(screen.queryByLabelText("Personal access token")).toBeNull();
		await waitFor(() => {
			expect(connectButton.hasAttribute("disabled")).toBe(false);
		});
		fireEvent.click(connectButton);

		await waitFor(() => {
			expect(startMemberAuthorizationMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				service: "figma",
			});
		});
		expect(connectMemberCredentialMock).not.toHaveBeenCalled();
		expect(openSpy).toHaveBeenCalled();
		expect(popup.location.href).toBe("https://www.figma.com/oauth?state=test");
	});

	it("keeps a personal API key fallback for self-hosted PostHog", async () => {
		connectMemberCredentialMock.mockResolvedValueOnce({
			connection: {
				canDisconnect: true,
				connectionName:
					"org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__posthog",
				createdAtMs: 1,
				disconnectedAtMs: null,
				organizationId: "org-acme",
				ownerDisplayName: "Felix",
				scope: "member",
				service: "posthog",
				status: "active",
				updatedAtMs: 1,
				userId: "user-1",
			},
		});

		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={posthogApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", {
				name: "Use a personal API key instead",
			})
		);
		fireEvent.change(screen.getByLabelText("Personal API key"), {
			target: { value: "phx_test_secret" },
		});
		fireEvent.change(screen.getByLabelText("PostHog URL"), {
			target: { value: "https://posthog.example" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect PostHog" }));

		await waitFor(() => {
			expect(connectMemberCredentialMock).toHaveBeenCalledWith({
				authType: "api_key",
				organizationId: "org-acme",
				service: "posthog",
				values: {
					apiKey: "phx_test_secret",
					baseUrl: "https://posthog.example",
				},
			});
		});
		expect(startMemberAuthorizationMock).not.toHaveBeenCalled();
	});

	it("clears credential fields as soon as the submission settles", async () => {
		render(
			<TestQueryClientProvider>
				<CenterAgentAppConnectionCard
					app={notionApp}
					canManage={false}
					mode="member"
					organizationId="org-acme"
				/>
			</TestQueryClientProvider>
		);

		const apiKeyInput = await screen.findByLabelText(
			"Installation access token"
		);
		fireEvent.change(apiKeyInput, { target: { value: "notion_test_secret" } });
		fireEvent.click(screen.getByRole("button", { name: "Connect Notion" }));

		await waitFor(() => {
			expect(connectMemberCredentialMock).toHaveBeenCalledWith({
				authType: "api_key",
				organizationId: "org-acme",
				service: "notion",
				values: {
					apiKey: "notion_test_secret",
				},
			});
			expect(
				(screen.getByLabelText("Installation access token") as HTMLInputElement)
					.value
			).toBe("");
		});
	});
});

function requireAvailableApp(
	service: string
): Extract<AppDefinition, { availability: "available" }> {
	const app = findAppDefinition(service);
	if (!app || app.availability !== "available") {
		throw new Error(`${service} must be an available App in this test.`);
	}
	return app;
}

function createLinearConnection(
	overrides: Partial<{
		connectionName: string;
		ownerDisplayName: string;
		scope: "member" | "shared";
		status: "active" | "disconnected";
		userId: string;
	}> = {}
) {
	return {
		canDisconnect: true,
		connectionName: overrides.connectionName ?? "linear-member-connection",
		createdAtMs: 1,
		disconnectedAtMs: overrides.status === "disconnected" ? 2 : null,
		organizationId: "org-acme",
		ownerDisplayName: overrides.ownerDisplayName ?? "Felix",
		scope: overrides.scope ?? ("member" as const),
		service: "linear" as const,
		status: overrides.status ?? ("active" as const),
		updatedAtMs: 1,
		userId: overrides.userId ?? "user-1",
	};
}
