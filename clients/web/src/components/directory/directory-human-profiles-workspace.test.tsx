import type {
	LocalRuntimeComputer,
	ModelCatalog,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DirectoryHumanProfilesWorkspace } from "./directory-human-profiles-workspace";
import {
	EMPTY_PEOPLE_SIDEBAR,
	resolvePeopleSections,
	sortSidebarPeople,
} from "./people-sidebar-order";

vi.mock("./team-sidebar-header", () => ({
	TeamSidebarHeader: () => <h2>Team</h2>,
	TeamSidebarHeaderActionsProvider: ({ children }: { children: ReactNode }) =>
		children,
	TeamSidebarHeaderAction: () => null,
}));

const ENABLED_LOCAL_AGENT_SUMMARY_PATTERN =
	/Claude Code enabled, Codex enabled, Cursor enabled/;
const LOCAL_AGENT_LOGO_TEST_ID_PATTERN = /^local-agent-logo-/;
const TEST_MODEL_CATALOG: ModelCatalog = {
	agentControllers: {
		codex: {
			defaultModelId: "gpt-5.6-sol",
			models: [
				{
					displayName: "GPT-5.6 Sol",
					id: "gpt-5.6-sol",
					minCliVersion: null,
					supportedReasoningLevels: ["low", "medium", "high"],
					unavailable: false,
				},
			],
		},
	},
	schemaVersion: 1,
	updatedAt: "2026-09-03T00:00:00.000Z",
};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-test", slug: "org-test" },
		currentUserId: "viewer",
	}),
}));
const testPresence = vi.hoisted(() => new Map<string, "online" | "offline">());
const sidebarPending = vi.hoisted(() => ({ value: false }));
beforeEach(() => {
	sidebarPending.value = false;
	testPresence.clear();
	testPresence.set("profile-current", "online");
	testPresence.set("profile-grace", "offline");
	testPresence.set("online-person", "online");
});
vi.mock("#/components/profiles/human-presence", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/components/profiles/human-presence")
	>()),
	useHumanPresence: () => testPresence,
}));
vi.mock("../app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			pinned: { sort: "priority", spaceIds: [] },
			spaces: { sort: "priority", spaceIds: [] },
			groups: [],
		},
		disabled: false,
		save: vi.fn(),
		isError: false,
		get isPending() {
			return sidebarPending.value;
		},
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		search,
		to,
	}: {
		children: ReactNode;
		search?: { profileId?: string };
		to: string;
	}) => (
		<a
			href={`${to}${search?.profileId ? `?profileId=${search.profileId}` : ""}`}
		>
			{children}
		</a>
	),
}));

vi.mock("@openmeld/ui/fluid/nav-menu", () => ({
	FluidNavMenu: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	FluidNavMenuItem: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

vi.mock("@openmeld/ui/components/local-agent-logo", async (original) => ({
	...(await original<
		typeof import("@openmeld/ui/components/local-agent-logo")
	>()),
	LocalAgentLogo: ({
		agentId,
		variant,
	}: {
		agentId: string;
		variant?: string;
	}) => (
		<span data-testid={`local-agent-logo-${agentId}`} data-variant={variant} />
	),
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualSidebarNav: (props: {
		ariaLabel: string;
		groups: readonly {
			content: ReactNode;
			label: string;
			labelTooltip?: string;
		}[];
		leadingContent?: ReactNode;
		title: string;
	}) => (
		<nav aria-label={props.ariaLabel}>
			<h2>{props.title}</h2>
			{props.leadingContent}
			{props.groups.map((group) => (
				<section aria-label={group.label} key={group.label}>
					{group.labelTooltip ? (
						<span data-testid="group-tooltip">{group.labelTooltip}</span>
					) : null}
					{group.content}
				</section>
			))}
		</nav>
	),
}));

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		showMainHeader,
		mainSidebar,
	}: {
		children: ReactNode;
		showMainHeader?: boolean;
		mainSidebar?: { content: ReactNode };
	}) => (
		<div>
			{mainSidebar?.content}
			<main data-show-main-header={showMainHeader ? "true" : "false"}>
				{children}
			</main>
		</div>
	),
}));

vi.mock("#/components/app/app-navigation-presentation", () => ({
	useAppNavigationPresentation: () => ({ dismiss: vi.fn() }),
}));

vi.mock("#/components/directory/directory-human-profile-avatar", () => ({
	DirectoryHumanProfileAvatar: (props: {
		context: string;
		member: DirectoryHumanProfileRow;
	}) => (
		<span data-testid={`${props.context}-avatar-${props.member.id}`}>
			{props.member.name.slice(0, 1)}
		</span>
	),
}));

