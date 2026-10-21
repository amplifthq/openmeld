import { Dialog } from "@openmeld/ui/components/dialog";
import {
	resolveHostCapabilities,
	resolveSettingsSections,
	toSettingsNavItems,
} from "@openmeld/ui/lib/settings-contract";
import { isRedirect } from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { buildSettingsRoutes } from "#/lib/settings-routes";
import { TestQueryClientProvider } from "#/test-support/query-client";
import {
	SettingsContentFrame,
	SettingsInnerSidebar,
	SettingsPage,
} from "./settings-page";
import { buildSettingsSections } from "./settings-sections";

const CLOUD_CAPABILITIES = resolveHostCapabilities("cloud");
const TEST_ORG_SLUG = "acme";
const testSettingsRoutes = buildSettingsRoutes(TEST_ORG_SLUG);
const testSettingsSections = buildSettingsSections(TEST_ORG_SLUG);
const getActiveOrganizationMemberRoleMock = vi.hoisted(() =>
	vi.fn(async (): Promise<string> => "owner")
);
const getDesktopPlatformMock = vi.hoisted(() => vi.fn());
const settingsFault = vi.hoisted(() => ({ error: null as Error | null }));
let currentOrganization: OrganizationSummary = {
	id: "org-acme",
	name: "Acme",
	slug: "acme",
};

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router"
	);
	return {
		...actual,
		useLocation: ({
			select,
		}: {
			select: (location: { pathname: string }) => string;
		}) => select({ pathname: "/o/acme/inbox" }),
		Link: ({ children, to }: { children: ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
	};
});

vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: getDesktopPlatformMock,
}));

vi.mock("#/query/organizations/invitation-requests", () => ({
	useInvitationReviewCount: () => ({ data: 0 }),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentOrganization,
		currentUserId: "user-123",
	}),
	useAppOrganization: () => ({
		currentOrganization,
		currentUserId: "user-123",
	}),
	useCurrentOrganizationSlug: () => currentOrganization.slug,
}));

vi.mock("#/components/app/app-inner-sidebar", () => ({
	AppInnerSidebar: ({ children }: { children: ReactNode }) => <>{children}</>,
	AppInnerSidebarHeader: ({ title }: { title: string }) => (
		<h2 className="text-xs">{title}</h2>
	),
}));

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: () => null,
}));

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "owner@example.com",
		image: null,
		name: "Owner",
	}),
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

vi.mock("./account-section", () => ({
	AccountSection: () => {
		if (settingsFault.error) {
			throw settingsFault.error;
		}
		return <div>Account settings content</div>;
	},
}));

afterEach(() => {
	cleanup();
	settingsFault.error = null;
	getDesktopPlatformMock.mockReset();
	currentOrganization = {
		id: "org-acme",
		name: "Acme",
		slug: "acme",
	};
});

