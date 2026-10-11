import {
	buildOpenMeldNavigationAction,
	connectorConnectionSchema,
	organizationProfileDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	ConnectorConnection,
	ConnectorService,
} from "@openmeld/schemas/types";
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
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { organizationPluginConnectionQueryKeys } from "#/query/organizations/plugin-connections";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import capturedProviders from "../../../../../packages/product-catalog/test-support/openconnector-providers.json";
import { PluginAgentAccess } from "./plugin-agent-access";
import type { PluginConnectionContinuationContext } from "./plugin-connection-continuation";
import { PluginConnectionMessageCard } from "./plugin-connection-message-card";

const CONNECT_BUTTON_NAME = /^Connect/;
const CONNECT_GITHUB_BUTTON_NAME = /^Connect GitHub$/;
const OAUTH_SETUP_UNAVAILABLE = /sign-in is not set up for this environment/;
const PERSONAL_ACCOUNT_REQUIRED = /Connect Gmail under Personal/;
const NO_IDENTITY_SUBSTITUTION =
	/your personal account will not be substituted/;

const api = vi.hoisted(() => ({
	list: vi.fn(),
	catalog: vi.fn(),
	directory: vi.fn(),
	githubMember: vi.fn(),
	githubShared: vi.fn(),
	member: vi.fn(),
	shared: vi.fn(),
	credential: vi.fn(),
	access: vi.fn(),
	updateAccess: vi.fn(),
	request: vi.fn(),
}));