vi.mock("#/components/computers/computers-picker", () => ({
	ComputersPicker: (props: {
		computerGroups: readonly OrganizationComputerGroup[];
		profileId?: string;
	}) => (
		<div
			data-profile-id={props.profileId}
			data-testid="profile-computers-picker"
		>
			{props.computerGroups[0]?.computers.map((computer) => (
				<span key={computer.routeId}>{computer.deviceDisplayName}</span>
			))}
			{props.computerGroups[0]?.isCurrentUser ? (
				<button type="button">Add a Computer</button>
			) : null}
		</div>
	),
}));

vi.mock("./center-agent-item", () => ({
	CenterAgentItem: () => <span>Workspace assistant</span>,
}));

describe("DirectoryHumanProfilesWorkspace", () => {
	it("shows known people while personal sidebar settings are still loading", () => {
		sidebarPending.value = true;
		renderWorkspace({
			members: [
				buildMember({ current: true }),
				buildMember({ current: false }),
			],
			selectedProfileId: null,
		});
		expect(screen.queryByRole("region", { name: "Loading people" })).toBeNull();
		expect(screen.queryByRole("region", { name: "Loading team" })).toBeNull();
		const team = within(screen.getByRole("tabpanel"));
		expect(
			team.getByRole("button", { name: "Open Felix's profile" })
		).toBeTruthy();
		expect(
			team.getByRole("button", { name: "Open Grace Hopper's profile" })
		).toBeTruthy();
	});

	it("uses the same placement and self-first order for Team groups", () => {
		const self = { ...buildMember({ current: true }), name: "Zoe" };
		const other = {
			...buildMember({ current: false }),
			name: "Alice",
			presence: "online" as const,
			computer: self.computer,
		};
		for (const sort of ["priority", "name", "manual", "recent"] as const) {
			const settings = { sort, itemIds: [other.id, self.id] };
			for (const placement of ["online", "starred", "custom"]) {
				const preferences = {
					...EMPTY_PEOPLE_SIDEBAR,
					people: settings,
					...(placement === "starred" ? { starred: settings } : {}),
					groups:
						placement === "custom"
							? [{ ...settings, id: "custom", name: "Design" }]
							: [],
				};
				const sections = resolvePeopleSections([other, self], preferences);
				expect(sections.map((section) => section.id)).toEqual([placement]);
				expect(sections[0]?.members.map((member) => member.id)).toEqual([
					self.id,
					other.id,
				]);
			}
		}
	});
	it.each([
		"priority",
		"name",
		"manual",
		"recent",
	] as const)("keeps self first in Starred with %s sorting", (sort) => {
		const self = {
			...buildMember({ current: true }),
			name: "Zoe",
			lastActiveAt: null,
			joinedAt: "2020-01-01T00:00:00.000Z",
		};
		const other = {
			...buildMember({ current: false }),
			name: "Alice",
			lastActiveAt: "2026-09-07T00:00:00.000Z",
			joinedAt: "2026-09-07T00:00:00.000Z",
		};
		const settings = { sort, itemIds: [other.id, self.id] };
		expect(
			sortSidebarPeople([other, self], settings, true).map(
				(person) => person.id
			)
		).toEqual([self.id, other.id]);
		expect(
			sortSidebarPeople([other, self], settings).map((person) => person.id)
		).toEqual([other.id, self.id]);
	});
	it("keeps People human-only and groups by Human presence without a default star", () => {
		const self = buildMember({ current: true });
		const offline = buildMember({ current: false });
		const online = {
			...offline,
			id: "online-person",
			name: "Online teammate",
			computer: { ...offline.computer },
		};
		renderWorkspace({ members: [offline, online, self] });
		const sidebar = screen.getByRole("navigation", { name: "People" });
		const buttons = within(sidebar)
			.getAllByRole("button")
			.filter((button) =>
				button.getAttribute("aria-label")?.startsWith("Open ")
			);
		expect(buttons[0]?.getAttribute("aria-label")).toBe("Open Felix's profile");
		expect(
			within(screen.getByRole("region", { name: "Online" })).getByRole(
				"button",
				{ name: "Open Online teammate's profile" }
			)
		).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Online" })).getByText(
				"People using OpenMeld"
			)
		).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Offline" })).getByText(
				"People not currently active in OpenMeld"
			)
		).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Offline" })).getByRole("img", {
				name: "No computer connected",
			})
		).toBeTruthy();
		expect(
			within(sidebar)
				.getAllByRole("region")
				.map((group) => group.getAttribute("aria-label"))
		).toEqual(["Online", "Offline"]);
		expect(screen.queryByText("Workspace assistant")).toBeNull();
	});

	it("offers Computer filters at the Team level independently of Human online groups", () => {
		const self = buildMember({ current: true });
		const other = {
			...buildMember({ current: false }),
			computer: { ...self.computer },
		};
		renderWorkspace({ members: [self, other], selectedProfileId: null });
		const team = within(screen.getByRole("tabpanel"));
		fireEvent.click(team.getByLabelText("Filter team"));
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", {
				name: "Computer connected",
			})
		);
		expect(
			team.getByRole("button", { name: "Open Felix's profile" })
		).toBeTruthy();
		expect(
			team.getByRole("button", { name: "Open Grace Hopper's profile" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Online" }));
		expect(
			team.queryByRole("button", { name: "Open Grace Hopper's profile" })
		).toBeNull();
		expect(
			team.getByRole("button", { name: "Open Felix's profile" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", {
				name: "Computer connected",
			})
		);
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", {
				name: "Computer disconnected",
			})
		);
		expect(
			team.queryByRole("button", { name: "Open Felix's profile" })
		).toBeNull();
		expect(
			team.getByText("No members match your search or filters.")
		).toBeTruthy();
	});

	it("does not infer Human presence from Computer status when presence is unavailable", () => {
		const teammate = buildMember({ current: false });
		renderWorkspace({
			members: [
				{
					...teammate,
					id: "attention",
					name: "Attention",
					computer: {
						count: 1,
						label: "Computer needs attention",
						path: null,
						state: "needs_attention",
					},
				},
				{
					...teammate,
					id: "unknown",
					name: "Unknown",
					computer: {
						count: 1,
						label: "Computer status unavailable",
						path: null,
						state: "unknown",
					},
				},
			],
		});
		const offline = screen.getByRole("region", { name: "People" });
		expect(
			within(offline).getByRole("img", { name: "Computer needs attention" })
		).toBeTruthy();
		expect(
			within(offline).getByRole("img", { name: "Computer status unavailable" })
		).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "Status needs checking" })
		).toBeNull();
		expect(screen.queryByRole("region", { name: "Online" })).toBeNull();
	});

	it("shows Human presence independently of pending Computer checks", () => {
		const self = buildMember({ current: true });
		const teammate = {
			...buildMember({ current: false }),
			computer: {
				count: 0,
				label: "Checking computer…",
				path: null,
				state: "checking" as const,
			},
		};
		renderWorkspace({ members: [self, teammate] });
		expect(screen.queryByText("Loading people")).toBeNull();
		expect(
			within(screen.getByRole("region", { name: "Offline" })).getByRole(
				"button",
				{ name: "Open Grace Hopper's profile" }
			)
		).toBeTruthy();
		cleanup();
		renderWorkspace({
			members: [
				self,
				{
					...teammate,
					computer: {
						...teammate.computer,
						state: "unknown",
						label: "Computer status unavailable",
					},
				},
			],
		});
		expect(
			screen.getByRole("button", { name: "Open Felix's profile" })
		).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Offline" })).getByRole(
				"button",
				{ name: "Open Grace Hopper's profile" }
			)
		).toBeTruthy();
	});

	it("places an offline self in Offline", () => {
		testPresence.set("profile-current", "offline");
		testPresence.set("profile-grace", "online");
		const self = {
			...buildMember({ current: true }),
			computer: {
				count: 0,
				label: "No computer connected",
				path: null,
				state: "not_connected" as const,
			},
		};
		const teammate = {
			...buildMember({ current: false }),
			computer: {
				count: 1,
				label: "Computer connected",
				path: null,
				state: "connected" as const,
			},
		};
		renderWorkspace({ members: [teammate, self] });
		const sidebar = screen.getByRole("navigation", { name: "People" });
		const buttons = within(sidebar)
			.getAllByRole("button")
			.filter((button) =>
				button.getAttribute("aria-label")?.startsWith("Open ")
			);
		expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
			"Open Grace Hopper's profile",
			"Open Felix's profile",
		]);
		expect(
			within(sidebar)
				.getAllByRole("region")
				.map((group) => group.getAttribute("aria-label"))
		).toEqual(["Online", "Offline"]);
	});

	it("keeps profile metadata compact and separates Channel, Computer, and Local Agent signals", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-28T03:00:00.000Z"));
		renderWorkspace();

		const sidebar = screen.getByRole("navigation", { name: "People" });
		expect(within(sidebar).getByText("Felix")).toBeTruthy();
		expect(within(sidebar).queryByText("felix@example.com")).toBeNull();
		const felixItem = screen.getByRole("button", {
			name: "Open Felix's profile",
		});
		const heading = felixItem.querySelector(
			'[data-slot="human-profile-sidebar-heading"]'
		);
		expect(heading).not.toBeNull();
		expect(
			within(heading as HTMLElement).getByRole("img", {
				name: "Computer connected",
			})
		).toBeTruthy();
		expect(felixItem.textContent).not.toContain("Computer connected");
		expect(within(felixItem).queryByText("Owner")).toBeNull();
		const channelAccounts = felixItem.querySelector(
			'[data-slot="human-profile-channel-identities"]'
		);
		expect(channelAccounts).toBeNull();
		const localAgents = within(sidebar).getByRole("img", {
			name: ENABLED_LOCAL_AGENT_SUMMARY_PATTERN,
		});
		const activityAndAgents = felixItem.querySelector(
			'[data-slot="human-profile-activity-and-local-agents"]'
		);
		expect(activityAndAgents).not.toBeNull();
		expect(activityAndAgents?.contains(localAgents)).toBe(true);
		expect(
			within(activityAndAgents as HTMLElement).queryByText("yesterday")
		).toBeNull();
		expect(felixItem.textContent).not.toContain("Last active");
		expect(localAgents.classList.contains("justify-start")).toBe(true);
		const localAgentLogos = within(localAgents).getAllByTestId(
			LOCAL_AGENT_LOGO_TEST_ID_PATTERN
		);
		expect(localAgentLogos).toHaveLength(4);
		for (const logo of localAgentLogos) {
			expect(logo.dataset.variant).toBeUndefined();
		}
		const localAgentTriggers = within(localAgents).getAllByTestId(
			"human-profile-local-agent"
		);
		const tooltipLabels: string[] = [];
		for (const trigger of localAgentTriggers) {
			fireEvent.mouseEnter(trigger);
			fireEvent.mouseMove(trigger);
			await act(() => vi.advanceTimersByTimeAsync(500));
			tooltipLabels.push(screen.getByRole("tooltip").textContent ?? "");
			fireEvent.mouseLeave(trigger);
			await act(() => vi.advanceTimersByTimeAsync(200));
			expect(trigger.classList.contains("ring-1")).toBe(false);
			expect(trigger.classList.contains("border")).toBe(false);
			const logo = trigger.querySelector(
				'[data-slot="human-profile-local-agent-logo"]'
			);
			expect(logo?.classList.contains("bg-sidebar")).toBe(true);
			expect(logo?.classList.contains("before:bg-sidebar-accent")).toBe(true);
			expect(logo?.classList.contains("overflow-hidden")).toBe(true);
			expect(logo?.classList.contains("border")).toBe(false);
			expect(logo?.classList.contains("ring-1")).toBe(false);
			expect(
				logo?.classList.contains("group-hover/local-agent:-translate-y-1")
			).toBe(true);
			expect(
				logo?.classList.contains("group-hover/local-agent:scale-[1.14]")
			).toBe(true);
			expect(logo?.classList.contains("motion-reduce:transform-none")).toBe(
				true
			);
			expect(logo?.classList.contains("motion-reduce:transition-none")).toBe(
				true
			);
		}
		expect(tooltipLabels).toEqual(
			expect.arrayContaining(["Claude Code", "Codex", "Cursor", "Grok"])
		);
		const overflow = within(localAgents).getByText("+2").parentElement;
		if (!overflow) {
			throw new Error("Expected the Local Agent overflow indicator.");
		}
		expect(overflow.classList.contains("bg-sidebar")).toBe(true);
		expect(overflow.classList.contains("before:bg-sidebar-accent")).toBe(true);
		expect(overflow.classList.contains("overflow-hidden")).toBe(true);
		expect(overflow.classList.contains("ring-1")).toBe(false);
		expect(overflow.classList.contains("border")).toBe(false);
		expect(
			within(felixItem).getByRole("img", { name: "Computer connected" })
		).toBeTruthy();
		const graceItem = screen.getByRole("button", {
			name: "Open Grace Hopper's profile",
		});
		expect(
			graceItem.querySelector('[data-slot="human-profile-channel-identities"]')
		).toBeNull();
		expect(
			within(screen.getByRole("main")).getAllByText("felix@example.com")
		).toHaveLength(1);
		expect(screen.getByRole("main").dataset.showMainHeader).toBe("false");
	});

	it("keeps a single clipped row structure when the resizable sidebar becomes narrow", () => {
		renderWorkspace();

		const item = screen.getByRole("button", {
			name: "Open Felix's profile",
		});
		expect(item.classList.contains("flex-row")).toBe(true);
		expect(item.classList.contains("flex-col")).toBe(false);
		expect(item.classList.contains("overflow-hidden")).toBe(false);
		expect(item.classList.contains("focus-visible:ring-1")).toBe(false);
		const heading = item.querySelector(
			'[data-slot="human-profile-sidebar-heading"]'
		);
		expect(heading?.classList.contains("flex-nowrap")).toBe(true);
		expect(heading?.classList.contains("overflow-hidden")).toBe(true);
		expect(heading?.classList.contains("whitespace-nowrap")).toBe(true);
	});

	it("does not reserve an empty row when a member has no optional sidebar content", () => {
		const member = {
			...buildMember({ current: false }),
			lastActiveAt: null,
		};
		renderWorkspace({ members: [member] });

		const item = screen.getByRole("button", {
			name: "Open Grace Hopper's profile",
		});
		expect(
			item.querySelector('[data-slot="human-profile-channel-identities"]')
		).toBeNull();
		expect(
			item.querySelector(
				'[data-slot="human-profile-activity-and-local-agents"]'
			)
		).toBeNull();
		expect(item.classList.contains("min-h-20")).toBe(false);
	});

	it("selects a Human Profile from the sidebar without opening a Drawer", () => {
		const onSelectProfile = vi.fn();
		renderWorkspace({ onSelectProfile });

		fireEvent.click(
			screen.getByRole("button", { name: "Open Grace Hopper's profile" })
		);
		expect(onSelectProfile).toHaveBeenCalledWith("profile-grace");
		expect(screen.queryByTestId("human-profile-details-drawer")).toBeNull();
	});

	it("keeps the selected Human Profile on a zero-Computer Add flow", () => {
		renderWorkspace({
			computerGroups: [{ ...buildCurrentComputerGroup(), computers: [] }],
		});

		const picker = screen.getByTestId("profile-computers-picker");
		expect(picker.getAttribute("data-profile-id")).toBe("profile-current");
		expect(
			within(picker).getByRole("button", { name: "Add a Computer" })
		).toBeTruthy();
	});

	it("keeps Learn About and Profile Report actions in Profile Detail", () => {
		const onResearch = vi.fn();
		renderWorkspace({ onResearch });

		fireEvent.click(screen.getByRole("button", { name: "Learn about Felix" }));
		expect(onResearch).toHaveBeenCalledWith("user-current");
		expect(screen.getByRole("link", { name: "Open report" })).toBeTruthy();
	});

	it("keeps a Documents failure visible and retryable in Profile Report", () => {
		const onRetryProfileReports = vi.fn();
		renderWorkspace({
			onRetryProfileReports,
			profileReportsErrorMessage:
				"Report links are unavailable because Documents could not be loaded.",
		});

		expect(screen.getByRole("alert").textContent).toContain(
			"Report links are unavailable because Documents could not be loaded."
		);
		expect(screen.queryByText("Profile Report status unavailable")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetryProfileReports).toHaveBeenCalledOnce();
	});

	it("groups low-emphasis profile actions at the trailing edge of the hero", () => {
		renderWorkspace();

		const hero = screen.getByTestId("human-profile-hero");
		const actions = within(hero).getByTestId("human-profile-header-actions");
		expect(
			within(actions)
				.getAllByRole("button")
				.map((button) => button.textContent)
		).toEqual(["Learn about Felix", "Edit profile"]);
		for (const action of within(actions).getAllByRole("button")) {
			expect(action.classList.contains("border-border")).toBe(true);
			expect(action.classList.contains("bg-background")).toBe(true);
			expect(action.classList.contains("bg-primary")).toBe(false);
		}
		expect(screen.queryByTestId("human-profile-primary-actions")).toBeNull();
	});

	it("keeps joined date beside email without a duplicate member account section", () => {
		renderWorkspace();

		const metadata = screen.getByTestId("human-profile-metadata");
		expect(metadata.textContent).toBe("felix@example.comJoined Aug 1, 2026");
		const separator = metadata.querySelector(
			'[data-slot="human-profile-metadata-separator"]'
		);
		expect(separator).toBeTruthy();
		expect(separator?.parentElement?.textContent).toBe("Joined Aug 1, 2026");
		expect(
			separator?.parentElement?.classList.contains("whitespace-nowrap")
		).toBe(true);
		expect(screen.queryByText("Member account")).toBeNull();
		expect(screen.queryByText("Organization role")).toBeNull();
	});

	it("shows a single-row scrollable Agent picker with links to every Agent", () => {
		renderWorkspace({
			members: [
				buildMember({
					agentProfiles: [
						{
							agentControllerRef: "builtin:codex",
							avatarImageUrl: null,
							id: "agent-sol",
							modelSelection: { modelId: "gpt-5.6-sol" },
							modelSelectionIsKnown: true,
							name: "Felix Sol",
							path: "/o/acme/agents?profileId=agent-sol",
						},
						{
							agentControllerRef: "builtin:codex",
							avatarImageUrl: null,
							id: "agent-default",
							modelSelection: null,
							modelSelectionIsKnown: true,
							name: "Felix Default",
							path: "/o/acme/agents?profileId=agent-default",
						},
					],
					current: true,
				}),
			],
		});

		expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Manage Agents" })).toBeTruthy();
		const agentStrip = screen.getByLabelText("Felix's Agents");
		expect(
			agentStrip
				.closest('[data-slot="scroll-area-viewport"]')
				?.getAttribute("data-orientation")
		).toBe("horizontal");
		expect(agentStrip.className).toContain("flex");
		expect(
			within(agentStrip)
				.getByText("Felix Sol")
				.closest("a")
				?.getAttribute("href")
		).toBe("/o/acme/agents?profileId=agent-sol");
		expect(
			within(agentStrip)
				.getByText("Felix Default")
				.closest("a")
				?.getAttribute("href")
		).toBe("/o/acme/agents?profileId=agent-default");
		expect(
			within(agentStrip).getByText("Codex · GPT-5.6 Sol · model default")
		).toBeTruthy();
		// With no saved model the harness picks one: only the controller shows.
		expect(within(agentStrip).getByText("Codex")).toBeTruthy();
	});

	it("makes Chat with the primary action for another member", () => {
		renderWorkspace({ selectedProfileId: "profile-grace" });

		const actions = within(
			screen.getByTestId("human-profile-hero")
		).getByTestId("human-profile-header-actions");
		const [chatButton, researchButton] = within(actions).getAllByRole("button");
		expect(chatButton?.textContent).toBe("Chat with Grace Hopper");
		expect(chatButton?.classList.contains("bg-primary")).toBe(true);
		expect(chatButton?.classList.contains("h-7")).toBe(true);
		expect(researchButton?.textContent).toBe("Learn about Grace Hopper");
		expect(researchButton?.classList.contains("bg-background")).toBe(true);
	});

	it("keeps a member-scoped research failure beside its retry action", () => {
		renderWorkspace({
			memberResearchError: {
				message: "Center Agent is unavailable for this member.",
				subjectUserId: "user-current",
			},
		});

		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"Center Agent is unavailable for this member."
		);
	});

	it("does not turn an unresolved Computer projection into an empty state", () => {
		renderWorkspace({
			directoryError: "Computer inventory could not be loaded.",
			selectedProfileId: "profile-grace",
		});

		expect(screen.getByRole("alert").textContent).toBe(
			"Computer inventory could not be loaded."
		);
		expect(screen.queryByText("No computers connected.")).toBeNull();
	});

	it("shows pending Computer projection state before confirmed emptiness", () => {
		renderWorkspace({
			directoryIsPending: true,
			selectedProfileId: "profile-grace",
		});

		expect(
			screen.getByRole("status", { name: "Loading computers" })
		).toBeTruthy();
		expect(screen.queryByText("No computers connected.")).toBeNull();
	});

	it.each([
		{ directoryIsPending: true },
		{ directoryError: "Team inventory unavailable" },
	])("does not block the owner's verified Computers on team inventory: %j", (query) => {
		renderWorkspace(query);
		expect(screen.getByTestId("profile-computers-picker")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add a Computer" })).toBeTruthy();
		expect(
			screen.queryByRole("status", { name: "Loading computers" })
		).toBeNull();
		expect(screen.queryByText("Team inventory unavailable")).toBeNull();
	});

	it("uses the current Computer projection in details while keeping the display cache", () => {
		renderWorkspace({
			strictComputerGroups: [{ ...buildCurrentComputerGroup(), computers: [] }],
		});
		expect(screen.getByTestId("profile-computers-picker")).toBeTruthy();
		expect(screen.queryByText("Felix's MacBook Pro")).toBeNull();
	});

	it("shows an owner inventory failure with a retry instead of a false empty or Add flow", () => {
		const onRetryComputers = vi.fn();
		renderWorkspace({ inventoryError: true, onRetryComputers });
		expect(screen.getByRole("alert").textContent).toBe(
			"Your computers could not be loaded."
		);
		expect(screen.queryByTestId("profile-computers-picker")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetryComputers).toHaveBeenCalledOnce();
	});

	it("explains a missing personal Human Profile identity in detail", () => {
		renderWorkspace({
			currentNotice:
				"Create a Human Profile to manage how you appear in this workspace.",
		});

		expect(
			screen.getByText(
				"Create a Human Profile to manage how you appear in this workspace."
			).textContent
		).toBe(
			"Create a Human Profile to manage how you appear in this workspace."
		);
	});
});