describe("Web Settings capability gating", () => {
	it("keeps the dialog and outside editing through cold loading and a failed section", async () => {
		const content = () => (
			<TestQueryClientProvider>
				<input aria-label="Unsent work" defaultValue="Keep this draft" />
				<Dialog open>
					<SettingsPage
						activeSectionId="account"
						onNavigate={vi.fn()}
						presentation="dialog"
					/>
				</Dialog>
			</TestQueryClientProvider>
		);
		const view = render(content());
		const draft = screen.getByLabelText("Unsent work") as HTMLInputElement;
		const dialog = screen.getByRole("dialog", { name: "App settings" });
		expect(screen.getByRole("button", { name: "Appearance" })).toBeTruthy();
		expect(
			screen.getByRole("status", { name: "Loading settings" })
		).toBeTruthy();
		await screen.findByText("Account settings content");
		expect(screen.getByRole("dialog", { name: "App settings" })).toBe(dialog);
		settingsFault.error = new Error(
			"Failed to fetch dynamically imported module: /assets/old-settings.js"
		);
		view.rerender(content());
		await screen.findByText("Settings couldn’t load.");
		expect(screen.getByLabelText("Unsent work")).toBe(draft);
		expect(draft.value).toBe("Keep this draft");
		expect(screen.getByRole("dialog", { name: "App settings" })).toBe(dialog);
		expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
	});
	it("drops the local-service Service section on a plain Web (cloud) host", () => {
		const sections = resolveSettingsSections(
			testSettingsSections,
			CLOUD_CAPABILITIES
		);
		const ids = sections.map((section) => section.id);

		expect(ids).toEqual([
			"account",
			"appearance",
			"notifications",
			"spaces",
			"privacy",
			"center-agent",
			"usage",
			"general",
			"members",
			"invitations",
			"security",
		]);
		expect(ids).not.toContain("service");
	});

	it("projects the cloud-tier Settings nav items on Web", () => {
		const navItems = toSettingsNavItems(
			resolveSettingsSections(testSettingsSections, CLOUD_CAPABILITIES)
		);

		expect(navItems.map((item) => item.id)).toEqual([
			"account",
			"appearance",
			"notifications",
			"spaces",
			"privacy",
			"center-agent",
			"usage",
			"general",
			"members",
			"invitations",
			"security",
		]);
		expect(navItems.map((item) => item.to)).toEqual([
			testSettingsRoutes.account,
			testSettingsRoutes.appearance,
			testSettingsRoutes.notifications,
			testSettingsRoutes.spaces,
			testSettingsRoutes.privacy,
			testSettingsRoutes["center-agent"],
			testSettingsRoutes.usage,
			testSettingsRoutes.general,
			testSettingsRoutes.members,
			testSettingsRoutes.invitations,
			testSettingsRoutes.security,
		]);
	});

	it("keeps the same Settings structure in a personal workspace", () => {
		const personalSections = resolveSettingsSections(
			buildSettingsSections("felix"),
			CLOUD_CAPABILITIES
		);

		expect(personalSections.map((section) => section.id)).toEqual([
			"account",
			"appearance",
			"notifications",
			"spaces",
			"privacy",
			"center-agent",
			"usage",
			"general",
			"members",
			"invitations",
			"security",
		]);
	});
});

