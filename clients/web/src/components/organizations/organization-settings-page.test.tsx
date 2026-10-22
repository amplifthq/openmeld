import type { AccountOrganizationContext } from "@openmeld/schemas";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	OrganizationScopeAuthorized,
	OrganizationSummary,
} from "#/lib/organizations/organization-types";
import { accountOrganizationContextQueryKey } from "#/query/organizations/account-organization-context";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OrganizationSettingsPage } from "./organization-settings-page";

const REMOVE_BUTTON_NAME = /^Remove /;
const AUTOMATIC_AGENT_AUTHORIZATION_PATTERN =
	/automatically authorize my new Agent Profiles/i;

const getActiveOrganizationMemberRoleMock = vi.hoisted(() => vi.fn());
const getOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
const deleteOrganizationMock = vi.hoisted(() => vi.fn());
const clearOrganizationPersistenceMock = vi.hoisted(() => vi.fn());
const listOrganizationInvitationsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const routerInvalidateMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationDirectoryMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationInformationProtectionMock = vi.hoisted(() =>
	vi.fn()
);
const removeOrganizationMemberMock = vi.hoisted(() => vi.fn());
const setCurrentOrganizationInformationProtectionMock = vi.hoisted(() =>
	vi.fn()
);
const createOrganizationLogoCropDraftMock = vi.hoisted(() => vi.fn());
const cropOrganizationLogoMock = vi.hoisted(() => vi.fn());
const releaseOrganizationLogoCropDraftMock = vi.hoisted(() => vi.fn());
const removeCurrentOrganizationLogoMock = vi.hoisted(() => vi.fn());
const updateCurrentOrganizationLogoMock = vi.hoisted(() => vi.fn());
const updateOrganizationMock = vi.hoisted(() => vi.fn());

let currentOrganization: OrganizationSummary;
let organizations: OrganizationSummary[];

function makeAccountContext(): AccountOrganizationContext {
	const scope = makeOrganizationScope();
	return {
		account: {
			email: scope.account.email ?? null,
			name: scope.account.name ?? null,
			image: scope.account.image ?? null,
		},
		currentUserId: scope.currentUserId,
		organizations: scope.organizations,
		defaultOrganizationId: scope.activeOrganization?.id ?? null,
	};
}

function makeOrganizationScope(): OrganizationScopeAuthorized {
	return {
		access: "authorized",
		account: {
			email: "owner@example.com",
			image: null,
			name: "Owner",
		},
		activeOrganization: currentOrganization,
		currentOrganization,
		currentUserId: "user-owner",
		organizations,
		storageScope: "org-acme",
	};
}

vi.mock("#/lib/organizations/organization-join-requests", () => ({
	requestOrganizationJoinRequests: vi.fn(async () => []),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useNavigate: () => navigateMock,
	useLocation: () => ({}),
	useRouter: () => ({ invalidate: routerInvalidateMock }),
}));

vi.mock("@openmeld/ui/components/dialog", () => ({
	Dialog: ({
		children,
		open,
	}: {
		children: ReactNode;
		onOpenChange?: (open: boolean) => void;
		open?: boolean;
	}) => (open ? <div data-testid="dialog-root">{children}</div> : null),
	DialogContent: ({ children }: { children: ReactNode }) => (
		<div role="dialog">{children}</div>
	),
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	DialogFooter: ({ children }: { children: ReactNode }) => (
		<footer>{children}</footer>
	),
	DialogHeader: ({ children }: { children: ReactNode }) => (
		<header>{children}</header>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@openmeld/ui/components/alert-dialog", () => ({
	AlertDialog: ({
		children,
		open,
	}: {
		children: ReactNode;
		onOpenChange?: (open: boolean) => void;
		open?: boolean;
	}) => (open ? <div data-testid="alert-dialog-root">{children}</div> : null),
	AlertDialogAction: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	AlertDialogCancel: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div role="alertdialog">{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<footer>{children}</footer>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<header>{children}</header>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));

vi.mock("@openmeld/ui/components/switch", () => ({
	Switch: ({
		"aria-label": ariaLabel,
		checked,
		disabled,
		onCheckedChange,
	}: {
		"aria-label": string;
		checked: boolean;
		disabled?: boolean;
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<button
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={() => onCheckedChange?.(!checked)}
			role="switch"
			type="button"
		/>
	),
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "owner@example.com",
		image: null,
		name: "Owner",
	}),
}));

vi.mock("#/query/persistence/app-query-persistence", () => ({
	resolveAppQueryPersistenceController: () => ({
		clearOrganization: clearOrganizationPersistenceMock,
	}),
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	cancelOrganizationInvitation: vi.fn(),
	deleteOrganization: deleteOrganizationMock,
	getActiveOrganizationMemberRole: getActiveOrganizationMemberRoleMock,
	getOrganizationJoinLink: getOrganizationJoinLinkMock,
	listOrganizationInvitations: listOrganizationInvitationsMock,
	removeOrganizationMember: removeOrganizationMemberMock,
	resetOrganizationJoinLink: vi.fn(),
	revokeOrganizationJoinLink: vi.fn(),
	updateOrganization: updateOrganizationMock,
	updateOrganizationMemberRole: vi.fn(),
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

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization,
		currentUserId: "user-owner",
		organizations,
	}),
}));

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationDirectory: readCurrentOrganizationDirectoryMock,
}));

