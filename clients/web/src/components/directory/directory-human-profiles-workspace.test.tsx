import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
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
	LocalAgentLogo: ({ agentId }: { agentId: string }) => (
		<span data-testid={`local-agent-logo-${agentId}`} />
	),
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
		sidebar,
	}: {
		children: ReactNode;
		sidebar?: ReactNode;
	}) => (
		<div>
			{sidebar}
			<main>{children}</main>
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
	it("separates mapped Channel identity from a capped stack of enabled Local Agent icons", () => {
		renderWorkspace();

		const sidebar = screen.getByRole("navigation", { name: "People" });
		expect(within(sidebar).getByText("Felix")).toBeTruthy();
		expect(within(sidebar).queryByText("felix@example.com")).toBeNull();
		const felixItem = screen.getByRole("button", {
			name: "Open Felix's profile",
		});
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
		expect(within(sidebar).queryByRole("img", { name: "Lark" })).toBeNull();
		const localAgents = within(sidebar).getByRole("img", {
			name: ENABLED_LOCAL_AGENT_SUMMARY_PATTERN,
		});
		expect(
			within(localAgents).getAllByTestId(LOCAL_AGENT_LOGO_TEST_ID_PATTERN)
		).toHaveLength(4);
		expect(within(localAgents).getByText("+2")).toBeTruthy();
		expect(
			within(screen.getByRole("main")).getAllByText("felix@example.com")
		).toHaveLength(2);
	});

	it("reflows each profile item when the resizable sidebar becomes narrow", () => {
		renderWorkspace();

		const item = screen.getByRole("button", {
			name: "Open Felix's profile",
		});
		expect(item.classList.contains("flex-col")).toBe(true);
		expect(
			item.classList.contains("@[12rem]/contextual-sidebar:flex-row")
		).toBe(true);
		const heading = item.querySelector(
			'[data-slot="human-profile-sidebar-heading"]'
		);
		expect(heading?.classList.contains("flex-wrap")).toBe(true);
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
});

function renderWorkspace(
	input: {
		onResearch?: (userId: string) => void;
		onSelectProfile?: (profileId: string) => void;
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
			selectedProfileId="profile-current"
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
						id: null,
						provider: "lark",
						providerLabel: "Lark",
						state: "not_connected",
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