describe("Settings grouped navigation", () => {
	it("places Desktop Updates after Privacy and before Send feedback", () => {
		getDesktopPlatformMock.mockReturnValue({});
		const navItems = toSettingsNavItems(
			resolveSettingsSections(
				buildSettingsSections(TEST_ORG_SLUG),
				CLOUD_CAPABILITIES
			)
		);

		render(
			<SettingsInnerSidebar
				activeSectionId="updates"
				isPersonalWorkspace={false}
				items={navItems}
				onSendFeedback={vi.fn()}
				organizationName="Acme"
				organizationRole="owner"
			/>
		);

		const personalNavigation = screen.getByRole("navigation", {
			name: "Personal settings",
		});
		expect(
			Array.from(personalNavigation.querySelectorAll("a, button")).map(
				(item) => item.textContent
			)
		).toEqual([
			"Account",
			"Appearance",
			"Notifications",
			"Desktop",
			"Spaces",
			"Privacy & Safety",
			"Updates",
			"Send feedback",
		]);
	});

	it("uses section actions instead of full-page links inside the dialog", () => {
		const onNavigate = vi.fn();
		render(
			<SettingsInnerSidebar
				activeSectionId="account"
				isPersonalWorkspace={false}
				items={toSettingsNavItems(
					resolveSettingsSections(testSettingsSections, CLOUD_CAPABILITIES)
				)}
				onNavigate={onNavigate}
				onSendFeedback={vi.fn()}
				organizationName="Acme"
				organizationRole="owner"
				presentation="dialog"
			/>
		);
		expect(screen.queryAllByRole("link")).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
		expect(onNavigate).toHaveBeenCalledWith("appearance");
		fireEvent.click(screen.getByRole("button", { name: "Invitations" }));
		expect(onNavigate).toHaveBeenLastCalledWith("invitations");
	});

	it("shows Personal and the current organization name without redundant badges", () => {
		const onSendFeedback = vi.fn();
		const navItems = toSettingsNavItems(
			resolveSettingsSections(testSettingsSections, CLOUD_CAPABILITIES)
		);

		render(
			<SettingsInnerSidebar
				activeSectionId="account"
				isPersonalWorkspace={false}
				items={navItems}
				onSendFeedback={onSendFeedback}
				organizationName="Acme"
				organizationRole="owner"
			/>
		);

		expect(
			screen.getByRole("heading", { level: 2, name: "Personal" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Acme" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Settings" }).className
		).toContain("text-xs");
		expect(
			screen.queryByText("Manage personal and organization settings.")
		).toBeNull();
		expect(screen.queryByText("You")).toBeNull();
		expect(screen.queryByText("Workspace")).toBeNull();
		const organizationLabel = screen.getByRole("heading", {
			level: 2,
			name: "Acme",
		});
		expect(
			Array.from(
				organizationLabel?.querySelectorAll("[data-slot=badge]") ?? []
			).map((badge) => badge.textContent)
		).toEqual([]);
		const personalNavigation = screen.getByRole("navigation", {
			name: "Personal settings",
		});
		expect(
			Array.from(personalNavigation.querySelectorAll("a, button")).map(
				(item) => item.textContent
			)
		).toEqual([
			"Account",
			"Appearance",
			"Notifications",
			"Spaces",
			"Privacy & Safety",
			"Send feedback",
		]);
		fireEvent.click(
			within(personalNavigation).getByRole("button", {
				name: "Send feedback",
			})
		);
		expect(onSendFeedback).toHaveBeenCalledOnce();
		expect(
			screen.queryByRole("link", { name: "Connected Plugins" })
		).toBeNull();
		expect(
			Array.from(
				screen
					.getByRole("navigation", { name: "Acme settings" })
					.querySelectorAll("a")
			).map((link) => link.textContent)
		).toEqual([
			"General",
			"Center Agent",
			"AI usage",
			"Members",
			"Invitations",
			"Security",
		]);
	});

	it("uses the shared compact app-nav scale for labels and items", () => {
		const navItems = toSettingsNavItems(
			resolveSettingsSections(testSettingsSections, CLOUD_CAPABILITIES)
		);

		render(
			<SettingsInnerSidebar
				activeSectionId="account"
				isPersonalWorkspace={false}
				items={navItems}
				onSendFeedback={vi.fn()}
				organizationName="Acme"
				organizationRole="owner"
			/>
		);

		const personalLabel = screen.getByRole("heading", {
			level: 2,
			name: "Personal",
		});
		const accountItem = screen.getByRole("link", {
			name: "Account",
		}).firstElementChild;

		expect(personalLabel?.className).toContain("ps-[5px]");
		expect(personalLabel?.className).toContain("pe-2");
		expect(personalLabel?.className).not.toContain("px-2");
		expect(personalLabel?.className).toContain("text-sidebar-foreground/55");
		expect(accountItem?.className).toContain("h-7");
		expect(accountItem?.className).toContain("px-1");
		expect(accountItem?.className).toContain("text-[13px]");
		expect(accountItem?.className).not.toContain("min-h-10");
		expect(accountItem?.className).not.toContain("text-sm");
	});

	it("opens the existing Send feedback dialog from Personal settings", async () => {
		render(
			<TestQueryClientProvider>
				<SettingsPage activeSectionId="account" />
			</TestQueryClientProvider>
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Send feedback" })
		);

		expect(screen.getByRole("dialog", { name: "Send feedback" })).toBeTruthy();
	});

	it("keeps the same items while identifying the active organization or personal workspace by name", async () => {
		const renderNavigationFor = async (organization: OrganizationSummary) => {
			currentOrganization = organization;
			const organizationLabel = organization.name;
			const view = render(
				<TestQueryClientProvider>
					<SettingsPage activeSectionId="account" />
				</TestQueryClientProvider>
			);
			if (!organization.isPersonal) {
				await screen.findByRole("link", { name: "Security" });
			}
			const groupLabel = screen.getByRole("heading", {
				level: 2,
				name: organizationLabel,
			});
			const itemLabels = {
				badges: Array.from(
					groupLabel?.querySelectorAll("[data-slot=badge]") ?? []
				).map((badge) => badge.textContent),
				organizationLabel,
				storedOrganizationNameVisible: Boolean(
					screen.queryByRole("heading", {
						level: 2,
						name: organization.name,
					})
				),
				personal: Array.from(
					screen
						.getByRole("navigation", { name: "Personal settings" })
						.querySelectorAll("a, button")
				).map((item) => item.textContent),
				organization: within(
					screen.getByRole("navigation", {
						name: `${organizationLabel} settings`,
					})
				)
					.getAllByRole("link")
					.map((link) => link.textContent),
			};
			view.unmount();
			return itemLabels;
		};

		const organizationItems = await renderNavigationFor({
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		});
		const personalItems = await renderNavigationFor({
			id: "org-personal",
			isPersonal: true,
			name: "Felix",
			slug: "felix",
		});

		expect(personalItems.personal).toEqual([
			"Account",
			"Appearance",
			"Notifications",
			"Spaces",
			"Privacy & Safety",
			"Center Agent",
			"Send feedback",
		]);
		expect(personalItems.organization).toEqual(["General", "AI usage"]);
		expect(organizationItems).toEqual({
			badges: [],
			organization: [
				"General",
				"Center Agent",
				"AI usage",
				"Members",
				"Invitations",
				"Security",
			],
			organizationLabel: "Acme",
			personal: [
				"Account",
				"Appearance",
				"Notifications",
				"Spaces",
				"Privacy & Safety",
				"Send feedback",
			],
			storedOrganizationNameVisible: true,
		});
		expect(personalItems).toEqual({
			badges: [],
			organization: ["General", "AI usage"],
			organizationLabel: "Felix",
			personal: [
				"Account",
				"Appearance",
				"Notifications",
				"Spaces",
				"Privacy & Safety",
				"Center Agent",
				"Send feedback",
			],
			storedOrganizationNameVisible: true,
		});
	});
});