vi.mock(
	"#/lib/organizations/connector-connections",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/organizations/connector-connections")
		>()),
		listCurrentOrganizationConnectorConnections: api.list,
		listCurrentOrganizationConnectorAppCatalog: api.catalog,
		startCurrentMemberGitHubAuthorization: api.githubMember,
		startCurrentOrganizationSharedGitHubAuthorization: api.githubShared,
		startCurrentMemberConnectorAuthorization: api.member,
		startCurrentOrganizationSharedConnectorAuthorization: api.shared,
		connectCurrentMemberConnectorCredential: api.credential,
		listPluginAccess: api.access,
		updatePluginAccess: api.updateAccess,
	})
);
vi.mock(
	"#/lib/organizations/organization-directory",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/organizations/organization-directory")
		>()),
		readCurrentOrganizationProfileDirectory: api.directory,
	})
);
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({
		requestJson: api.request,
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({
		to,
		children,
		...props
	}: {
		to: string;
		children?: React.ReactNode;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

function connection(
	service: ConnectorService,
	scope: "member" | "shared" = "member",
	status: ConnectorConnection["status"] = "active"
) {
	return connectorConnectionSchema.parse({
		canDisconnect: true,
		connectionName: `${service}-${scope}`,
		createdAtMs: 1,
		disconnectedAtMs: null,
		organizationId: "org-acme",
		ownerDisplayName: "Alex",
		scope,
		service,
		status,
		updatedAtMs: 1,
		userId: "user-alex",
	});
}
const NO_AGENT_ACCESS = {
	center_agent: "none",
	local_agent: "none",
	remote_agent: "none",
} as const;
function accessConnection(
	service: ConnectorService,
	scope: "member" | "shared" = "member",
	canManage = true
) {
	return {
		connectionName: `${service}-${scope}`,
		scope,
		canManage,
		revision: 0,
		policy: { center_agent: "read", local_agent: "none", remote_agent: "none" },
	};
}

function directory(role: string) {
	return organizationProfileDirectoryResponseSchema.parse({
		organizationId: "org-acme",
		generatedAt: "2026-09-26T00:00:00Z",
		agentProfiles: [],
		members: [
			{
				memberId: "member-alex",
				organizationId: "org-acme",
				userId: "user-alex",
				role,
				joinedAt: "2026-09-01T00:00:00Z",
				user: {
					id: "user-alex",
					name: "Alex",
					email: "alex@example.com",
					image: null,
				},
				humanProfile: null,
			},
		],
	});
}
function renderCard(
	options: {
		service?: ConnectorService;
		scope?: "member" | "shared" | "choose";
		orgSlug?: string;
		personal?: boolean;
		continuation?: PluginConnectionContinuationContext;
	} = {}
) {
	const organization = {
		id: "org-acme",
		name: "Acme",
		slug: "acme",
		isPersonal: options.personal ?? false,
	};
	const target = {
		kind: "plugin_connection",
		service: options.service ?? "github",
		scope: options.scope ?? "choose",
	} as const;
	const action = {
		...buildOpenMeldNavigationAction({
			organizationWebUrl: "https://openmeld.ai/o/acme",
			target,
		}),
		target,
	};
	const queryClient = createTestQueryClient();
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AppOrganizationProvider
				scope={{
					access: "authorized",
					account: { name: "Alex" },
					activeOrganization: organization,
					currentOrganization: organization,
					currentUserId: "user-alex",
					organizations: [organization],
					storageScope: "org-acme",
				}}
			>
				<PluginConnectionMessageCard
					action={action}
					continuation={options.continuation}
					organizationSlug={options.orgSlug ?? "acme"}
				/>
			</AppOrganizationProvider>
		</TestQueryClientProvider>
	);
}

describe("Plugin connection in a conversation", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		api.catalog.mockResolvedValue({
			organizationId: "org-acme",
			providers: capturedProviders.data,
		});
		api.list.mockResolvedValue({
			organizationId: "org-acme",
			currentUserId: "user-alex",
			connections: [],
		});
		api.directory.mockResolvedValue(directory("member"));
		api.access.mockResolvedValue({ connections: [] });
		api.githubMember.mockResolvedValue({
			authorizationUrl: "https://github.example/authorize",
			connection: connection("github", "member", "pending"),
		});
		api.githubShared.mockResolvedValue({
			authorizationUrl: "https://github.example/install",
			connection: connection("github", "shared", "pending"),
			expiresAtMs: Date.now() + 600_000,
		});
		api.member.mockImplementation(
			async ({ service }: { service: ConnectorService }) => ({
				authorizationUrl: "https://provider.example/authorize",
				connection: connection(service, "member", "pending"),
			})
		);
		api.credential.mockImplementation(
			async ({ service }: { service: ConnectorService }) => ({
				connection: connection(service),
			})
		);
		vi.spyOn(window, "open").mockReturnValue({
			closed: false,
			opener: null,
			location: { href: "about:blank" },
			focus: vi.fn(),
			close: vi.fn(),
		} as unknown as Window);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it.each([
		"slack",
		"lark",
		"feishu",
	])("shows unconfigured %s in the message without starting OAuth", async (service) => {
		renderCard({ service, scope: "member" });
		fireEvent.click(screen.getByRole("button", { name: CONNECT_BUTTON_NAME }));
		const dialog = await screen.findByRole("dialog");
		await within(dialog).findByText(OAUTH_SETUP_UNAVAILABLE);
		expect(
			within(dialog)
				.getByRole("button", {
					name: new RegExp(`^Connect ${service}$`, "i"),
				})
				.hasAttribute("disabled")
		).toBe(true);
		expect(api.member).not.toHaveBeenCalled();
	});

	it("chooses a personal Gmail account without offering organization access", async () => {
		api.directory.mockResolvedValue(directory("owner"));
		renderCard({ service: "gmail" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review Gmail" })
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(
			await within(dialog).findByRole("button", { name: "Connect Gmail" })
		);
		await waitFor(() =>
			expect(api.member).toHaveBeenCalledWith({
				organizationId: "org-acme",
				service: "gmail",
			})
		);
		expect(
			within(dialog).queryByRole("button", { name: "For the organization" })
		).toBeNull();
		expect(api.shared).not.toHaveBeenCalled();
	});

	it("does not substitute personal Gmail for an explicit organization request", async () => {
		api.directory.mockResolvedValue(directory("owner"));
		renderCard({ service: "gmail", scope: "shared" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review Gmail" })
		);
		const dialog = await screen.findByRole("dialog");
		await within(dialog).findByText(PERSONAL_ACCOUNT_REQUIRED);
		expect(
			within(dialog).queryByRole("button", { name: "Connect Gmail" })
		).toBeNull();
		expect(api.shared).not.toHaveBeenCalled();
		expect(api.member).not.toHaveBeenCalled();
	});

	it("opens a dynamically discovered Plugin in the conversation", async () => {
		api.catalog.mockResolvedValue({
			organizationId: "org-acme",
			providers: capturedProviders.data
				.filter((item) => item.service === "linear")
				.map((item) => ({ ...item, service: "catalog_linear" })),
		});
		renderCard({ service: "catalog_linear", scope: "member" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review catalog_linear" })
		);
		const dialog = await screen.findByRole("dialog");
		expect(
			(
				await within(dialog).findByRole("button", { name: "Connect Linear" })
			).hasAttribute("disabled")
		).toBe(false);
	});

	it.each([
		{ role: "owner", channel: false },
		{ role: "admin", channel: true },
		{ role: "member", channel: false },
		{ role: "member", channel: true },
	])("submits the chosen shared account with both connections for $role (channel=$channel)", async ({
		role,
		channel,
	}) => {
		api.directory.mockResolvedValue(directory(role));
		api.list.mockResolvedValue({
			organizationId: "org-acme",
			currentUserId: "user-alex",
			connections: [
				connection("github", "member"),
				connection("github", "shared"),
			],
		});
		api.access.mockResolvedValue({
			organizationId: "org-acme",
			connections: [
				accessConnection("github", "member"),
				accessConnection("github", "shared", role !== "member"),
			],
		});
		api.request.mockRejectedValueOnce(
			new Error("Submission could not be confirmed. Retry the same request.")
		);
		api.request.mockResolvedValueOnce({ status: "requested" });
		renderCard({
			continuation: channel
				? { channelRequestId: "request-1" }
				: { spaceId: "space-1", sourceSignalId: "reply-1" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		const choose = await screen.findByRole("button", {
			name: "For the organization",
		});
		expect((choose as HTMLButtonElement).disabled).toBe(false);
		expect(api.request).not.toHaveBeenCalled();
		fireEvent.click(choose);
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Continue original task",
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		await screen.findByRole("alert");
		fireEvent.click(
			screen.getByRole("button", { name: "Continue original task" })
		);
		await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
		const first = api.request.mock.calls[0]?.[0];
		expect(JSON.parse(first.body)).toEqual(
			channel
				? { requestId: "request-1", scope: "shared" }
				: { sourceSignalId: "reply-1", service: "github", scope: "shared" }
		);
		expect(api.request.mock.calls[1]?.[0].body).toBe(first.body);
		expect(api.githubMember).not.toHaveBeenCalled();
		expect(api.githubShared).not.toHaveBeenCalled();
		expect(api.updateAccess).not.toHaveBeenCalled();
	});

	it("loads only when opened and gives an ordinary member the existing personal GitHub authorization", async () => {
		renderCard();
		expect(api.list).not.toHaveBeenCalled();
		expect(api.directory).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		const dialog = await screen.findByRole("dialog");
		expect(
			await within(dialog).findByRole("heading", { name: "Your GitHub" })
		).toBeTruthy();
		expect(
			within(dialog).queryByRole("button", { name: "For the organization" })
		).toBeNull();
		expect(api.githubMember).not.toHaveBeenCalled();
		fireEvent.click(
			await within(dialog).findByRole("button", {
				name: CONNECT_GITHUB_BUTTON_NAME,
			})
		);
		await waitFor(() =>
			expect(api.githubMember).toHaveBeenCalledExactlyOnceWith({
				organizationId: "org-acme",
			})
		);
		expect(api.githubShared).not.toHaveBeenCalled();
		expect(api.access).not.toHaveBeenCalled();
	});

	it.each([
		"owner",
		"admin",
	])("asks a %s once before creating organization access", async (role) => {
		api.directory.mockResolvedValue(directory(role));
		renderCard();
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "For the organization" })
		);
		expect(api.githubShared).not.toHaveBeenCalled();
		fireEvent.click(
			await screen.findByRole("button", { name: "Install GitHub Plugin" })
		);
		await waitFor(() =>
			expect(api.githubShared).toHaveBeenCalledExactlyOnceWith({
				existingInstallation: false,
				organizationId: "org-acme",
			})
		);
		expect(api.githubMember).not.toHaveBeenCalled();
	});

	it("does not widen an explicit personal request or require organization-management lookup", async () => {
		api.directory.mockResolvedValue(directory("owner"));
		renderCard({ scope: "member" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		expect(
			await screen.findByRole("heading", { name: "Your GitHub" })
		).toBeTruthy();
		expect(api.directory).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: "For the organization" })
		).toBeNull();
	});

	it("shows explicit permissions after credential setup and does not continue on an unsaved or failed grant", async () => {
		const item = {
			...accessConnection("posthog"),
			policy: { ...NO_AGENT_ACCESS } as {
				center_agent: "none" | "read" | "write";
				local_agent: "none";
				remote_agent: "none";
			},
		};
		api.access.mockImplementation(async () => ({
			organizationId: "org-acme",
			connections: [{ ...item }],
		}));
		api.credential.mockImplementation(() => {
			api.list.mockResolvedValue({
				organizationId: "org-acme",
				currentUserId: "user-alex",
				connections: [connection("posthog")],
			});
			return Promise.resolve({ connection: connection("posthog") });
		});
		api.updateAccess.mockRejectedValueOnce(
			new Error("Permission save failed.")
		);
		api.updateAccess.mockImplementationOnce(({ body }) => {
			item.policy = body.policy;
			item.revision += 1;
			return Promise.resolve(item);
		});
		api.request.mockResolvedValue({ status: "requested" });
		renderCard({
			service: "posthog",
			scope: "member",
			continuation: { spaceId: "space-1", sourceSignalId: "reply-1" },
		});
		expect(api.access).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review PostHog" })
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Use credentials",
			})
		);
		fireEvent.change(screen.getByLabelText("Base URL"), {
			target: { value: "https://posthog.example" },
		});
		fireEvent.change(await screen.findByLabelText("Personal API Key"), {
			target: { value: "fictional-key" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Connect PostHog" }));
		expect(await screen.findByText("No Agent has access yet.")).toBeTruthy();
		expect(
			screen.queryByText("Agent access", { selector: "summary" })
		).toBeNull();
		expect(api.updateAccess).not.toHaveBeenCalled();
		expect(api.request).not.toHaveBeenCalled();
		const continueButton = () =>
			screen.getByRole("button", {
				name: "Continue original task",
			}) as HTMLButtonElement;
		expect(continueButton().disabled).toBe(true);
		fireEvent.click(screen.getByLabelText("Center Agent"));
		fireEvent.click(await screen.findByRole("option", { name: "Read only" }));
		expect(continueButton().disabled).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Save access" }));
		expect(await screen.findByText("Permission save failed.")).toBeTruthy();
		expect(continueButton().disabled).toBe(true);
		expect(api.request).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Save access" }));
		await waitFor(() => expect(continueButton().disabled).toBe(false));
		expect(api.updateAccess).toHaveBeenLastCalledWith({
			organizationId: "org-acme",
			service: "posthog",
			body: {
				connectionName: "posthog-member",
				expectedRevision: 0,
				policy: { ...NO_AGENT_ACCESS, center_agent: "read" },
			},
		});
		expect(api.request).not.toHaveBeenCalled();
		fireEvent.click(continueButton());
		await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
		expect(JSON.parse(api.request.mock.calls[0][0].body)).toMatchObject({
			scope: "member",
			service: "posthog",
			sourceSignalId: "reply-1",
		});
	});

	it("shows a non-manager the actual shared policy without offering to save or continue with no access", async () => {
		api.list.mockResolvedValue({
			organizationId: "org-acme",
			currentUserId: "user-alex",
			connections: [connection("github", "shared")],
		});
		api.access.mockResolvedValue({
			organizationId: "org-acme",
			connections: [
				{
					...accessConnection("github", "shared", false),
					policy: NO_AGENT_ACCESS,
				},
			],
		});
		renderCard({
			scope: "shared",
			continuation: { channelRequestId: "request-1" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		expect(
			await screen.findByText(
				"An organization owner or admin manages this access."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Save access" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Continue original task",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(api.updateAccess).not.toHaveBeenCalled();
		expect(api.request).not.toHaveBeenCalled();
	});

	it("never substitutes personal access for an organization-only task", async () => {
		renderCard({ scope: "shared" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		expect(await screen.findByText(NO_IDENTITY_SUBSTITUTION)).toBeTruthy();
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).queryByRole("button", { name: CONNECT_BUTTON_NAME })
		).toBeNull();
		expect(
			within(dialog).queryByRole("button", { name: "Install GitHub Plugin" })
		).toBeNull();
		expect(api.githubMember).not.toHaveBeenCalled();
		expect(api.githubShared).not.toHaveBeenCalled();
	});

	it("refreshes every setup view after saving and discards an old draft after reauthorization", async () => {
		const client = createTestQueryClient();
		const member = accessConnection("linear");
		member.policy = { ...NO_AGENT_ACCESS };
		const shared = {
			...accessConnection("linear", "shared"),
			policy: { ...NO_AGENT_ACCESS },
		};
		const connected = {
			organizationId: "org-acme",
			currentUserId: "user-alex",
			connections: [connection("linear"), connection("linear", "shared")],
		};
		api.list.mockResolvedValue(connected);
		api.access.mockImplementation(async () => ({
			organizationId: "org-acme",
			connections: [{ ...member }, { ...shared }],
		}));
		api.updateAccess.mockImplementation(({ body }) => {
			member.policy = body.policy;
			member.revision += 1;
			return Promise.resolve({ ...member });
		});
		render(
			<TestQueryClientProvider queryClient={client}>
				<div data-testid="all-scopes">
					<PluginAgentAccess
						organizationId="org-acme"
						organizationName="Acme"
						scope="all"
						service="linear"
					/>
				</div>
				<div data-testid="member-scope">
					<PluginAgentAccess
						organizationId="org-acme"
						organizationName="Acme"
						scope="member"
						service="linear"
					/>
				</div>
			</TestQueryClientProvider>
		);
		const all = within(screen.getByTestId("all-scopes"));
		const single = within(screen.getByTestId("member-scope"));
		await single.findByText("No Agent has access yet.");
		const allMember = within(
			await all.findByRole("group", { name: "Agents using your account" })
		);
		fireEvent.click(allMember.getByLabelText("Center Agent"));
		fireEvent.click(await screen.findByRole("option", { name: "Read only" }));
		fireEvent.click(allMember.getByRole("button", { name: "Save access" }));
		await waitFor(() =>
			expect(single.getByLabelText("Center Agent").textContent).toContain(
				"Read only"
			)
		);
		expect(api.updateAccess).toHaveBeenCalledOnce();
		fireEvent.click(single.getByLabelText("Center Agent"));
		fireEvent.click(
			await screen.findByRole("option", { name: "Read and write" })
		);
		expect(
			(single.getByRole("button", { name: "Save access" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
		const next = {
			...connected,
			connections: connected.connections.map((item) => ({
				...item,
				updatedAtMs: 2,
			})),
		};
		api.list.mockResolvedValue(next);
		await act(async () => {
			client.setQueryData(
				organizationPluginConnectionQueryKeys.service("org-acme", "linear"),
				next
			);
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(single.getByLabelText("Center Agent").textContent).toContain(
				"Read only"
			)
		);
		expect(
			(single.getByRole("button", { name: "Save access" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		expect(api.updateAccess).toHaveBeenCalledOnce();
		// Losing organization administration does not turn an unsaved draft into
		// the readonly authority projection; the saved all-none policy must win.
		const sharedGroup = () =>
			within(all.getByRole("group", { name: "Agents in Acme" }));
		fireEvent.click(sharedGroup().getByLabelText("Center Agent"));
		fireEvent.click(
			await screen.findByRole("option", { name: "Read and write" })
		);
		shared.canManage = false;
		await act(async () => {
			await client.invalidateQueries({
				queryKey: [
					...organizationPluginConnectionQueryKeys.service(
						"org-acme",
						"linear"
					),
					"access",
				],
			});
		});
		await waitFor(() => {
			const currentShared = sharedGroup();
			expect(
				currentShared.getByText(
					"An organization owner or admin manages this access."
				)
			).toBeTruthy();
			expect(
				currentShared.getByLabelText("Center Agent").textContent
			).toContain("No access");
			expect(
				currentShared.queryByRole("button", { name: "Save access" })
			).toBeNull();
		});
		expect(api.updateAccess).toHaveBeenCalledOnce();
	});

	it("reuses an existing connection without another authorization", async () => {
		api.list.mockResolvedValue({
			organizationId: "org-acme",
			currentUserId: "user-alex",
			connections: [connection("linear")],
		});
		renderCard({ service: "linear" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review Linear" })
		);
		expect(
			await screen.findByRole("button", { name: "Disconnect Linear" })
		).toBeTruthy();
		expect(
			within(screen.getByRole("dialog")).queryByRole("button", {
				name: "Connect Linear",
			})
		).toBeNull();
		expect(api.member).not.toHaveBeenCalled();
	});

	it("uses the ordinary OAuth adapter for non-GitHub Plugins", async () => {
		renderCard({ service: "linear", scope: "member" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review Linear" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Connect Linear" })
		);
		await waitFor(() =>
			expect(api.member).toHaveBeenCalledExactlyOnceWith({
				organizationId: "org-acme",
				service: "linear",
			})
		);
		expect(api.githubMember).not.toHaveBeenCalled();
	});

	it("keeps credential fallback in the existing private form", async () => {
		renderCard({ service: "cloudflare_r2", scope: "member" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review Cloudflare R2" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Use credentials" })
		);
		fireEvent.change(screen.getByLabelText("API Token"), {
			target: { value: "test-only-token" },
		});
		fireEvent.change(screen.getByLabelText("Account ID"), {
			target: { value: "test-account" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Connect Cloudflare R2" })
		);
		await waitFor(() =>
			expect(api.credential).toHaveBeenCalledWith({
				organizationId: "org-acme",
				service: "cloudflare_r2",
				authType: "custom_credential",
				values: { apiKey: "test-only-token", accountId: "test-account" },
			})
		);
		expect(api.member).not.toHaveBeenCalled();
	});

	it("does not offer an impossible team choice in a personal workspace", async () => {
		renderCard({ personal: true });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		expect(
			await screen.findByRole("heading", { name: "Your GitHub" })
		).toBeTruthy();
		expect(api.directory).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: "For the organization" })
		).toBeNull();
	});

	it("leaves a cross-organization card as a safe navigation link", () => {
		renderCard({ orgSlug: "another-organization" });
		expect(
			screen
				.getByRole("link", { name: "Open Plugin connection" })
				.getAttribute("href")
		).toBe("https://openmeld.ai/o/acme/plugins/github");
		expect(api.list).not.toHaveBeenCalled();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("blocks setup when the current identity cannot be confirmed", async () => {
		api.list.mockResolvedValue({
			organizationId: "org-acme",
			currentUserId: "another-user",
			connections: [],
		});
		renderCard();
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(
			within(screen.getByRole("dialog")).queryByRole("button", {
				name: CONNECT_BUTTON_NAME,
			})
		).toBeNull();
		expect(api.githubMember).not.toHaveBeenCalled();
	});
});
