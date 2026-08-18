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
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import {
	rememberClientSidebarState,
	type SidebarTier,
} from "#/lib/sidebar-width-cookie";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AppOuterRail } from "./app-outer-rail";
import type { AppShellSection } from "./shell-layout";

const BETA_ORGANIZATION_NAME_PATTERN = /Beta/;
const navigateMock = vi.fn();
const routerInvalidateMock = vi.fn();
const useAccountAvatarMock = vi.hoisted(() => vi.fn());
const useDefaultHumanProfileMock = vi.hoisted(() => vi.fn());
const prefetchCenterAgentConversationMock = vi.hoisted(() => vi.fn());
const selectLastSelectedOrganizationMock = vi.hoisted(() => vi.fn());
let routerLocation = {
	pathname: "/o/acme/spaces",
	searchStr: "",
};
let appShellSection: AppShellSection = "space";
let centerAgentUnreadCount = 0;
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
}));

vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: useDefaultHumanProfileMock,
}));

vi.mock("#/hooks/account.hooks", () => ({
	useAccountAvatar: useAccountAvatarMock,
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
const CREATE_ORGANIZATION_MENU_ITEM_NAME = /Create organization/;
const FELIX_MENU_ITEM_NAME = /Felix/;
const TOGGLE_TRIGGER_NAME_PATTERN = /Toggle/;
const INBOX_LINK_NAME_PATTERN = /^Inbox/;
const CLASS_NAME_SEGMENT_SEPARATOR_PATTERN = /\s+/u;
const PRIMARY_RAIL_LABELS = [
	"Home",
	"Center Agent",
	"Spaces",
	"Direct Messages",
	"People",
	"Agents",
	"Computers",
	"Projects",
	"Documents",
	"Agent Activity",
] as const;

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
		prefetchCenterAgentConversationMock.mockReset();
		selectLastSelectedOrganizationMock.mockReset().mockResolvedValue({
			ok: true,
			organizationId: "org-beta",
		});
		appShellSection = "space";
		centerAgentUnreadCount = 0;
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
		rememberClientSidebarState("outer", { tier: "full", width: "9rem" });
	});

	afterEach(() => {
		cleanup();
		rememberClientSidebarState("outer", { tier: "full", width: "9rem" });
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("keeps Settings as the final footer utility without a separate account entry", () => {
		renderRail();

		const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
		const settingsLink = screen.getByRole("link", { name: "Settings" });
		const footer = settingsLink.closest("[data-sidebar=footer]");
		const footerActions = Array.from(
			footer?.querySelectorAll("button, a") ?? []
		);
		expect(footerActions.indexOf(trigger)).toBeLessThan(
			footerActions.indexOf(settingsLink)
		);
		expect(footerActions.at(-1)).toBe(settingsLink);
		expect(
			within(footer as HTMLElement).queryByRole("button", {
				name: "Send feedback",
			})
		).toBeNull();
		expect(within(footer as HTMLElement).getAllByRole("link")).toEqual([
			settingsLink,
		]);
		expect(
			Array.from(footer?.children ?? []).some((child) =>
				child.classList.contains("border-t")
			)
		).toBe(false);
		expect(trigger.className).not.toContain("bg-background");
		expect(trigger.querySelector("svg")).toBeTruthy();
	});

	it("places the organization switcher at the top without OpenMeld branding", () => {
		renderRail();

		const rail = screen.getByTestId("app-outer-rail");
		const header = rail.querySelector('[data-slot="sidebar-header"]');
		expect(header).toBeInstanceOf(HTMLElement);
		if (!(header instanceof HTMLElement)) {
			return;
		}

		expect(
			within(header).getByRole("button", { name: "Switch organization" })
		).toBeTruthy();
		expect(within(header).queryByRole("link")).toBeNull();
		expect(screen.queryByLabelText("Go to OpenMeld homepage")).toBeNull();
		expect(screen.queryByText("Experimental")).toBeNull();
	});

	it("aligns the resize rule with the inset surface boundary", () => {
		renderRail();

		const resizeRail = screen.getByRole("separator", {
			name: "Resize app rail",
		});

		expect(resizeRail.className).toContain("after:top-2");
		expect(resizeRail.className).toContain("after:bottom-9");
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
		expect(selector.className).toContain("h-9");
		expect(selector.className).toContain("rounded-md");
		expect(selector.className).not.toContain("bg-muted/20");
		expect(avatar?.className).toContain("size-5");
		expect(avatar?.className).not.toContain("size-7");
	});

	it("uses a compact type scale and grouped spacing in the full rail", () => {
		renderRail({ tier: "full", width: "13.75rem" });

		const centerAgentLink = screen.getByRole("link", {
			name: "Center Agent",
		});
		expect(centerAgentLink.className).toContain("h-7");
		expect(centerAgentLink.className).toContain("text-[13px]");

		const groups = screen
			.getByTestId("app-outer-rail")
			.querySelectorAll('[data-slot="sidebar-group"]');
		expect(groups).toHaveLength(4);
		expect(groups[1]?.className).toContain("mt-5");
		expect(groups[2]?.className).toContain("mt-5");
		expect(groups[3]?.className).toContain("mt-5");
	});

	it("warms the Center Agent conversation from primary navigation intent", () => {
		renderRail();

		fireEvent.pointerEnter(screen.getByRole("link", { name: "Center Agent" }));

		expect(prefetchCenterAgentConversationMock).toHaveBeenCalledOnce();
	});

	it("center-truncates destination labels when the full rail is narrow", () => {
		renderRail({ tier: "full", width: "9rem" });

		const agentActivityLink = screen.getByRole("link", {
			name: "Agent Activity",
		});
		const centerTruncatedLabel = agentActivityLink.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);

		expect(centerTruncatedLabel).toBeTruthy();
		expect(
			centerTruncatedLabel?.querySelector(
				'[data-slot="center-truncated-text-start"]'
			)?.textContent
		).toBe("Agent A");
		expect(
			centerTruncatedLabel?.querySelector(
				'[data-slot="center-truncated-text-end"]'
			)?.textContent
		).toBe("ctivity");
		expect(agentActivityLink.querySelector("span.truncate")).toBeNull();
	});

	it("renders the collapsed organization selector without selector or avatar borders", () => {
		rememberClientSidebarState("outer", { tier: "collapsed", width: "8rem" });
		renderRail({ tier: "full", width: "9rem" });

		const selector = screen.getByRole("button", {
			name: "Switch organization",
		});
		const avatar = selector.querySelector('[aria-hidden="true"]');
		expect(selector.className).not.toContain("border-border");
		expect(avatar?.className).not.toContain("border-border");
	});

	it("centers collapsed navigation items on the same rail axis as the header and footer", () => {
		rememberClientSidebarState("outer", { tier: "collapsed", width: "8rem" });
		renderRail({ tier: "full", width: "9rem" });

		const content = screen
			.getByTestId("app-outer-rail")
			.querySelector('[data-slot="sidebar-content"]');

		expect(content?.className).toContain("px-2");
		expect(content?.className).not.toContain("px-3");
	});

	it("uses app tooltips instead of native titles for collapsed rail controls", () => {
		rememberClientSidebarState("outer", { tier: "collapsed", width: "8rem" });
		renderRail({ tier: "full", width: "9rem" });

		for (const label of [
			"Center Agent",
			"Spaces",
			"Direct Messages",
			"People",
			"Agents",
			"Computers",
			"Agent Activity",
			"Documents",
			"Projects",
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

	describe("compact tier", () => {
		// resolveClientSidebarInitialState prefers the client memory cache over
		// the initialState prop (see the top-level beforeEach), so exercising a
		// specific tier here means seeding that cache first, same as the
		// existing collapsed-tier tests above.
		function renderCompactRail() {
			rememberClientSidebarState("outer", { tier: "compact", width: "9rem" });
			renderRail({ tier: "compact", width: "9rem" });
		}

		it("shows icon and label stacked for nav items, with no tooltip wrapper", () => {
			renderCompactRail();

			for (const label of [
				"Spaces",
				"People",
				"Agents",
				"Computers",
				"Agent Activity",
				"Documents",
				"Projects",
			]) {
				const link = screen.getByRole("link", { name: label });
				expect(link.textContent).toContain(label);
				expect(link.getAttribute("data-slot")).not.toBe("tooltip-trigger");
				expect(link.className).toContain("flex-col");
				expect(
					link.querySelector('[data-slot="center-truncated-text"]')
				).toBeTruthy();
			}
		});

		it("shows DMs visually while preserving the Direct Messages link name", () => {
			renderCompactRail();

			const directMessagesLink = screen.getByRole("link", {
				name: "Direct Messages",
			});
			expect(directMessagesLink.textContent).toContain("DMs");
			expect(directMessagesLink.textContent).not.toContain("Direct Messages");
			expect(
				directMessagesLink.querySelector('[data-slot="center-truncated-text"]')
			).toBeNull();
		});

		it("keeps compact active labels away from the highlighter edges", () => {
			renderCompactRail();

			const content = screen
				.getByTestId("app-outer-rail")
				.querySelector('[data-slot="sidebar-content"]');

			expect(content?.className).toContain("px-2");
			expect(content?.className).not.toContain("px-3");
		});

		it("shows only the organization logo in the organization switcher", () => {
			appOrganization.currentOrganization = {
				...appOrganization.currentOrganization,
				logo: "https://gateway.example/acme-logo.webp",
			};
			appOrganization.organizations = [appOrganization.currentOrganization];
			renderCompactRail();

			const selector = screen.getByRole("button", {
				name: "Switch organization",
			});
			const avatar = selector.querySelector<HTMLElement>(
				'[aria-hidden="true"]'
			);
			expect(selector.textContent).toBe("");
			expect(avatar?.style.backgroundImage).toBe(
				'url("https://gateway.example/acme-logo.webp")'
			);
			expect(avatar?.className).toContain("rounded-sm");
			expect(selector.className).toContain("justify-center");
			expect(selector.getAttribute("data-slot")).not.toBe("tooltip-trigger");
		});

		it("shows only the personal avatar in the organization switcher", () => {
			const personalOrganization = {
				id: "org-personal",
				isPersonal: true,
				name: "Felix",
				slug: "felix",
			};
			appOrganization = {
				activeOrganization: personalOrganization,
				currentOrganization: personalOrganization,
				organizations: [personalOrganization],
			};
			renderCompactRail();

			const selector = screen.getByRole("button", {
				name: "Switch organization",
			});
			expect(selector.textContent).toBe("F");
			expect(selector.textContent).not.toContain("Felix");
			expect(selector.className).toContain("justify-center");
		});

		it("shows organization switch errors inside the compact selector", async () => {
			appOrganization.organizations = [
				appOrganization.currentOrganization,
				{
					id: "org-beta",
					name: "Beta",
					slug: "beta",
				},
			];
			navigateMock.mockRejectedValueOnce(
				new Error("Organization switch failed.")
			);
			renderCompactRail();

			fireEvent.click(
				screen.getByRole("button", { name: "Switch organization" })
			);
			fireEvent.click(
				screen.getByRole("menuitemradio", {
					name: BETA_ORGANIZATION_NAME_PATTERN,
				})
			);

			await screen.findByText("Organization switch failed.");
			const status = screen.getByRole("status");
			expect(status.textContent).toBe("Organization switch failed.");
			expect(screen.getByRole("menu").contains(status)).toBe(true);
		});

		it("keeps the organization switcher in the header and the toggle in the footer", () => {
			renderCompactRail();

			const rail = screen.getByTestId("app-outer-rail");
			const header = rail.querySelector('[data-slot="sidebar-header"]');
			const content = rail.querySelector('[data-slot="sidebar-content"]');
			const footer = rail.querySelector('[data-slot="sidebar-footer"]');
			expect(header).toBeTruthy();
			expect(content).toBeTruthy();
			expect(footer).toBeTruthy();
			if (
				!(
					header instanceof HTMLElement &&
					content instanceof HTMLElement &&
					footer instanceof HTMLElement
				)
			) {
				return;
			}

			expect(
				within(header).getByRole("button", {
					name: "Switch organization",
				})
			).toBeTruthy();
			expect(
				within(content).queryByRole("button", {
					name: TOGGLE_TRIGGER_NAME_PATTERN,
				})
			).toBeNull();
			expect(
				within(footer).getByRole("button", { name: "Toggle" })
			).toBeTruthy();
		});

		it("keeps the toggle label visible below its icon", () => {
			renderCompactRail();

			// Shortened from "Toggle Sidebar" in this tier — see the component.
			const toggle = screen.getByRole("button", { name: "Toggle" });
			expect(toggle.className).toContain("flex-col");
			expect(screen.queryByRole("button", { name: "Feedback" })).toBeNull();
		});
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

	it("opens the canonical Direct Messages home", () => {
		renderRail();

		const directMessagesLink = screen.getByRole("link", {
			name: "Direct Messages",
		});
		expect(directMessagesLink.getAttribute("href")).toBe(
			"/o/acme/direct-messages"
		);
	});

	it("groups destinations under stable non-collapsible labels", () => {
		renderRail();

		const railContent = screen
			.getByTestId("app-outer-rail")
			.querySelector('[data-slot="sidebar-content"]');
		expect(railContent).toBeInstanceOf(HTMLElement);
		if (!(railContent instanceof HTMLElement)) {
			return;
		}

		const workHeading = within(railContent).getByRole("heading", {
			name: "Work",
		});
		const teamHeading = within(railContent).getByRole("heading", {
			name: "Team",
		});
		const resourcesHeading = within(railContent).getByRole("heading", {
			name: "Resources",
		});
		expect(workHeading).toBeTruthy();
		expect(teamHeading).toBeTruthy();
		expect(resourcesHeading).toBeTruthy();
		for (const heading of [workHeading, teamHeading, resourcesHeading]) {
			expect(heading.className).toContain("ps-[5px]");
			expect(heading.className).toContain("pe-2");
			expect(heading.className).not.toContain("px-2");
		}
		expect(
			workHeading
				.closest('[data-slot="sidebar-group"]')
				?.classList.contains("gap-2")
		).toBe(true);
		expect(
			teamHeading
				.closest('[data-slot="sidebar-group"]')
				?.classList.contains("gap-2")
		).toBe(true);
		expect(
			resourcesHeading
				.closest('[data-slot="sidebar-group"]')
				?.classList.contains("gap-2")
		).toBe(true);
		expect(
			within(railContent).getByRole("navigation", { name: "Work" })
		).toBeTruthy();
		expect(
			within(railContent).getByRole("navigation", { name: "Team" })
		).toBeTruthy();
		expect(
			within(railContent).getByRole("navigation", { name: "Resources" })
		).toBeTruthy();
		expect(
			within(railContent).queryByRole("button", { name: "Work" })
		).toBeNull();
		expect(
			within(railContent).queryByRole("button", { name: "Team" })
		).toBeNull();
		expect(
			within(railContent).queryByRole("button", { name: "Resources" })
		).toBeNull();
	});

	it("renders the fixed primary rail order", () => {
		renderRail();

		const railContent = screen
			.getByTestId("app-outer-rail")
			.querySelector('[data-slot="sidebar-content"]');
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

	it("keeps Inbox out of the primary outer rail", () => {
		renderRail();

		expect(
			screen.queryByRole("link", { name: INBOX_LINK_NAME_PATTERN })
		).toBeNull();
	});

	it("uses the channel hash icon for Spaces", () => {
		renderRail();

		const spacesLink = screen.getByRole("link", { name: "Spaces" });

		expect(
			spacesLink.querySelector('[data-space-icon="channel"]')
		).toBeTruthy();
	});

	it.each([
		"collapsed",
		"compact",
		"full",
	] as const)("shows an accessible amber Center Agent unread dot in the %s tier", async (tier) => {
		centerAgentUnreadCount = 2;
		rememberClientSidebarState("outer", {
			tier,
			width: tier === "collapsed" ? "8rem" : "9rem",
		});
		renderRail({ tier });

		const link = await screen.findByRole("link", {
			name: "Center Agent, 2 unread replies",
		});
		const indicator = link.querySelector(
			'[data-app-rail-status-indicator="center-agent-unread"]'
		);
		expect(indicator).toBeTruthy();
		expect(indicator?.className).toContain("bg-amber-400");
		expect(indicator?.textContent).toBe("");
	});

	it.each([
		"collapsed",
		"compact",
		"full",
	] as const)("keeps all ten product destinations in the same order for personal and organization workspaces in the %s tier", (tier) => {
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
				width: tier === "collapsed" ? "8rem" : "9rem",
			});

			const view = renderRail({ tier });
			const railContent = screen
				.getByTestId("app-outer-rail")
				.querySelector('[data-slot="sidebar-content"]');
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
		const globalActions = within(menu).getByRole("group", {
			name: "Global actions",
		});
		expect(
			within(globalActions).getByRole("menuitem", { name: "Settings" })
		).toBeTruthy();
		expect(globalActions.className).toContain("border-t");
		expect(
			(choices[1] as HTMLElement).querySelector<HTMLElement>(
				'[aria-hidden="true"]'
			)?.className
		).toContain("rounded-sm");
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

	it("opens global Settings from the organization switcher and keeps the rail entry", async () => {
		renderRail();

		const railSettingsLink = screen.getByRole("link", { name: "Settings" });
		fireEvent.click(
			screen.getByRole("button", { name: "Switch organization" })
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
		renderRail({ tier: "collapsed", width: "8rem" });

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

	it("cycles the outer rail collapsed -> compact -> full with Command+B and Control+B", () => {
		renderRail();

		const rail = screen.getByTestId("app-outer-rail");
		expect(rail.getAttribute("data-state")).toBe("expanded");

		fireEvent.keyDown(window, { key: "b", metaKey: true });
		expect(rail.getAttribute("data-state")).toBe("collapsed");

		fireEvent.keyDown(window, { key: "B", ctrlKey: true });
		expect(rail.getAttribute("data-state")).toBe("compact");

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
			pathname: "/o/acme/center-agent/chat",
			searchStr: "",
		};
		appShellSection = "centerAgent";

		const rendered = renderRail();

		const centerAgentLink = screen.getByRole("link", {
			name: "Center Agent",
		});
		const spacesLink = screen.getByRole("link", { name: "Spaces" });

		expect(centerAgentLink.getAttribute("aria-current")).toBe("page");
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

		expect(centerAgentLink.getAttribute("aria-current")).toBeNull();
		expect(spacesLink.getAttribute("aria-current")).toBe("page");

		routerLocation = {
			pathname: "/o/acme/center-agent/chat",
			searchStr: "",
		};
		appShellSection = "centerAgent";
		rendered.rerender(buildRailElement());

		expect(centerAgentLink.getAttribute("aria-current")).toBe("page");
		expect(spacesLink.getAttribute("aria-current")).toBeNull();
	});

	it.each([
		[
			"warning",
			"collapsed",
			"Computers, needs attention",
			"overlay",
			["bg-amber-700", "dark:bg-amber-400"],
		],
		[
			"warning",
			"compact",
			"Computers, needs attention",
			"overlay",
			["bg-amber-700", "dark:bg-amber-400"],
		],
		[
			"warning",
			"full",
			"Computers, needs attention",
			"trailing",
			["bg-amber-700", "dark:bg-amber-400"],
		],
		[
			"danger",
			"collapsed",
			"Computers, needs attention",
			"overlay",
			["bg-destructive"],
		],
		[
			"danger",
			"compact",
			"Computers, needs attention",
			"overlay",
			["bg-destructive"],
		],
		[
			"danger",
			"full",
			"Computers, needs attention",
			"trailing",
			["bg-destructive"],
		],
	] as const)("shows a tone-matched Computers attention dot for %s attention in the %s tier", (computerAttentionTone, tier, accessibleName, placement, expectedDotClassNames) => {
		rememberClientSidebarState("outer", {
			tier,
			width: tier === "collapsed" ? "8rem" : "9rem",
		});
		renderRail({ computerAttentionTone, tier });

		const computersLink = screen.getByRole("link", {
			name: accessibleName,
		});
		const indicator = computersLink.querySelector(
			'[data-app-rail-status-indicator="computer-attention"]'
		);
		expect(indicator).toBeTruthy();
		for (const expectedDotClassName of expectedDotClassNames) {
			expect(indicator?.className).toContain(expectedDotClassName);
		}
		expect(indicator?.getAttribute("data-app-rail-status-placement")).toBe(
			placement
		);
		expect(computersLink.className).not.toContain("!text-amber-300");
		expect(computersLink.className).not.toContain("!text-destructive");
		expect(computersLink.querySelector("svg")?.className.baseVal).not.toContain(
			"text-amber-300"
		);
		expect(computersLink.querySelector("svg")?.className.baseVal).not.toContain(
			"text-destructive"
		);
	});

	it("prefers the latest client state over stale route loader state after remount", () => {
		rememberClientSidebarState("outer", { tier: "collapsed", width: "8rem" });
		renderRail({ tier: "full", width: "9rem" });

		expect(
			screen.getByTestId("app-outer-rail").getAttribute("data-state")
		).toBe("collapsed");
	});

	it("keeps the collapsed organization switcher at the top and the toggle in the footer", () => {
		rememberClientSidebarState("outer", { tier: "collapsed", width: "8rem" });
		renderRail({ tier: "full", width: "9rem" });

		const rail = screen.getByTestId("app-outer-rail");
		const header = rail.querySelector('[data-slot="sidebar-header"]');
		const content = rail.querySelector('[data-slot="sidebar-content"]');
		const footer = rail.querySelector('[data-slot="sidebar-footer"]');
		expect(header).toBeTruthy();
		expect(content).toBeTruthy();
		expect(footer).toBeTruthy();
		if (
			!(
				header instanceof HTMLElement &&
				content instanceof HTMLElement &&
				footer instanceof HTMLElement
			)
		) {
			return;
		}

		expect(
			within(header).getByRole("button", { name: "Switch organization" })
		).toBeTruthy();
		expect(within(header).queryByRole("link")).toBeNull();
		expect(
			within(header).queryByRole("button", { name: "Toggle Sidebar" })
		).toBeNull();
		expect(
			within(content).queryByRole("button", { name: "Toggle Sidebar" })
		).toBeNull();

		const trigger = within(footer).getByRole("button", {
			name: "Toggle Sidebar",
		});
		const footerActions = Array.from(footer.querySelectorAll("button, a"));
		expect(footerActions.indexOf(trigger)).toBeLessThan(
			footerActions.indexOf(
				within(footer).getByRole("link", { name: "Settings" })
			)
		);
		expect(
			within(footer).queryByRole("button", { name: "Send feedback" })
		).toBeNull();
	});
});

function renderRail(
	input: {
		account?: typeof TEST_ACCOUNT;
		computerAttentionTone?: "warning" | "danger" | null;
		tier?: SidebarTier;
		width?: string;
	} = {}
) {
	return render(buildRailElement(input));
}

function buildRailElement(
	input: {
		account?: typeof TEST_ACCOUNT;
		computerAttentionTone?: "warning" | "danger" | null;
		tier?: SidebarTier;
		width?: string;
	} = {}
) {
	const initialState = {
		tier: input.tier ?? "full",
		width: input.width ?? "9rem",
	};
	return (
		<TestQueryClientProvider>
			<TooltipProvider>
				<AppOuterRail
					account={input.account ?? TEST_ACCOUNT}
					computerAttentionTone={input.computerAttentionTone}
					initialState={initialState}
				/>
			</TooltipProvider>
		</TestQueryClientProvider>
	);
}