function renderWorkspace(
	input: {
		inventoryError?: boolean;
		onRetryComputers?: () => void;
		computerGroups?: readonly OrganizationComputerGroup[];
		strictComputerGroups?: readonly OrganizationComputerGroup[];
		currentNotice?: string;
		directoryError?: string | null;
		directoryIsPending?: boolean;
		members?: readonly DirectoryHumanProfileRow[];
		memberResearchError?: { message: string; subjectUserId: string } | null;
		onResearch?: (userId: string) => void;
		onRetryProfileReports?: () => void;
		onSelectProfile?: (profileId: string) => void;
		profileReportsErrorMessage?: string | null;
		selectedProfileId?: string | null;
	} = {}
) {
	const members = input.members ?? [
		buildMember({ current: true, notice: input.currentNotice }),
		buildMember({ current: false }),
	];
	return render(
		<DirectoryHumanProfilesWorkspace
			activeBatch={null}
			canCreateProfile={false}
			computerGroups={input.computerGroups ?? [buildCurrentComputerGroup()]}
			directoryError={input.directoryError ?? null}
			directoryIsPending={input.directoryIsPending ?? false}
			emptyMessage="No Human Profiles"
			errorMessage={null}
			latestBatch={null}
			memberResearchError={input.memberResearchError ?? null}
			members={members}
			modelCatalog={TEST_MODEL_CATALOG}
			onCreateProfile={vi.fn()}
			onDisconnectConnectedAccount={vi.fn()}
			onOpenDirectMessage={vi.fn().mockResolvedValue(undefined)}
			onRequestChannelSetup={vi.fn().mockResolvedValue(undefined)}
			onResearch={input.onResearch ?? vi.fn()}
			onResearchAll={vi.fn()}
			onRetryProfileReports={input.onRetryProfileReports ?? vi.fn()}
			onSelectProfile={input.onSelectProfile ?? vi.fn()}
			orgSlug="acme"
			pendingResearch={undefined}
			profileReportsAreRetrying={false}
			profileReportsErrorMessage={input.profileReportsErrorMessage ?? null}
			recovery={buildRecovery(input)}
			researchErrorMessage={null}
			selectedProfileId={
				input.selectedProfileId === undefined
					? "profile-current"
					: input.selectedProfileId
			}
			state={{
				context: "organization",
				directMessage: "idle",
				profiles: "ready",
				research: "idle",
			}}
			strictComputerGroups={input.strictComputerGroups}
		/>
	);
}

