import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import {
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

const STALE_CODEX_QUOTA = /Codex Weekly usage, 65% left, Stale/;
const REMOVED_PROFILE_COPY =
	/Learn about|Profile Report|Connected Channels|No Agents yet|Joined|MacBook/;
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
	useNavigate: () => vi.fn(),
	useRouter: () => ({ preloadRoute: vi.fn().mockResolvedValue(undefined) }),
	useLocation: ({
		select,
	}: {
		select: (location: { searchStr: string }) => unknown;
	}) => select({ searchStr: "" }),
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
		mainHeader,
	}: {
		mainHeader?: ReactNode;
		children: ReactNode;
		showMainHeader?: boolean;
		mainSidebar?: { content: ReactNode };
	}) => (
		<div>
			{mainSidebar?.content}
			<main data-show-main-header={showMainHeader ? "true" : "false"}>
				{showMainHeader ? mainHeader : null}
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

const openColleagueAgent = vi.hoisted(() => vi.fn());
vi.mock("#/components/member-agents/colleague-agent-page-sidebar", () => ({
	ColleagueAgentChatButton: (props: {
		ownerUserId: string;
		profileId: string;
		profileName: string;
	}) => (
		<button
			onClick={() => openColleagueAgent(props.ownerUserId, props.profileId)}
			type="button"
		>
			Chat with {props.profileName}
		</button>
	),
}));

vi.mock("./center-agent-item", () => ({
	CenterAgentItem: () => <span>Workspace assistant</span>,
}));

describe("DirectoryHumanProfilesWorkspace", () => {
	it("links back to the current Team from selected and missing members", () => {
		for (const selectedProfileId of ["profile-grace", "missing-member"]) {
			const result = renderWorkspace({ selectedProfileId });
			expect(
				screen.getByRole("link", { name: "Back to Team" }).getAttribute("href")
			).toBe("/o/acme/people");
			result.unmount();
		}
	});

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

	it("keeps each People row focused on opening the member profile", () => {
		const onSelectProfile = vi.fn();
		renderWorkspace({ onSelectProfile });

		const sidebar = screen.getByRole("navigation", { name: "People" });
		const member = within(sidebar).getByRole("button", {
			name: "Open Felix's profile",
		});
		const row = member.parentElement;
		if (!row) {
			throw new Error("Expected a member list item.");
		}
		fireEvent.mouseEnter(row);
		expect(within(row).getAllByRole("button")).toEqual([member]);
		expect(within(row).getByText("Felix")).toBeTruthy();
		expect(within(row).queryByText("felix@example.com")).toBeNull();
		expect(
			within(row).getByRole("img", { name: "Computer connected" })
		).toBeTruthy();
		expect(within(row).queryByTestId("human-profile-local-agent")).toBeNull();
		fireEvent.click(member);
		expect(onSelectProfile).toHaveBeenCalledWith("profile-current");
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

	it("puts connected local agents, actual quota, and chat on a teammate's profile", () => {
		const group = buildTeammateComputerGroup();
		renderWorkspace({
			selectedProfileId: "profile-grace",
			computerGroups: [group],
			members: [
				buildMember({
					current: false,
					agentProfiles: [
						{
							agentControllerRef: "builtin:codex",
							avatarImageUrl: null,
							id: "grace-codex",
							modelSelection: null,
							modelSelectionIsKnown: false,
							name: "Grace's Codex",
							path: "/o/acme/agents?profileId=grace-codex",
						},
					],
				}),
			],
		});
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(detail.getByText("Connected")).toBeTruthy();
		expect(detail.getByText("65% left")).toBeTruthy();
		expect(detail.getByText("grace@example.com")).toBeTruthy();
		fireEvent.click(
			detail.getByRole("button", { name: "Chat with Grace's Codex" })
		);
		expect(openColleagueAgent).toHaveBeenCalledWith(
			"user-grace",
			"grace-codex"
		);
		expect(detail.queryByText(REMOVED_PROFILE_COPY)).toBeNull();
	});

	it("shows a detected harness with quota but does not grant chat to an unshared agent", () => {
		const onOpenDirectMessage = vi.fn().mockResolvedValue(undefined);
		renderWorkspace({
			selectedProfileId: "profile-grace",
			computerGroups: [buildTeammateComputerGroup()],
			onOpenDirectMessage,
		});
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(detail.getByText("65% left")).toBeTruthy();
		expect(
			detail.queryByRole("button", { name: "Chat with Codex" })
		).toBeNull();
		fireEvent.click(
			detail.getByRole("button", {
				name: "Message Grace Hopper about sharing Codex",
			})
		);
		expect(onOpenDirectMessage).toHaveBeenCalledWith("profile-grace");
	});

	it("labels offline quota as stale rather than treating it as live capacity", () => {
		const group = buildTeammateComputerGroup();
		for (const computer of group.computers) {
			computer.serviceState = "not_connected";
		}
		renderWorkspace({
			selectedProfileId: "profile-grace",
			computerGroups: [group],
		});
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(detail.getByText("Offline")).toBeTruthy();
		expect(detail.getByText("65% left")).toBeTruthy();
		expect(detail.getByRole("meter", { name: STALE_CODEX_QUOTA })).toBeTruthy();
	});

	it("does not disclose a last-known quota after the current Computer projection fails", () => {
		renderWorkspace({
			selectedProfileId: "profile-grace",
			computerGroups: [buildTeammateComputerGroup()],
			strictComputerGroups: [],
			directoryError: "Failed",
		});
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(detail.getByRole("alert").textContent).toBe(
			"Connection unavailable"
		);
		expect(detail.queryByText("65% left")).toBeNull();
	});

	it("does not show empty catalog, management information, or research prompts for a teammate", () => {
		renderWorkspace({ selectedProfileId: "profile-grace" });
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(
			detail.getByRole("button", { name: "Chat with Grace Hopper" })
		).toBeTruthy();
		expect(detail.queryByRole("heading", { name: "Local Agents" })).toBeNull();
		expect(detail.queryByText(REMOVED_PROFILE_COPY)).toBeNull();
	});

	it("keeps the owner's Agent management reachable without exposing a device settings panel", () => {
		renderWorkspace();
		const detail = within(screen.getByTestId("human-profile-details"));
		expect(detail.getByRole("link", { name: "Manage" })).toBeTruthy();
		expect(detail.getByRole("button", { name: "Edit profile" })).toBeTruthy();
		expect(detail.queryByText("Felix's MacBook Pro")).toBeNull();
	});

	it("shows a pending connection instead of a false empty catalog", () => {
		renderWorkspace({
			selectedProfileId: "profile-grace",
			directoryIsPending: true,
		});
		expect(
			within(screen.getByTestId("human-profile-details")).getByRole("status")
				.textContent
		).toBe("Checking connection…");
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
		onOpenDirectMessage?: (id: string) => Promise<void>;
		computerGroups?: readonly OrganizationComputerGroup[];
		strictComputerGroups?: readonly OrganizationComputerGroup[];
		currentNotice?: string;
		directoryError?: string | null;
		directoryIsPending?: boolean;
		members?: readonly DirectoryHumanProfileRow[];
		onSelectProfile?: (profileId: string) => void;
		selectedProfileId?: string | null;
	} = {}
) {
	const members = input.members ?? [
		buildMember({ current: true, notice: input.currentNotice }),
		buildMember({ current: false }),
	];
	return render(
		<DirectoryHumanProfilesWorkspace
			canCreateProfile={false}
			computerGroups={input.computerGroups ?? [buildCurrentComputerGroup()]}
			directoryError={input.directoryError ?? null}
			directoryIsPending={input.directoryIsPending ?? false}
			emptyMessage="No Human Profiles"
			errorMessage={null}
			members={members}
			onCreateProfile={vi.fn()}
			onOpenDirectMessage={
				input.onOpenDirectMessage ?? vi.fn().mockResolvedValue(undefined)
			}
			onSelectProfile={input.onSelectProfile ?? vi.fn()}
			orgSlug="acme"
			recovery={buildRecovery(input)}
			selectedProfileId={
				input.selectedProfileId === undefined
					? "profile-current"
					: input.selectedProfileId
			}
			state={{
				context: "organization",
				directMessage: "idle",
				profiles: "ready",
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

function buildTeammateComputerGroup(): OrganizationComputerGroup {
	const group = buildCurrentComputerGroup();
	const computer = group.computers[0];
	if (!computer) {
		throw new Error("Fixture is missing a computer");
	}
	return {
		...group,
		isCurrentUser: false,
		ownerUserId: "user-grace",
		ownerLabel: "Grace Hopper",
		computers: [
			{
				...computer,
				isOwnedByCurrentUser: false,
				ownerUserId: "user-grace",
				ownerLabel: "Grace Hopper",
				ownedComputer: null,
				serviceState: "connected",
				localAgents: [
					{
						agentControllerRef: "builtin:codex",
						enabled: true,
						status: "ready",
						details: {
							status: "ready",
							capabilities: {
								approvals: true,
								cancel: true,
								interrupt: true,
								modelSelection: true,
								nativeEventStream: true,
								permissionModes: true,
								structuredUserInput: false,
							},
							checkedAt: "2026-11-24T20:00:00.000Z",
							launch: { installChoiceCount: 1, status: "ready" },
							models: [],
							nativeInterface: "codex-app-server",
							version: null,
							usageLimits: [
								{
									key: "codex:weekly",
									label: "Weekly usage",
									status: "available",
									usedPercent: 35,
									resetsAt: null,
									observedAt: "2026-11-24T20:00:00.000Z",
								},
							],
						},
					},
				],
			},
		],
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
