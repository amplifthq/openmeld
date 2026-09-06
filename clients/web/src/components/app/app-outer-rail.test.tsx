import { selectLastSelectedOrganizationErrorResponseSchema } from "@openmeld/schemas";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthDeviceSession } from "#/lib/auth-client-types";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import {
	rememberClientSidebarState,
	type SidebarTier,
} from "#/lib/sidebar-width-cookie";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AppOuterRail } from "./app-outer-rail";
import type { AppShellSection } from "./shell-layout";

vi.mock("./app-command-center", () => ({ AppCommandCenter: () => null }));

const BETA_ORGANIZATION_NAME_PATTERN = /Beta/;
const navigateMock = vi.fn();
const routerInvalidateMock = vi.fn();
const useAccountAvatarMock = vi.hoisted(() => vi.fn());
const useDefaultHumanProfileMock = vi.hoisted(() => vi.fn());
const useDeviceSessionsMock = vi.hoisted(() => vi.fn());
const useSwitchAccountMock = vi.hoisted(() => vi.fn());
const useLogoutAllAccountsActionMock = vi.hoisted(() => vi.fn());
const switchAccountMutateAsyncMock = vi.hoisted(() => vi.fn());
const logoutAllAccountsMutateAsyncMock = vi.hoisted(() => vi.fn());
const retryDeviceSessionsMock = vi.hoisted(() => vi.fn());
const prefetchCenterAgentConversationMock = vi.hoisted(() => vi.fn());
const selectLastSelectedOrganizationMock = vi.hoisted(() => vi.fn());
let routerLocation = {
	pathname: "/o/acme/spaces",
	searchStr: "",
};
let appShellSection: AppShellSection = "space";
let centerAgentUnreadCount = 0;
let ordinarySpaceUnreadCount: number | undefined = 0;
let appOrganization: {
	activeOrganization: OrganizationSummary | null;
	currentOrganization: OrganizationSummary;
	organizations: OrganizationSummary[];
} = {
	activeOrganization: null,
	currentOrganization: {
		id: "org-acme",
		name: "Acme",
		slug: "acme",
	},
	organizations: [
		{
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		},
	],
};

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		activeOptions,
		children,
		className,
		to,
		...props
	}: {
		activeOptions?: { exact?: boolean };
		children: ReactNode;
		className?: string;
		to: string;
	} & AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a
			className={[
				className,
				isMockLinkActive({ activeOptions, to }) ? "active" : null,
			]
				.filter(Boolean)
				.join(" ")}
			href={to}
			{...props}
		>
			{children}
		</a>
	),
	useCanGoBack: () => false,
	useNavigate: () => navigateMock,
	useRouter: () => ({ invalidate: routerInvalidateMock }),
	useMatches: (input: {
		select: (
			matches: readonly {
				staticData: { appShellSection?: AppShellSection };
			}[]
		) => unknown;
	}) => input.select([{ staticData: {} }, { staticData: { appShellSection } }]),
	useRouterState: ({
		select,
	}: {
		select: (state: { location: typeof routerLocation }) => unknown;
	}) => select({ location: routerLocation }),
}));

function isMockLinkActive(input: {
	activeOptions?: { exact?: boolean };
	to: string;
}): boolean {
	return input.activeOptions?.exact === true
		? routerLocation.pathname === input.to
		: routerLocation.pathname.startsWith(input.to);
}

vi.mock("#/query/organizations/invitation-requests", () => ({
	useInvitationReviewCount: () => ({ data: 0 }),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => appOrganization,
	useCurrentOrganizationSlug: () => appOrganization.currentOrganization.slug,
}));

vi.mock("#/lib/organizations/account-organization-preference", () => ({
	selectLastSelectedOrganization: selectLastSelectedOrganizationMock,
}));

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentCenterAgentInboxSummary: async () => ({
		organizationId: appOrganization.currentOrganization.id,
		unreadCount: centerAgentUnreadCount,
	}),
	getCurrentSpaceInboxSummary: async () => ({
		...(ordinarySpaceUnreadCount === undefined
			? {}
			: { ordinarySpaceUnreadCount }),
		organizationId: appOrganization.currentOrganization.id,
		spaces: [],
	}),
}));

vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: useDefaultHumanProfileMock,
}));

vi.mock("#/hooks/account.hooks", () => ({
	useAccountAvatar: useAccountAvatarMock,
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useDeviceSessions: useDeviceSessionsMock,
	useSwitchAccount: useSwitchAccountMock,
}));

vi.mock("#/hooks/auth-form.hooks", () => ({
	useLogoutAction: () => ({ isPending: false, mutate: vi.fn() }),
	useLogoutAllAccountsAction: useLogoutAllAccountsActionMock,
}));

vi.mock(
	"#/components/organizations/use-center-agent-conversation-intent-prefetch",
	() => ({
		useCenterAgentConversationIntentPrefetch: () =>
			prefetchCenterAgentConversationMock,
	})
);