describe("SettingsPage gated-route guard", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("redirects the org-scoped Service settings route to Account on a plain Web host", () => {
		// The Service leaf is gated out on a cloud host, so its section is absent
		// from the capability-filtered registry. Rendering its route must redirect
		// to the always-present Account leaf, never silently render another panel.
		// React logs the thrown render error; silence it so the run stays clean.
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
			// Intentionally swallow the expected render-time throw log.
		});

		let thrown: unknown;
		try {
			render(<SettingsPage activeSectionId="service" />);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeDefined();
		expect(isRedirect(thrown)).toBe(true);
		expect((thrown as { options: { to: string } }).options.to).toBe(
			testSettingsRoutes.account
		);
		errorSpy.mockRestore();
	});
});

describe("SettingsContentFrame", () => {
	it("renders an empty shell header strip aligned to the app sidebar headers", () => {
		const { container, getByText } = render(
			<SettingsContentFrame>
				<div>Settings body</div>
			</SettingsContentFrame>
		);

		const header = container.querySelector<HTMLElement>(
			'[data-slot="settings-content-header"]'
		);
		expect(header).toBeTruthy();
		expect(header?.getAttribute("aria-hidden")).toBe("true");
		expect(header?.className).toContain(
			"h-[var(--space-conversation-header-height)]"
		);
		expect(header?.className).toContain("border-b");
		expect(getByText("Settings body").parentElement?.className).toContain(
			"max-w-7xl"
		);
		expect(getByText("Settings body").parentElement?.className).toContain(
			"pt-3"
		);
		expect(getByText("Settings body")).toBeTruthy();
	});
});
