import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { DirectoryHumanProfilesWorkspace } from "./directory-human-profiles-workspace";

const ENABLED_LOCAL_AGENT_SUMMARY_PATTERN =
	/Claude Code enabled, Codex enabled, Cursor enabled/;
const LOCAL_AGENT_LOGO_TEST_ID_PATTERN = /^local-agent-logo-/;

afterEach(cleanup);

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

vi.mock("@openmeld/ui/components/local-agent-logo", () => ({
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

vi.mock("@openmeld/ui/components/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipContent: ({
		children,
		side,
	}: {
		children: ReactNode;
		side?: string;
	}) => (
		<span
			data-side={side}
			data-testid="sidebar-tooltip-content"
			data-tooltip-label={String(children)}
		/>
	),
	TooltipTrigger: ({
		children,
		render,
	}: {
		children: ReactNode;
		render: ReactElement;
	}) => cloneElement(render, undefined, children),
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualSidebarNav: (props: {
		ariaLabel: string;
		groups: readonly { content: ReactNode; label: string }[];
		leadingContent?: ReactNode;
		title: string;
	}) => (
		<nav aria-label={props.ariaLabel}>
			<h2>{props.title}</h2>
			{props.leadingContent}
			{props.groups.map((group) => (
				<section aria-label={group.label} key={group.label}>
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
		sidebar,
	}: {
		children: ReactNode;
		showMainHeader?: boolean;
		sidebar?: ReactNode;
	}) => (
		<div>
			{sidebar}
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
	}) => (
		<div data-testid="profile-computers-picker">
			{props.computerGroups[0]?.computers.map((computer) => (
				<span key={computer.routeId}>{computer.deviceDisplayName}</span>
			))}
			{props.computerGroups[0]?.isCurrentUser ? (
				<button type="button">Add a Computer</button>
			) : null}
		</div>
	),
}));

describe("DirectoryHumanProfilesWorkspace", () => {
	it("keeps profile metadata compact and separates Channel, Computer, and Local Agent signals", () => {
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
		expect(channelAccounts).not.toBeNull();
		expect(
			within(channelAccounts as HTMLElement).getByText(
				"Felix · felix@slack.example"
			)
		).toBeTruthy();
		expect(
			within(channelAccounts as HTMLElement).getByRole("img", { name: "Slack" })
		).toBeTruthy();
		const slackLogo = within(channelAccounts as HTMLElement).getByTestId(
			"app-logo-slack"
		);
		expect([...(slackLogo.parentElement?.classList ?? [])]).toEqual(
			expect.arrayContaining([
				"size-3.5",
				"border-0",
				"bg-transparent",
				"p-0",
				"shadow-none",
			])
		);
		expect(within(sidebar).getByRole("img", { name: "Lark" })).toBeTruthy();
		expect(
			within(sidebar).queryByText("Account details unavailable")
		).toBeNull();
		const localAgents = within(sidebar).getByRole("img", {
			name: ENABLED_LOCAL_AGENT_SUMMARY_PATTERN,
		});
		expect(localAgents.classList.contains("justify-end")).toBe(true);
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
		for (const trigger of localAgentTriggers) {
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
		const overflow = within(localAgents).getByText("+2").parentElement;
		if (!overflow) {
			throw new Error("Expected the Local Agent overflow indicator.");
		}
		expect(overflow.classList.contains("bg-sidebar")).toBe(true);
		expect(overflow.classList.contains("before:bg-sidebar-accent")).toBe(true);
		expect(overflow.classList.contains("overflow-hidden")).toBe(true);
		expect(overflow.classList.contains("ring-1")).toBe(false);
		expect(overflow.classList.contains("border")).toBe(false);
		const tooltipLabels = within(felixItem)
			.getAllByTestId("sidebar-tooltip-content")
			.map((tooltip) => tooltip.dataset.tooltipLabel);
		expect(tooltipLabels).toEqual(
			expect.arrayContaining([
				"Computer connected",
				"Claude Code",
				"Codex",
				"Cursor",
				"Grok",
			])
		);
		expect(
			within(screen.getByRole("main")).getAllByText("felix@example.com")
		).toHaveLength(2);
		expect(screen.getByRole("main").dataset.showMainHeader).toBe("true");
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

	it("selects a Human Profile from the sidebar without opening a Drawer", () => {
		const onSelectProfile = vi.fn();
		renderWorkspace({ onSelectProfile });

		fireEvent.click(
			screen.getByRole("button", { name: "Open Grace Hopper's profile" })
		);
		expect(onSelectProfile).toHaveBeenCalledWith("profile-grace");
		expect(screen.queryByTestId("human-profile-details-drawer")).toBeNull();
	});

	it("reuses the selected person's Computer cards and preserves Add a Computer for the current user", () => {
		renderWorkspace();

		const picker = screen.getByTestId("profile-computers-picker");
		expect(within(picker).getByText("Felix's MacBook Pro")).toBeTruthy();
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

	it("keeps Direct Message before Learn About in another member's hero", () => {
		renderWorkspace({ selectedProfileId: "profile-grace" });

		const actions = within(
			screen.getByTestId("human-profile-hero")
		).getByTestId("human-profile-header-actions");
		expect(
			within(actions)
				.getAllByRole("button")
				.map((button) => button.textContent)
		).toEqual(["Direct Message", "Learn about Grace Hopper"]);
	});
});

function renderWorkspace(
	input: {
		onResearch?: (userId: string) => void;
		onSelectProfile?: (profileId: string) => void;
		selectedProfileId?: string;
	} = {}
) {
	const members = [
		buildMember({ current: true }),
		buildMember({ current: false }),
	];
	return render(
		<DirectoryHumanProfilesWorkspace
			activeBatch={null}
			canCreateProfile={false}
			computerGroups={[buildCurrentComputerGroup()]}
			directoryError={null}
			directoryIsPending={false}
			emptyMessage="No Human Profiles"
			errorMessage={null}
			latestBatch={null}
			memberResearchError={null}
			members={members}
			onCreateProfile={vi.fn()}
			onDisconnectConnectedAccount={vi.fn()}
			onOpenDirectMessage={vi.fn().mockResolvedValue(undefined)}
			onRequestChannelSetup={vi.fn().mockResolvedValue(undefined)}
			onResearch={input.onResearch ?? vi.fn()}
			onResearchAll={vi.fn()}
			onSelectProfile={input.onSelectProfile ?? vi.fn()}
			orgSlug="acme"
			pendingResearch={undefined}
			recovery={buildRecovery()}
			researchErrorMessage={null}
			selectedProfileId={input.selectedProfileId ?? "profile-current"}
			sidebarLeadingContent={<button type="button">Invite Members</button>}
			state={{
				context: "organization",
				directMessage: "idle",
				profiles: "ready",
				research: "idle",
			}}
		/>
	);
}

function buildMember(input: { current: boolean }): DirectoryHumanProfileRow {
	const name = input.current ? "Felix" : "Grace Hopper";
	const profileId = input.current ? "profile-current" : "profile-grace";
	const userId = input.current ? "user-current" : "user-grace";
	return {
		agentProfiles: [],
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
		notice: null,
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

function buildRecovery(): Parameters<
	typeof DirectoryHumanProfilesWorkspace
>[0]["recovery"] {
	return {
		currentLocalRuntimeReplyReadinessQuery: {
			isFetchedAfterMount: true,
			isFetching: false,
		},
		localRuntimesQuery: { isPending: false },
	} as unknown as Parameters<
		typeof DirectoryHumanProfilesWorkspace
	>[0]["recovery"];
}