const TEST_ACCOUNT: {
	email: string;
	image: string | null;
	name: string;
} = {
	email: "felix@example.com",
	image: null,
	name: "Felix",
};
const TEST_DEVICE_SESSIONS: AuthDeviceSession[] = [
	{
		session: {
			token: "session-felix",
			userId: "user-felix",
		},
		user: {
			email: TEST_ACCOUNT.email,
			id: "user-felix",
			name: TEST_ACCOUNT.name,
		},
	},
	{
		session: {
			token: "session-jane",
			userId: "user-jane",
		},
		user: {
			email: "jane@example.com",
			id: "user-jane",
			name: "Jane",
		},
	},
];
const CREATE_ORGANIZATION_MENU_ITEM_NAME = /Create organization/;
const FELIX_MENU_ITEM_NAME = /Felix/;
const FELIX_ACCOUNT_MENU_ITEM_NAME = /Felix.*felix@example\.com/;
const USER_MENU_PATTERN = /Open user menu for/;
const THEME_TOGGLE_PATTERN = /Switch to .* mode/;
const CLASS_NAME_SEGMENT_SEPARATOR_PATTERN = /\s+/u;
const PRIMARY_RAIL_LABELS = [
	"New Agent",
	"Home",
	"Spaces",
	"Messages",
	"People",
	"Agents",
] as const;

const TOGGLE_TRIGGER_NAME_PATTERN = /Hide sidebar|Show sidebar/;

