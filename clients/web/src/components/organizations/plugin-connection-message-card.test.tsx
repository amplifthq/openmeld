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
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import type { PluginConnectionContinuationContext } from "./plugin-connection-continuation";
import { PluginConnectionMessageCard } from "./plugin-connection-message-card";

const CONNECT_BUTTON_NAME = /^Connect/;
const CONNECT_GITHUB_BUTTON_NAME = /^Connect GitHub$/;
const NO_IDENTITY_SUBSTITUTION =
	/your personal account will not be substituted/;

const api = vi.hoisted(() => ({
	list: vi.fn(),
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
		fireEvent.click(
			await screen.findByRole("button", { name: "Continue original task" })
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

	it("loads Agent access only when expanded and never grants access just by opening setup", async () => {
		renderCard({ scope: "member" });
		fireEvent.click(
			screen.getByRole("button", { name: "Connect or review GitHub" })
		);
		const summary = await screen.findByText("Agent access", {
			selector: "summary",
		});
		expect(api.access).not.toHaveBeenCalled();
		fireEvent.click(summary);
		await waitFor(() => expect(api.access).toHaveBeenCalledOnce());
		expect(api.access).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-acme",
				service: "github",
				scope: "member",
			})
		);
		expect(api.updateAccess).not.toHaveBeenCalled();
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
			await screen.findByRole("button", { name: "Use an API token instead" })
		);
		fireEvent.change(screen.getByLabelText("API token"), {
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