function buildMember(input: {
	agentProfiles?: DirectoryHumanProfileRow["agentProfiles"];
	current: boolean;
	notice?: string;
}): DirectoryHumanProfileRow {
	const name = input.current ? "Felix" : "Grace Hopper";
	const profileId = input.current ? "profile-current" : "profile-grace";
	const userId = input.current ? "user-current" : "user-grace";
	return {
		agentProfiles: input.agentProfiles ?? [],
		presence: input.current ? "online" : "offline",
		agentProfilesPath: "/o/acme/agents",
		avatarImageUrl: null,
		canEdit: input.current,
		computer: {
			count: input.current ? 1 : 0,
			label: input.current ? "Computer connected" : "No computer connected",
			path: null,
			state: input.current ? "connected" : "not_connected",
		},
		details: null,
		email: `${input.current ? "felix" : "grace"}@example.com`,
		id: profileId,
		identityAccounts: input.current
			? [
					{
						accountEmail: "felix@slack.example",
						accountName: "Felix",
						action: null,
						canDisconnect: true,
						channelsPath: null,
						id: "slack-link",
						provider: "slack",
						providerLabel: "Slack",
						state: "connected",
					},
					{
						accountEmail: null,
						accountName: null,
						action: null,
						canDisconnect: false,
						channelsPath: null,
						id: "lark-link",
						provider: "lark",
						providerLabel: "Lark",
						state: "connected",
					},
				]
			: [],
		isCurrentUser: input.current,
		isDefault: input.current,
		joinedAt: "2026-08-01T00:00:00.000Z",
		lastActiveAt: "2026-08-27T00:00:00.000Z",
		name,
		notice: input.notice ?? null,
		profileReport: input.current
			? {
					hasDraft: false,
					path: "/o/acme/documents/report-felix",
					state: "available",
				}
			: { state: "missing" },
		profileStatus: "active",
		role: input.current ? "owner" : "admin",
		userId,
	};
}