describe("AppOuterRail", () => {
	beforeEach(() => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			fillRect: vi.fn(),
			fillStyle: "",
			globalCompositeOperation: "source-over",
		} as unknown as CanvasRenderingContext2D);
		navigateMock.mockReset().mockResolvedValue(undefined);
		routerInvalidateMock.mockReset().mockResolvedValue(undefined);
		useDefaultHumanProfileMock.mockReset().mockReturnValue({
			defaultHumanProfile: {
				avatarUrl: null,
				profileName: "Default Human Profile",
				openMeldProfileId: "default-human-profile-1",
			},
			profilesQuery: {
				isError: false,
				isPending: false,
			},
		});
		useAccountAvatarMock.mockReset().mockReturnValue({
			data: {
				avatar: null,
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
			isPending: false,
		});
		useDeviceSessionsMock.mockReset().mockReturnValue({
			data: TEST_DEVICE_SESSIONS,
			isError: false,
			isPending: false,
			refetch: retryDeviceSessionsMock,
		});
		useSwitchAccountMock.mockReset().mockReturnValue({
			isPending: false,
			mutateAsync: switchAccountMutateAsyncMock,
		});
		useLogoutAllAccountsActionMock.mockReset().mockReturnValue({
			isPending: false,
			mutateAsync: logoutAllAccountsMutateAsyncMock,
		});
		switchAccountMutateAsyncMock.mockReset().mockResolvedValue(undefined);
		logoutAllAccountsMutateAsyncMock.mockReset().mockResolvedValue(undefined);
		retryDeviceSessionsMock.mockReset().mockResolvedValue(undefined);
		prefetchCenterAgentConversationMock.mockReset();
		selectLastSelectedOrganizationMock.mockReset().mockResolvedValue({
			ok: true,
			organizationId: "org-beta",
		});
		appShellSection = "space";
		centerAgentUnreadCount = 0;
		ordinarySpaceUnreadCount = 0;
		routerLocation = {
			pathname: "/o/acme/spaces",
			searchStr: "",
		};
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
			],
		};
		rememberClientSidebarState("outer", { tier: "expanded", width: "9rem" });
	});

	afterEach(() => {
		cleanup();
		rememberClientSidebarState("outer", { tier: "expanded", width: "9rem" });
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("places account, Settings, and theme controls in the footer", () => {
		renderRail();
		const settings = screen.getByRole("link", { name: "Settings" });
		const footer = settings.closest("[data-sidebar=footer]") as HTMLElement;
		expect(
			within(footer).getByRole("button", { name: USER_MENU_PATTERN })
		).toBeTruthy();
		expect(
			within(footer).getByRole("button", { name: THEME_TOGGLE_PATTERN })
		).toBeTruthy();
		expect(
			within(footer).queryByRole("button", {
				name: TOGGLE_TRIGGER_NAME_PATTERN,
			})
		).toBeNull();
	});

	it("places the organization switcher at the top without OpenMeld branding", () => {
		renderRail();

		const rail = screen.getByTestId("app-outer-rail");
		const header = rail.querySelector('[data-sidebar="header"]');
		expect(header).toBeInstanceOf(HTMLElement);
		if (!(header instanceof HTMLElement)) {
			return;
		}

		expect(
			within(header).getByRole("button", { name: "Switch organization" })
		).toBeTruthy();
		expect(within(header).getByRole("link", { name: "Inbox" })).toBeTruthy();
		expect(screen.queryByLabelText("Go to OpenMeld homepage")).toBeNull();
		expect(screen.queryByText("Experimental")).toBeNull();
	});

	it("aligns the resize rule with the inset surface boundary", () => {
		renderRail();

		const resizeRail = screen.getByRole("separator", {
			name: "Resize app sidebar",
		});

		expect(resizeRail.className).toContain("top-4");
		expect(resizeRail.className).toContain("bottom-14");
	});

	it("renders the organization selector as a shape-aware row even with one organization", () => {
		renderRail();

		const selector = screen.getByRole("button", {
			name: "Switch organization",
		});
		const avatar = selector.querySelector('[aria-hidden="true"]');
		expect(selector.textContent).toContain("Acme");
		expect(selector.textContent).not.toContain("Organization");
		expect(selector.className).toContain("bg-transparent");
		expect(selector.className).toContain("h-7");
		expect(selector.className).toContain("rounded-md");
		expect(selector.className).not.toContain("bg-muted/20");
		expect(avatar?.className).toContain("size-5");
		expect(avatar?.className).not.toContain("size-7");
	});

	it("uses a compact type scale and grouped spacing in the full rail", () => {
		renderRail({ tier: "expanded", width: "13.75rem" });

		const homeLink = screen.getByRole("link", {
			name: "Home",
		});
		expect(homeLink.className).toContain("h-7");
		expect(homeLink.className).toContain("text-[13px]");

		const groups = screen
			.getByTestId("app-outer-rail")
			.querySelectorAll('[data-sidebar="group"]');
		expect(groups).toHaveLength(1);
		expect(
			screen
				.getByRole("navigation", { name: "Team" })
				.querySelector('[data-sidebar="menu-sub"]')
		).toBeTruthy();
	});

	it("warms the Center Agent conversation from primary navigation intent", () => {
		renderRail();

		fireEvent.pointerEnter(screen.getByRole("link", { name: "Home" }));

		expect(prefetchCenterAgentConversationMock).toHaveBeenCalledOnce();
	});

	it("center-truncates destination labels when the full rail is narrow", () => {
		renderRail({ tier: "expanded", width: "9rem" });

		const directMessagesLink = screen.getByRole("link", {
			name: "Messages",
		});
		const centerTruncatedLabel = directMessagesLink.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);

		expect(centerTruncatedLabel).toBeTruthy();
		expect(
			centerTruncatedLabel?.querySelector(
				'[data-slot="center-truncated-text-start"]'
			)?.textContent
		).toBe("Mess");
		expect(
			centerTruncatedLabel?.querySelector(
				'[data-slot="center-truncated-text-end"]'
			)?.textContent
		).toBe("ages");
		expect(directMessagesLink.querySelector("span.truncate")).toBeNull();
	});

	it("renders the collapsed organization selector without selector or avatar borders", () => {
		rememberClientSidebarState("outer", { tier: "icon", width: "8rem" });
		renderRail({ tier: "expanded", width: "9rem" });

		const selector = screen.getByRole("button", {
			name: "Switch organization",
		});
		const avatar = selector.querySelector('[aria-hidden="true"]');
		expect(selector.className).not.toContain("border-border");
		expect(avatar?.className).not.toContain("border-border");
	});

	it("centers collapsed navigation items on the same rail axis as the header and footer", () => {
		rememberClientSidebarState("outer", { tier: "icon", width: "8rem" });
		renderRail({ tier: "expanded", width: "9rem" });

		const content = screen
			.getByTestId("app-outer-rail")
			.querySelector(
				'[data-sidebar="content"] [data-slot="scroll-area-viewport"] > div'
			);

		expect(content?.className).toContain("px-2");
		expect(content?.className).not.toContain("px-3");
	});

	it("uses app tooltips instead of native titles for collapsed rail controls", () => {
		rememberClientSidebarState("outer", { tier: "icon", width: "8rem" });
		renderRail({ tier: "expanded", width: "9rem" });

		for (const label of [
			"New Agent",
			"Home",
			"Spaces",
			"Messages",
			"People",
			"Agents",
			"Settings",
		]) {
			const link = screen.getByRole("link", { name: label });
			expect(link.getAttribute("data-slot")).toBe("tooltip-trigger");
			expect(link.getAttribute("title")).toBeNull();
		}

		const organizationSelector = screen.getByRole("button", {
			name: "Switch organization",
		});
		expect(organizationSelector.getAttribute("data-slot")).toBe(
			"tooltip-trigger"
		);
		expect(organizationSelector.getAttribute("title")).toBeNull();

		expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
	});

	it("does not expose Send feedback from the outer rail", () => {
		renderRail();

		expect(screen.queryByRole("button", { name: "Send feedback" })).toBeNull();
	});

	it("opens the canonical People home", () => {
		renderRail();

		const peopleLink = screen.getByRole("link", { name: "People" });
		expect(peopleLink.getAttribute("href")).toBe("/o/acme/people");
	});

	it("opens Agent creation in the current organization", () => {
		renderRail();

		const newAgentLink = screen.getByRole("link", { name: "New Agent" });
		expect(newAgentLink.getAttribute("href")).toBe("/o/acme/agents/new");
	});

	it("opens the canonical Direct Messages home", () => {
		renderRail();

		const directMessagesLink = screen.getByRole("link", {
			name: "Messages",
		});
		expect(directMessagesLink.getAttribute("href")).toBe(
			"/o/acme/direct-messages"
		);
	});

	it("keeps primary destinations flat and nests People and Agents under Team", () => {
		renderRail();

		const railContent = screen
			.getByTestId("app-outer-rail")
			.querySelector('[data-slot="main-sidebar-navigation"]');
		expect(railContent).toBeInstanceOf(HTMLElement);
		if (!(railContent instanceof HTMLElement)) {
			return;
		}

		const teamHeading = within(railContent).getByRole("navigation", {
			name: "Team",
		});
		expect(teamHeading).toBeTruthy();
		expect(within(teamHeading).getAllByRole("link")).toHaveLength(2);
		expect(
			within(railContent).getByRole("navigation", {
				name: "Primary navigation",
			})
		).toBeTruthy();
		expect(
			within(railContent).getByRole("navigation", { name: "Team" })
		).toBeTruthy();
		expect(
			within(railContent).queryByRole("navigation", { name: "Resources" })
		).toBeNull();
		expect(
			within(railContent).queryByRole("button", { name: "Team" })
		).toBeNull();
		expect(
			within(railContent).queryByRole("button", { name: "Work" })
		).toBeNull();
		expect(
			within(railContent).queryByRole("button", { name: "Resources" })
		).toBeNull();
		expect(
			within(railContent).getByRole("link", { name: "New Agent" })
		).toBeTruthy();
		expect(
			within(railContent).getByRole("link", { name: "Home" })
		).toBeTruthy();
		expect(
			within(railContent).queryByRole("link", { name: "Center Agent" })
		).toBeNull();
		expect(
			within(railContent).getByRole("link", { name: "Spaces" })
		).toBeTruthy();
		expect(
			within(railContent).getByRole("link", { name: "Messages" })
		).toBeTruthy();
		expect(
			within(railContent).getByRole("link", { name: "People" })
		).toBeTruthy();
	});

	it.each([
		"people",
		"agents",
	])("marks the selected %s child in Team", (destination) => {
		routerLocation = { pathname: `/o/acme/${destination}`, searchStr: "" };
		appShellSection = destination === "people" ? "people" : "agents";
		renderRail();
		const team = screen.getByRole("navigation", { name: "Team" });
		const selection = within(team).getByRole("link", {
			name: destination === "people" ? "People" : "Agents",
		});
		expect(selection.getAttribute("aria-current")).toBe("page");
	});

	it("keeps main navigation outside the scrolling list region", () => {
		renderRail();
		const rail = screen.getByTestId("app-outer-rail");
		const scrollingContent = rail.querySelector('[data-sidebar="content"]');
		expect(scrollingContent).toBeTruthy();
		for (const name of ["New Agent", "Home", "Spaces", "Messages"]) {
			expect(
				scrollingContent?.contains(screen.getByRole("link", { name }))
			).toBe(false);
		}
		expect(
			scrollingContent?.contains(
				screen.getByRole("navigation", { name: "Team" })
			)
		).toBe(false);
	});

	it("ignores a stale collapsed Work preference in the full rail", () => {
		rememberClientSidebarState("outer", {
			collapsedGroupIds: ["work"],
			tier: "expanded",
			width: "13.75rem",
		});
		renderRail({
			collapsedGroupIds: ["work"],
			tier: "expanded",
			width: "13.75rem",
		});

		expect(screen.getByRole("link", { name: "New Agent" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Center Agent" })).toBeNull();
		expect(screen.getByRole("link", { name: "Spaces" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Messages" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Work" })).toBeNull();
	});

	it("renders the fixed primary rail order", () => {
		renderRail();

		const railContent = screen
			.getByTestId("app-outer-rail")
			.querySelector('[data-slot="main-sidebar-navigation"]');
		expect(railContent).toBeInstanceOf(HTMLElement);
		if (!(railContent instanceof HTMLElement)) {
			return;
		}

		const appSectionLabels = within(railContent)
			.getAllByRole("link")
			.map((link) => link.textContent?.trim())
			.filter(Boolean);

		expect(appSectionLabels).toEqual(PRIMARY_RAIL_LABELS);
	});

	it("opens Inbox and exposes command search from the header", () => {
		renderRail();
		const header = screen
			.getByTestId("app-outer-rail")
			.querySelector("[data-sidebar=header]") as HTMLElement;
		expect(
			within(header).getByRole("link", { name: "Inbox" }).getAttribute("href")
		).toBe("/o/acme/inbox");
		expect(
			(
				within(header).getByRole("button", {
					name: "Search or run a command",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
	});

	it("uses the channel hash icon for Spaces", () => {
		renderRail();

		const spacesLink = screen.getByRole("link", { name: "Spaces" });

		expect(
			spacesLink.querySelector('[data-space-icon="channel"]')
		).toBeTruthy();
	});

	it.each([
		"icon",
		"expanded",
	] as const)("shows Center Agent unread replies on Home in the %s tier", async (tier) => {
		centerAgentUnreadCount = 2;
		rememberClientSidebarState("outer", {
			tier,
			width: tier === "icon" ? "8rem" : "9rem",
		});
		renderRail({ tier });

		const link = await screen.findByRole("link", {
			name: "Home, 2 unread replies",
		});
		const indicator = link.querySelector(
			'[data-app-rail-status-indicator="center-agent-unread"]'
		);
		expect(indicator).toBeTruthy();
		expect(indicator?.className).toContain("bg-unread");
		expect(indicator?.textContent).toBe("");
	});

	it("waits for the complete ordinary Space aggregate instead of inferring from bounded rows", async () => {
		ordinarySpaceUnreadCount = undefined;
		renderRail();

		const link = await screen.findByRole("link", { name: "Spaces" });
		expect(
			link.querySelector('[data-app-rail-status-indicator="spaces-unread"]')
		).toBeNull();
	});

	it.each([
		"icon",
		"expanded",
	] as const)("shows an accessible blue Spaces unread dot in the %s tier", async (tier) => {
		ordinarySpaceUnreadCount = 3;
		rememberClientSidebarState("outer", {
			tier,
			width: tier === "icon" ? "8rem" : "9rem",
		});
		renderRail({ tier });

		const link = await screen.findByRole("link", {
			name: "Spaces, 3 unread messages",
		});
		const indicator = link.querySelector(
			'[data-app-rail-status-indicator="spaces-unread"]'
		);
		expect(indicator).toBeTruthy();
		expect(indicator?.className).toContain("bg-unread");
		expect(indicator?.textContent).toBe("");
	});

	it.each([
		"icon",
		"expanded",
	] as const)("keeps all product destinations in the same order for personal and organization workspaces in the %s tier", (tier) => {
		for (const workspaceKind of ["personal", "organization"] as const) {
			const personalOrganization = {
				id: "org-personal",
				isPersonal: true,
				name: "Felix",
				slug: "felix",
			};
			const organization = {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			};
			const currentOrganization =
				workspaceKind === "personal" ? personalOrganization : organization;
			appOrganization = {
				activeOrganization: currentOrganization,
				currentOrganization,
				organizations: [personalOrganization, organization],
			};
			routerLocation = {
				pathname: `/o/${currentOrganization.slug}/center-agent`,
				searchStr: "",
			};
			rememberClientSidebarState("outer", {
				tier,
				width: tier === "icon" ? "8rem" : "9rem",
			});

			const view = renderRail({ tier });
			const railContent = screen
				.getByTestId("app-outer-rail")
				.querySelector('[data-slot="main-sidebar-navigation"]');
			expect(railContent).toBeInstanceOf(HTMLElement);
			if (!(railContent instanceof HTMLElement)) {
				view.unmount();
				continue;
			}

			const links = within(railContent).getAllByRole("link");
			expect(links).toHaveLength(PRIMARY_RAIL_LABELS.length);
			for (const [index, label] of PRIMARY_RAIL_LABELS.entries()) {
				expect(links[index]).toBe(
					within(railContent).getByRole("link", { name: label })
				);
			}
			view.unmount();
		}
	});

	it("opens organization choices with workspace and global actions in their settled order", () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					logo: "https://gateway.example/acme-logo.webp",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-solo",
					isPersonal: true,
					name: "Personal",
					slug: "solo",
				},
			],
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);

		const menu = screen.getByRole("menu");
		expect(menu.querySelector("p")?.textContent).toBe("Organization");
		const choices = within(menu).getAllByRole("menuitemradio");
		const personalAvatar = within(choices[0] as HTMLElement).getByTestId(
			"personal-workspace-human-profile-avatar"
		);
		expect(choices[0]?.textContent).toContain("Felix");
		expect(choices[0]?.textContent).toContain("Personal workspace");
		expect(
			personalAvatar
				.querySelector("canvas")
				?.getAttribute("data-profile-avatar-seed")
		).toBe("openmeld-dither-profile-avatar:v1:human:default-human-profile-1");
		expect(choices[1]?.textContent).toContain("Acme");
		expect(
			within(choices[1] as HTMLElement).queryByTestId(
				"personal-workspace-human-profile-avatar"
			)
		).toBeNull();
		expect(within(menu).getByText("Create organization")).toBeTruthy();
		expect(within(menu).getByText("Manage organizations")).toBeTruthy();
		expect(
			within(menu).queryByRole("group", { name: "Global actions" })
		).toBeNull();
		expect(
			within(menu).queryByRole("menuitem", {
				name: FELIX_ACCOUNT_MENU_ITEM_NAME,
			})
		).toBeNull();
		expect(
			(choices[1] as HTMLElement).querySelector<HTMLElement>(
				'[aria-hidden="true"]'
			)?.className
		).toContain("rounded-sm");
	});

	it("shows saved accounts and session actions inside the footer menu", () => {
		useAccountAvatarMock.mockReturnValue({
			data: {
				avatar: "https://example.com/current-avatar.png",
				defaultHumanProfileId: "default-human-profile-1",
				ok: true,
			},
		});
		useDeviceSessionsMock.mockReturnValue({
			data: TEST_DEVICE_SESSIONS.map((entry, index) => ({
				...entry,
				user: {
					...entry.user,
					image:
						index === 0
							? "https://example.com/stale-avatar.png"
							: "https://example.com/jane-avatar.png",
				},
			})),
			isError: false,
			isPending: false,
		});
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Open user menu for Felix" })
		);
		expect(
			screen
				.getByRole("menuitem", { name: FELIX_ACCOUNT_MENU_ITEM_NAME })
				.querySelector("img")
				?.getAttribute("src")
		).toBe("https://example.com/current-avatar.png");
		fireEvent.click(
			screen.getByRole("menuitem", {
				name: FELIX_ACCOUNT_MENU_ITEM_NAME,
			})
		);

		const menu = screen.getByRole("menu");
		expect(within(menu).getByText("Accounts")).toBeTruthy();
		expect(
			within(menu).getByRole("menuitem", { name: "Back to account menu" })
		).toBeTruthy();
		const accountChoices = within(menu).getAllByRole("menuitemradio");
		expect(accountChoices).toHaveLength(2);
		expect(accountChoices[0]?.textContent).toContain("Felix");
		expect(accountChoices[0]?.getAttribute("aria-checked")).toBe("true");
		expect(accountChoices[1]?.textContent).toContain("Jane");
		expect(accountChoices[1]?.getAttribute("aria-checked")).toBe("false");
		expect(accountChoices[0]?.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/current-avatar.png"
		);
		expect(accountChoices[1]?.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/jane-avatar.png"
		);

		const accountActions = within(menu).getByRole("group", {
			name: "Account actions",
		});
		expect(
			within(accountActions).getByRole("menuitem", { name: "Add account" })
		).toBeTruthy();
		expect(
			within(accountActions).getByRole("menuitem", {
				name: "Log out of this account",
			})
		).toBeTruthy();
		expect(
			within(accountActions).getByRole("menuitem", {
				name: "Log out of all accounts",
			})
		).toBeTruthy();
		expect(useDeviceSessionsMock).toHaveBeenLastCalledWith(true);
	});

	it("keeps a failed account switch in the footer menu and returns to its main view", async () => {
		switchAccountMutateAsyncMock.mockRejectedValueOnce(
			new Error("Account session expired.")
		);
		renderRail();
		fireEvent.click(
			screen.getByRole("button", { name: "Open user menu for Felix" })
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: FELIX_ACCOUNT_MENU_ITEM_NAME })
		);
		const choices = screen.getAllByRole("menuitemradio");
		fireEvent.click(choices[0] as HTMLElement);
		expect(switchAccountMutateAsyncMock).not.toHaveBeenCalled();
		fireEvent.click(choices[1] as HTMLElement);
		await waitFor(() =>
			expect(screen.getByText("Account session expired.")).toBeTruthy()
		);
		expect(switchAccountMutateAsyncMock).toHaveBeenCalledWith("session-jane");
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Back to account menu" })
		);
		expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
		expect(screen.queryByText("Account session expired.")).toBeNull();
	});

	it("explains the five-account limit and disables adding another account", () => {
		useDeviceSessionsMock.mockReturnValue({
			data: Array.from(
				{ length: 5 },
				(_, index) =>
					({
						session: {
							token: `session-${index}`,
							userId: index === 0 ? "user-felix" : `user-${index}`,
						},
						user: {
							email:
								index === 0
									? TEST_ACCOUNT.email
									: `person-${index}@example.com`,
							id: index === 0 ? "user-felix" : `user-${index}`,
							name: index === 0 ? TEST_ACCOUNT.name : `Person ${index}`,
						},
					}) satisfies AuthDeviceSession
			),
			isError: false,
			isPending: false,
			refetch: retryDeviceSessionsMock,
		});
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Open user menu for Felix" })
		);
		fireEvent.click(
			screen.getByRole("menuitem", {
				name: FELIX_ACCOUNT_MENU_ITEM_NAME,
			})
		);

		expect(
			screen
				.getByRole("menuitem", { name: "Add account" })
				.getAttribute("aria-disabled")
		).toBe("true");
		expect(
			screen.getByText(
				"You can keep up to 5 accounts signed in on this browser."
			)
		).toBeTruthy();
	});

	it("uses shared fluid hover backgrounds for organization choices and actions", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-solo",
					isPersonal: true,
					name: "Personal",
					slug: "solo",
				},
			],
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);

		const menu = screen.getByRole("menu");
		const organizationList = within(menu).getByRole("group", {
			name: "Organizations",
		});
		const actionList = within(menu).getByRole("group", {
			name: "Organization actions",
		});
		const choices = within(organizationList).getAllByRole("menuitemradio");
		const actions = within(actionList).getAllByRole("menuitem");

		expect(choices.map((choice) => choice.dataset.proximityIndex)).toEqual([
			"0",
			"1",
		]);
		expect(actions.map((action) => action.dataset.proximityIndex)).toEqual([
			"0",
			"1",
		]);
		expect(choices[0]?.className).not.toContain("hover:bg-muted");

		fireEvent.focus(choices[0] as HTMLElement);
		await waitFor(() => {
			expect(
				organizationList.querySelectorAll(
					'[data-slot="fluid-action-list-hover-indicator"]'
				)
			).toHaveLength(1);
		});
	});

	it("does not restore a stale session avatar after the canonical avatar was removed", () => {
		const staleSessionAvatar = "https://lh3.googleusercontent.com/stale-photo";
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-personal",
					isPersonal: true,
					name: "Personal",
					slug: "personal",
				},
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
			],
		};
		renderRail({
			account: {
				...TEST_ACCOUNT,
				image: staleSessionAvatar,
			},
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);

		const personalAvatar = screen.getByTestId(
			"personal-workspace-human-profile-avatar"
		);
		expect(personalAvatar.querySelector("img")).toBeNull();
		expect(personalAvatar.getAttribute("style")).not.toContain(
			staleSessionAvatar
		);
	});

	it("opens organization management for the current workspace", async () => {
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(screen.getByText("Manage organizations"));

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/organizations",
			});
		});
	});

	it("opens Settings from the footer menu and keeps its shortcut", async () => {
		renderRail();

		const railSettingsLink = screen.getByRole("link", { name: "Settings" });
		fireEvent.click(
			screen.getByRole("button", { name: "Open user menu for Felix" })
		);
		fireEvent.click(
			within(screen.getByRole("menu")).getByRole("menuitem", {
				name: "Settings",
			})
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/settings/account",
			});
		});
		expect(railSettingsLink).toBeTruthy();
	});

	it("keeps the organization menu in its own layer above adjacent sidebars", () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-solo",
					isPersonal: true,
					name: "Personal",
					slug: "solo",
				},
			],
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);

		const menu = screen.getByRole("menu");
		const choices = within(menu).getAllByRole("menuitemradio");
		expect(menu.parentElement?.className).toContain("z-50");
		expect(menu.className).toContain("isolate");
		expect(choices[0]?.className).toContain("min-h-11");
		expect(
			within(menu).getByRole("menuitem", {
				name: CREATE_ORGANIZATION_MENU_ITEM_NAME,
			}).className
		).toContain("min-h-12");
	});

	it("opens organization creation immediately in the current workspace shell", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-solo",
					isPersonal: true,
					name: "Solo",
					slug: "solo",
				},
			],
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitem", {
				name: CREATE_ORGANIZATION_MENU_ITEM_NAME,
			})
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/new-organization",
			});
		});
	});

	it("keeps People open when switching into the personal workspace", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-solo",
					isPersonal: true,
					name: "Personal",
					slug: "solo",
				},
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
			],
		};
		routerLocation = {
			pathname: "/o/acme/people",
			searchStr: "?tab=wake-access",
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", { name: FELIX_MENU_ITEM_NAME })
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/solo/people",
			});
		});
	});

	it("persists an explicit Organization selection before navigating", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			],
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);

		await waitFor(() => {
			expect(selectLastSelectedOrganizationMock).toHaveBeenCalledWith(
				"org-beta"
			);
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/beta/spaces",
			});
		});
		expect(
			selectLastSelectedOrganizationMock.mock.invocationCallOrder[0]
		).toBeLessThan(navigateMock.mock.invocationCallOrder[0] ?? 0);
		expect(routerInvalidateMock).not.toHaveBeenCalled();
	});

	it("refreshes the canonical Organization scope after explicitly reselecting the URL Organization", async () => {
		appOrganization = {
			activeOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			currentOrganization: {
				id: "org-beta",
				name: "Beta",
				slug: "beta",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			],
		};
		routerLocation = {
			pathname: "/o/beta/spaces",
			searchStr: "",
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);

		await waitFor(() => {
			expect(selectLastSelectedOrganizationMock).toHaveBeenCalledWith(
				"org-beta"
			);
			expect(routerInvalidateMock).toHaveBeenCalledWith({ sync: true });
		});
		expect(navigateMock).not.toHaveBeenCalled();
		expect(
			selectLastSelectedOrganizationMock.mock.invocationCallOrder[0]
		).toBeLessThan(routerInvalidateMock.mock.invocationCallOrder[0] ?? 0);
	});

	it.each([
		{
			code: "auth.invalid_origin" as const,
			message: "Refresh the page and try again.",
			status: 403,
		},
		{
			code: "auth.unauthenticated" as const,
			message: "Sign in again to continue.",
			status: 400,
		},
		{
			code: "invalid_payload" as const,
			message: "Choose a valid organization.",
			status: 400,
		},
		{
			code: "organization.membership_required" as const,
			message: "You must be a member of this organization before selecting it.",
			status: 403,
		},
		{
			code: "upstream_error" as const,
			message: "OpenMeld couldn't save your organization. Try again.",
			status: 500,
		},
		{
			code: "upstream_error" as const,
			message: "OpenMeld couldn't verify your session. Try again.",
			status: 500,
		},
		{
			code: "upstream_unreachable" as const,
			message: "OpenMeld couldn't reach authentication. Try again.",
			status: 503,
		},
		{
			code: "upstream_unreachable" as const,
			message: "OpenMeld couldn't reach the auth upstream for this request.",
			status: 502,
		},
	])("shows the shared Auth $code message without exposing raw JSON", async ({
		code,
		message,
		status,
	}) => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			],
		};
		const errorEnvelope =
			selectLastSelectedOrganizationErrorResponseSchema.parse({
				error: {
					code,
					message,
					requestId: `request-${status}`,
				},
				ok: false,
			});
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(errorEnvelope, { status }));
		vi.stubGlobal("fetch", fetchMock);
		const actualPreference = await vi.importActual<
			typeof import("#/lib/organizations/account-organization-preference")
		>("#/lib/organizations/account-organization-preference");
		selectLastSelectedOrganizationMock.mockImplementationOnce(
			actualPreference.selectLastSelectedOrganization
		);
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);

		const visibleError = await screen.findByText(message);
		expect(visibleError.textContent).toBe(message);
		expect(screen.queryByText(JSON.stringify(errorEnvelope))).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();
		expect(routerInvalidateMock).not.toHaveBeenCalled();
	});

	it("keeps a failed Organization switch visible and announced in the collapsed selector", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			],
		};
		const errorEnvelope =
			selectLastSelectedOrganizationErrorResponseSchema.parse({
				error: {
					code: "auth.unauthenticated",
					message: "Sign in again to continue.",
					requestId: "request-collapsed-rail",
				},
				ok: false,
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(Response.json(errorEnvelope, { status: 400 }))
		);
		const actualPreference = await vi.importActual<
			typeof import("#/lib/organizations/account-organization-preference")
		>("#/lib/organizations/account-organization-preference");
		selectLastSelectedOrganizationMock.mockImplementationOnce(
			actualPreference.selectLastSelectedOrganization
		);
		renderRail({ tier: "icon", width: "8rem" });

		const selector = screen.getByRole("button", {
			name: "Switch organization",
		});
		fireEvent.click(selector);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);

		await screen.findByText("Sign in again to continue.");
		const status = screen.getByRole("status");
		expect(status.textContent).toBe("Sign in again to continue.");
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(selector.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("menu").contains(status)).toBe(true);
		expect(screen.queryByText(JSON.stringify(errorEnvelope))).toBeNull();
		expect(navigateMock).not.toHaveBeenCalled();

		selectLastSelectedOrganizationMock.mockResolvedValueOnce({
			ok: true,
			organizationId: "org-beta",
		});
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);
		await waitFor(() => {
			expect(selector.getAttribute("aria-expanded")).toBe("false");
			expect(screen.queryByText("Sign in again to continue.")).toBeNull();
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/beta/spaces",
			});
		});
	});

	it("clears an Organization switch failure when the selector is dismissed", async () => {
		appOrganization.organizations = [
			appOrganization.currentOrganization,
			{
				id: "org-beta",
				name: "Beta",
				slug: "beta",
			},
		];
		selectLastSelectedOrganizationMock.mockRejectedValueOnce(
			new Error("Sign in again to continue.")
		);
		renderRail();

		const selector = screen.getByRole("button", {
			name: "Switch organization",
		});
		fireEvent.click(selector);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);
		await screen.findByText("Sign in again to continue.");

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => {
			expect(selector.getAttribute("aria-expanded")).toBe("false");
			expect(screen.queryByText("Sign in again to continue.")).toBeNull();
		});

		fireEvent.click(selector);
		expect(screen.queryByText("Sign in again to continue.")).toBeNull();
	});

	it("opens the target Spaces list without carrying the current Space id", async () => {
		appOrganization = {
			activeOrganization: null,
			currentOrganization: {
				id: "org-acme",
				name: "Acme",
				slug: "acme",
			},
			organizations: [
				{
					id: "org-acme",
					name: "Acme",
					slug: "acme",
				},
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			],
		};
		routerLocation = {
			pathname: "/o/acme/spaces/space-acme",
			searchStr: "?profileId=agt_acme",
		};
		renderRail();

		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
		);
		fireEvent.click(
			screen.getByRole("menuitemradio", {
				name: BETA_ORGANIZATION_NAME_PATTERN,
			})
		);

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/beta/spaces",
			});
		});
	});

	it("toggles the sidebar hidden and expanded with Command+B and Control+B", () => {
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
		renderRail();

		const rail = screen.getByTestId("app-outer-rail");
		expect(rail.getAttribute("data-state")).toBe("expanded");

		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(rail.getAttribute("data-state")).toBe("hidden");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true });
		expect(rail.getAttribute("data-state")).toBe("expanded");

		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(rail.getAttribute("data-state")).toBe("hidden");
	});

	it("does not let the hidden desktop rail handle its shortcut below the desktop breakpoint", () => {
		vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
		renderRail();

		const rail = screen.getByTestId("app-outer-rail");
		fireEvent.keyDown(window, { key: "b", metaKey: true });

		expect(rail.getAttribute("data-state")).toBe("expanded");
	});

	it("keeps the app section active state on route matches during navigation intent", () => {
		const rendered = renderRail();

		const spacesLink = screen.getByRole("link", { name: "Spaces" });
		const settingsLink = screen.getByRole("link", { name: "Settings" });

		expect(spacesLink.getAttribute("aria-current")).toBe("page");
		expect(settingsLink.getAttribute("aria-current")).toBeNull();

		fireEvent.pointerDown(settingsLink, { button: 0 });

		expect(spacesLink.getAttribute("aria-current")).toBe("page");
		expect(settingsLink.getAttribute("aria-current")).toBeNull();

		appShellSection = "settings";
		rendered.rerender(buildRailElement());

		expect(spacesLink.getAttribute("aria-current")).toBeNull();
		expect(settingsLink.getAttribute("aria-current")).toBe("page");
	});

	it("derives direct, back, and forward selection from route matches", () => {
		routerLocation = {
			pathname: "/o/acme",
			searchStr: "",
		};
		appShellSection = "home";

		const rendered = renderRail();

		const homeLink = screen.getByRole("link", { name: "Home" });
		const spacesLink = screen.getByRole("link", { name: "Spaces" });

		expect(homeLink.getAttribute("aria-current")).toBe("page");
		expect(spacesLink.getAttribute("aria-current")).toBeNull();
		expect(
			spacesLink.className.split(CLASS_NAME_SEGMENT_SEPARATOR_PATTERN)
		).not.toContain("active");

		routerLocation = {
			pathname: "/o/acme/spaces",
			searchStr: "",
		};
		appShellSection = "space";
		rendered.rerender(buildRailElement());

		expect(homeLink.getAttribute("aria-current")).toBeNull();
		expect(spacesLink.getAttribute("aria-current")).toBe("page");

		routerLocation = {
			pathname: "/o/acme/center-agent/skills",
			searchStr: "",
		};
		appShellSection = "centerAgent";
		rendered.rerender(buildRailElement());

		expect(homeLink.getAttribute("aria-current")).toBe("page");
		expect(spacesLink.getAttribute("aria-current")).toBeNull();
	});

	it("keeps Computers out of the main app rail", () => {
		renderRail();

		expect(screen.queryByRole("link", { name: "Computers" })).toBeNull();
	});

	it("prefers the latest client state over stale route loader state after remount", () => {
		rememberClientSidebarState("outer", { tier: "icon", width: "8rem" });
		renderRail({ tier: "expanded", width: "9rem" });

		expect(
			screen.getByTestId("app-outer-rail").getAttribute("data-state")
		).toBe("icon");
	});

	it("keeps collapsed header controls and the account footer reachable", () => {
		rememberClientSidebarState("outer", { tier: "icon", width: "8rem" });
		renderRail();
		const rail = screen.getByTestId("app-outer-rail");
		const header = rail.querySelector("[data-sidebar=header]") as HTMLElement;
		const footer = rail.querySelector("[data-sidebar=footer]") as HTMLElement;
		expect(
			within(header).getByRole("button", { name: "Switch organization" })
		).toBeTruthy();
		expect(
			within(header).getByRole("button", { name: TOGGLE_TRIGGER_NAME_PATTERN })
		).toBeTruthy();
		expect(within(header).getByRole("link", { name: "Inbox" })).toBeTruthy();
		expect(
			within(footer).getByRole("button", { name: USER_MENU_PATTERN })
		).toBeTruthy();
	});
});

function renderRail(
	input: {
		account?: typeof TEST_ACCOUNT;
		collapsedGroupIds?: readonly string[];
		tier?: SidebarTier;
		width?: string;
	} = {}
) {
	return render(buildRailElement(input));
}

function buildRailElement(
	input: {
		account?: typeof TEST_ACCOUNT;
		collapsedGroupIds?: readonly string[];
		tier?: SidebarTier;
		width?: string;
	} = {}
) {
	const initialState = {
		collapsedGroupIds: input.collapsedGroupIds,
		tier: input.tier ?? "expanded",
		width: input.width ?? "9rem",
	};
	return (
		<TestQueryClientProvider>
			<TooltipProvider>
				<AppOuterRail
					account={input.account ?? TEST_ACCOUNT}
					initialState={initialState}
				/>
			</TooltipProvider>
		</TestQueryClientProvider>
	);
}