vi.mock("#/lib/organizations/organization-information-protection", () => ({
	readCurrentOrganizationInformationProtection:
		readCurrentOrganizationInformationProtectionMock,
	setCurrentOrganizationInformationProtection:
		setCurrentOrganizationInformationProtectionMock,
}));

vi.mock("#/lib/organizations/organization-logo", () => ({
	removeCurrentOrganizationLogo: removeCurrentOrganizationLogoMock,
	updateCurrentOrganizationLogo: updateCurrentOrganizationLogoMock,
}));

vi.mock(
	"#/lib/organizations/organization-logo-crop",
	async (importOriginal) => ({
		...(await importOriginal()),
		createOrganizationLogoCropDraft: createOrganizationLogoCropDraftMock,
		cropOrganizationLogo: cropOrganizationLogoMock,
		releaseOrganizationLogoCropDraft: releaseOrganizationLogoCropDraftMock,
	})
);

vi.mock("./organization-invitation-form", () => ({
	OrganizationInvitationForm: () => <form>Invite form</form>,
}));

describe("OrganizationSettingsPage", () => {
	beforeEach(() => {
		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		organizations = [
			{
				id: "org-personal",
				isPersonal: true,
				name: "Owner",
				slug: "owner",
			},
			currentOrganization,
		];
		clearOrganizationPersistenceMock.mockReset().mockResolvedValue(undefined);
		deleteOrganizationMock.mockReset().mockResolvedValue(undefined);
		getActiveOrganizationMemberRoleMock.mockReset().mockResolvedValue("member");
		getOrganizationJoinLinkMock.mockReset().mockResolvedValue(null);
		listOrganizationInvitationsMock.mockReset().mockResolvedValue([]);
		navigateMock.mockReset().mockResolvedValue(undefined);
		routerInvalidateMock.mockReset().mockResolvedValue(undefined);
		readCurrentOrganizationDirectoryMock.mockReset().mockResolvedValue({
			agentProfiles: [],
			members: [],
		});
		readCurrentOrganizationInformationProtectionMock
			.mockReset()
			.mockResolvedValue({
				organizationId: "org-acme",
				protectedInformation:
					"Customer contract pricing and unreleased Board forecasts.",
				updatedAt: "2026-07-21T00:00:00.000Z",
				updatedByUserId: "user-admin",
			});
		removeOrganizationMemberMock.mockReset().mockResolvedValue(undefined);
		setCurrentOrganizationInformationProtectionMock
			.mockReset()
			.mockImplementation(
				async (input: { protectedInformation: string | null }) => ({
					organizationId: "org-acme",
					protectedInformation: input.protectedInformation,
					updatedAt: "2026-07-21T00:01:00.000Z",
					updatedByUserId: "user-admin",
				})
			);
		createOrganizationLogoCropDraftMock.mockReset().mockResolvedValue({
			height: 800,
			previewUrl: "blob:organization-logo",
			width: 1200,
		});
		cropOrganizationLogoMock.mockReset().mockResolvedValue({
			bytes: new Blob(["webp"], { type: "image/webp" }),
			mimeType: "image/webp",
		});
		releaseOrganizationLogoCropDraftMock.mockReset();
		removeCurrentOrganizationLogoMock
			.mockReset()
			.mockResolvedValue({ logo: null, ok: true });
		updateCurrentOrganizationLogoMock.mockReset().mockResolvedValue({
			logo: "https://gateway.example/v1/organization-logos/org-acme/logo.webp",
			ok: true,
		});
		updateOrganizationMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("lets only the owner crop and upload an Organization logo", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("owner");
		const queryClient = createTestQueryClient();
		const organizationScopeQueryKey = accountOrganizationContextQueryKey;
		queryClient.setQueryData(organizationScopeQueryKey, makeAccountContext());
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByRole("heading", { name: "Organization logo" })
		).toBeTruthy();
		const file = new File(["png"], "acme.png", { type: "image/png" });
		fireEvent.change(await screen.findByLabelText("Choose organization logo"), {
			target: { files: [file] },
		});

		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByRole("heading", {
				name: "Adjust organization logo",
			})
		).toBeTruthy();
		expect(within(dialog).getByLabelText("Zoom")).toBeTruthy();
		expect(within(dialog).getByLabelText("Horizontal position")).toBeTruthy();
		expect(within(dialog).getByLabelText("Vertical position")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Save logo" }));

		await waitFor(() => {
			expect(cropOrganizationLogoMock).toHaveBeenCalledWith({
				crop: { positionX: 0, positionY: 0, zoom: 1 },
				file,
			});
			expect(updateCurrentOrganizationLogoMock).toHaveBeenCalledWith({
				bytes: expect.any(Blob),
				mimeType: "image/webp",
				organizationId: "org-acme",
			});
			expect(routerInvalidateMock).toHaveBeenCalledWith({ sync: true });
			expect(
				queryClient.getQueryData<AccountOrganizationContext>(
					organizationScopeQueryKey
				)
			).toMatchObject({
				organizations: [
					{ id: "org-personal" },
					{
						id: "org-acme",
						logo: "https://gateway.example/v1/organization-logos/org-acme/logo.webp",
					},
				],
			});
		});
	});

	it("keeps Organization logo controls read-only for non-owners", async () => {
		currentOrganization = {
			...currentOrganization,
			logo: "https://gateway.example/v1/organization-logos/org-acme/logo.webp",
		};
		organizations = [
			organizations[0] as OrganizationSummary,
			currentOrganization,
		];
		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText(
				"Only the organization owner can change the logo."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("img", { name: "Acme logo" }).parentElement?.className
		).toContain("rounded-sm");
		expect(screen.queryByLabelText("Choose organization logo")).toBeNull();
		expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
	});

	it("keeps member role controls read-only for members and editable for admins", async () => {
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			members: [
				{
					humanProfile: null,
					memberId: "member-ada",
					role: "member",
					user: { email: "ada@example.com", name: "Ada Lovelace" },
					userId: "user-ada",
				},
			],
		});

		getActiveOrganizationMemberRoleMock.mockResolvedValue("member");
		const memberView = render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		await screen.findByText("Ada Lovelace");
		expect(
			screen.queryByRole("combobox", { name: "Role for Ada Lovelace" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Save role" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Remove Ada Lovelace" })
		).toBeNull();
		memberView.unmount();

		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");
		const adminView = render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		await screen.findByText("Ada Lovelace");
		const roleSelect = screen.getByRole("combobox", {
			name: "Role for Ada Lovelace",
		}) as HTMLButtonElement;
		expect(roleSelect.disabled).toBe(false);
		fireEvent.click(roleSelect);
		fireEvent.click(await screen.findByRole("option", { name: "Admin" }));
		expect(
			(screen.getByRole("button", { name: "Save role" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
		expect(
			screen.getByRole("button", { name: "Remove Ada Lovelace" })
		).toBeTruthy();
		adminView.unmount();
	});

	it("does not reveal or fetch information protection settings for members", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("member");

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="security" />
			</TestQueryClientProvider>
		);

		await screen.findByRole("heading", { name: "Security" });
		await waitFor(() => {
			expect(getActiveOrganizationMemberRoleMock).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole("heading", { name: "Information protection" })
		).toBeNull();
		expect(
			readCurrentOrganizationInformationProtectionMock
		).not.toHaveBeenCalled();
	});

	it("lets an admin update and clear additional protected information", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="security" />
			</TestQueryClientProvider>
		);

		const policy = await screen.findByLabelText(
			"Additional protected information"
		);
		await waitFor(() => {
			expect((policy as HTMLTextAreaElement).value).toBe(
				"Customer contract pricing and unreleased Board forecasts."
			);
		});
		const protectionSection = policy.closest("section");
		expect(protectionSection).not.toBeNull();
		const protectionControls = within(protectionSection as HTMLElement);

		fireEvent.change(policy, {
			target: { value: "  Private renewal pricing.  " },
		});
		fireEvent.click(
			protectionControls.getByRole("button", { name: "Save changes" })
		);

		await waitFor(() => {
			expect(
				setCurrentOrganizationInformationProtectionMock
			).toHaveBeenCalledWith({
				organizationId: "org-acme",
				protectedInformation: "Private renewal pricing.",
			});
		});

		fireEvent.change(policy, { target: { value: "" } });
		fireEvent.click(
			protectionControls.getByRole("button", { name: "Save changes" })
		);

		await waitFor(() => {
			expect(
				setCurrentOrganizationInformationProtectionMock
			).toHaveBeenLastCalledWith({
				organizationId: "org-acme",
				protectedInformation: null,
			});
		});
	});

	it("never offers Remove for owners or the current member", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			members: [
				{
					humanProfile: null,
					memberId: "member-owner",
					role: "owner",
					user: { email: "owner@example.com", name: "Owner" },
					userId: "user-some-owner",
				},
				{
					humanProfile: null,
					memberId: "member-current",
					role: "admin",
					user: { email: "admin@example.com", name: "Current Admin" },
					userId: "user-owner",
				},
				{
					humanProfile: null,
					memberId: "member-ada",
					role: "member",
					user: { email: "ada@example.com", name: "Ada Lovelace" },
					userId: "user-ada",
				},
			],
		});

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		await screen.findByText("Ada Lovelace");
		expect(screen.queryByRole("button", { name: "Remove Owner" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Remove Current Admin" })
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Remove Ada Lovelace" })
		).toBeTruthy();
	});

	it("confirms member removal and refreshes the organization directory", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			members: [
				{
					humanProfile: null,
					memberId: "member-ada",
					role: "member",
					user: { email: "ada@example.com", name: "Ada Lovelace" },
					userId: "user-ada",
				},
			],
		});

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Remove Ada Lovelace" })
		);
		const dialog = screen.getByRole("alertdialog");
		expect(
			within(dialog).getByRole("heading", { name: "Remove Ada Lovelace?" })
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"This action cannot be undone. Ada Lovelace will immediately lose access to this organization."
			)
		).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Remove member" })
		);

		await waitFor(() => {
			expect(removeOrganizationMemberMock).toHaveBeenCalledWith({
				memberIdOrEmail: "member-ada",
				organizationId: "org-acme",
			});
			expect(readCurrentOrganizationDirectoryMock).toHaveBeenCalledTimes(2);
		});
	});

	it("shows the server removal error in the member row", async () => {
		const guardMessage =
			"This member activated the organization's Center Agent. Revoke or re-designate the Center Agent before removing them.";
		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");
		removeOrganizationMemberMock.mockRejectedValue(new Error(guardMessage));
		readCurrentOrganizationDirectoryMock.mockResolvedValue({
			agentProfiles: [],
			members: [
				{
					humanProfile: null,
					memberId: "member-ada",
					role: "member",
					user: { email: "ada@example.com", name: "Ada Lovelace" },
					userId: "user-ada",
				},
			],
		});

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Remove Ada Lovelace" })
		);
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Remove member",
			})
		);

		expect(await screen.findByText(guardMessage)).toBeTruthy();
	});

	it("explains the three organization roles with the managed capability copy", async () => {
		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="members" />
			</TestQueryClientProvider>
		);

		expect(
			await screen.findByText("Manage members and their organization roles.")
		).toBeTruthy();
		expect(
			screen.getByText(
				"Owner — Full control, including deleting the organization."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Admin — Manage members, channels, apps, memory, and the Center Agent."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Member — Use spaces and create routines; organization settings are read-only."
			)
		).toBeTruthy();
	});

	it("lets the owner remove the current Organization logo", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("owner");
		currentOrganization = {
			...currentOrganization,
			logo: "https://gateway.example/v1/organization-logos/org-acme/logo.webp",
		};
		organizations = [
			organizations[0] as OrganizationSummary,
			currentOrganization,
		];
		const queryClient = createTestQueryClient();
		const organizationScopeQueryKey = accountOrganizationContextQueryKey;
		queryClient.setQueryData(organizationScopeQueryKey, makeAccountContext());
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
		await waitFor(() => {
			expect(removeCurrentOrganizationLogoMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
			});
			expect(routerInvalidateMock).toHaveBeenCalledWith({ sync: true });
			expect(
				queryClient.getQueryData<AccountOrganizationContext>(
					organizationScopeQueryKey
				)
			).toMatchObject({
				organizations: [{ id: "org-personal" }, { id: "org-acme", logo: null }],
			});
		});
	});

	it("does not expose the retired future Agent Profile authorization preference", () => {
		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		expect(
			screen.queryByRole("switch", {
				name: AUTOMATIC_AGENT_AUTHORIZATION_PATTERN,
			})
		).toBeNull();
		expect(screen.queryByText("Invite link")).toBeNull();
		expect(getOrganizationJoinLinkMock).not.toHaveBeenCalled();
	});

	it("shows invitation record load failures and recovers on retry", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("admin");
		listOrganizationInvitationsMock
			.mockRejectedValueOnce(new Error("Not authenticated"))
			.mockRejectedValueOnce(new Error("Not authenticated"))
			.mockResolvedValueOnce([]);

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage section="invitations" />
			</TestQueryClientProvider>
		);

		expect(await screen.findByText("Not authenticated")).toBeTruthy();
		expect(screen.getByText("Not authenticated")).toBeTruthy();
		expect(screen.queryByText("Authentication request failed")).toBeNull();
		expect(screen.getByText("Invite form")).toBeTruthy();
		expect(await screen.findByText("Invite link")).toBeTruthy();
		expect(getOrganizationJoinLinkMock).toHaveBeenCalledWith({
			mode: "direct",
			organizationId: "org-acme",
		});

		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		await waitFor(() => {
			expect(listOrganizationInvitationsMock).toHaveBeenCalledTimes(3);
		});
		await waitFor(() => {
			expect(screen.queryByText("Not authenticated")).toBeNull();
			expect(screen.getByText("No invitation records yet.")).toBeTruthy();
		});
	});

	it("keeps personal identity editable without organization invitation controls", async () => {
		currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Owner",
			slug: "owner",
		};
		organizations = [currentOrganization];

		render(
			<TestQueryClientProvider>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		expect(screen.getByRole("heading", { name: "General" })).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Organization logo" })
		).toBeNull();
		expect(screen.getByDisplayValue("Owner")).toBeTruthy();
		expect(screen.getByDisplayValue("owner")).toBeTruthy();
		expect(
			screen.getByText(
				"Delete and leave actions are not available for your personal workspace."
			)
		).toBeTruthy();
		expect(screen.queryByText("Members and roles")).toBeNull();
		expect(
			screen.queryByRole("button", { name: REMOVE_BUTTON_NAME })
		).toBeNull();
		expect(screen.queryByRole("heading", { name: "Invitations" })).toBeNull();
		expect(screen.queryByText("Invite form")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Generate invite link" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Delete organization" })
		).toBeNull();

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Felix" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(updateOrganizationMock).toHaveBeenCalledWith({
				data: { name: "Felix", slug: "owner" },
				organizationId: "org-personal",
			});
		});
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
		expect(readCurrentOrganizationDirectoryMock).not.toHaveBeenCalled();
		expect(listOrganizationInvitationsMock).not.toHaveBeenCalled();
		expect(getOrganizationJoinLinkMock).not.toHaveBeenCalled();
		expect(deleteOrganizationMock).not.toHaveBeenCalled();
		expect(removeOrganizationMemberMock).not.toHaveBeenCalled();
	});

	it("requires DELETE before deleting the organization and returns to personal Spaces", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("owner");
		const queryClient = createTestQueryClient();
		const personalOrganization = organizations[0] as OrganizationSummary;
		const deletedJoinLinkQueryKey = organizationQueryKeys.joinLink(
			currentOrganization.id
		);
		queryClient.setQueryData(
			accountOrganizationContextQueryKey,
			makeAccountContext()
		);
		queryClient.setQueryData(deletedJoinLinkQueryKey, null);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<OrganizationSettingsPage />
			</TestQueryClientProvider>
		);

		const deleteButton = await screen.findByRole("button", {
			name: "Delete organization",
		});
		await waitFor(() => {
			expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
		});
		fireEvent.click(deleteButton);

		const dialog = screen.getByRole("dialog");
		expect(dialog).toBeTruthy();
		const deleteKeyword = within(dialog).getByText("DELETE");
		expect(deleteKeyword.className).toContain("font-medium");
		expect(deleteKeyword.className).toContain("text-foreground");
		expect(
			within(dialog).getByPlaceholderText("Type DELETE to confirm")
		).toBeTruthy();
		const confirmButton = within(dialog).getByRole("button", {
			name: "Delete organization",
		}) as HTMLButtonElement;
		expect(confirmButton.disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Confirmation"), {
			target: { value: "DELETE" },
		});

		expect(confirmButton.disabled).toBe(false);
		fireEvent.click(confirmButton);

		await waitFor(() => {
			expect(clearOrganizationPersistenceMock).toHaveBeenCalledWith(
				"user-owner",
				"org-acme"
			);
			expect(deleteOrganizationMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
			});
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/owner/spaces",
			});
			expect(
				queryClient.getQueryData<AccountOrganizationContext>(
					accountOrganizationContextQueryKey
				)
			).toMatchObject({
				defaultOrganizationId: personalOrganization.id,
				organizations: [personalOrganization],
			});
			expect(queryClient.getQueryData(deletedJoinLinkQueryKey)).toBeUndefined();
		});
	});
});