function buildCurrentComputerGroup(): OrganizationComputerGroup {
	const computer = {
		deviceDisplayName: "Felix's MacBook Pro",
		deviceId: "device-current",
		deviceType: "laptop",
		executionTargets: [
			{
				capabilities: [],
				deviceId: "device-current",
				isCurrent: true,
				lastObservedAtMs: Date.now(),
				localAgentCatalog: {
					entries: [
						buildLocalAgentEntry({ agentId: "codex", enabled: true }),
						buildLocalAgentEntry({
							agentId: "claude-code",
							enabled: true,
						}),
						buildLocalAgentEntry({ agentId: "cursor", enabled: true }),
						buildLocalAgentEntry({ agentId: "grok-build", enabled: true }),
						buildLocalAgentEntry({ agentId: "opencode", enabled: true }),
						buildLocalAgentEntry({ agentId: "openclaw", enabled: true }),
					],
					summary: {
						detectedNotSupportedYet: 0,
						detectedSupported: 6,
						needsChoice: 0,
						needsRepair: 0,
						notDetected: 0,
						totalBuiltins: 6,
					},
				},
				status: "ready",
			},
		],
		firstSeenAtMs: Date.now(),
		isCurrent: true,
		lastObservedAtMs: Date.now(),
		osVersion: "26.0",
		platformFamily: "macOS",
	} as unknown as LocalRuntimeComputer;
	return {
		computers: [
			{
				agents: [],
				deviceDisplayName: computer.deviceDisplayName,
				deviceId: computer.deviceId,
				deviceType: computer.deviceType,
				isOwnedByCurrentUser: true,
				lastSeenAtMs: computer.lastObservedAtMs,
				localAgents: [],
				openMeldTools: null,
				osVersion: computer.osVersion,
				ownedComputer: computer,
				ownerLabel: "Felix",
				ownerUserId: "user-current",
				platformFamily: computer.platformFamily,
				routeId: computer.deviceId,
				serviceState: null,
			},
		],
		isCurrentUser: true,
		ownerLabel: "Felix",
		ownerUserId: "user-current",
	};
}

function buildLocalAgentEntry(input: { agentId: string; enabled: boolean }) {
	return {
		agentId: input.agentId,
		detected: true,
		displayName: formatTestLocalAgentName(input.agentId),
		enabled: input.enabled,
		launchStatus: "ready" as const,
		lifecycleStatus: "active" as const,
		selectable: true,
		selectableReason: null,
		targetKind: "builtin" as const,
	};
}

function formatTestLocalAgentName(agentId: string): string {
	switch (agentId) {
		case "claude-code":
			return "Claude Code";
		case "grok-build":
			return "Grok";
		case "openclaw":
			return "OpenClaw";
		case "opencode":
			return "OpenCode";
		default:
			return agentId.charAt(0).toUpperCase() + agentId.slice(1);
	}
}

function buildRecovery(
	input: { inventoryError?: boolean; onRetryComputers?: () => void } = {}
): Parameters<typeof DirectoryHumanProfilesWorkspace>[0]["recovery"] {
	return {
		currentLocalRuntimeReplyReadinessQuery: {
			isFetchedAfterMount: true,
			isFetching: false,
		},
		localRuntimesQuery: {
			isPending: false,
			isError: input.inventoryError ?? false,
			refetch: input.onRetryComputers,
		},
	} as unknown as Parameters<
		typeof DirectoryHumanProfilesWorkspace
	>[0]["recovery"];
}
