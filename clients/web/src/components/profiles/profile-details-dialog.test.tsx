import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import type {
	OrganizationComputersResponse,
	OrganizationProfileDirectoryResponse,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AgentProfileDetailsContent,
	HumanProfileDetailsPopover,
} from "#/components/profiles/profile-details-dialog";
import { SpaceAgentRecoveryProvider } from "#/components/spaces/space-agent-recovery-context";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

describe("HumanProfileDetailsPopover", () => {
	afterEach(cleanup);

	it("shows Space recency, computer status, and five recent Agents without growing vertically", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-acme"),
			buildProfileDirectory()
		);
		queryClient.setQueryData(
			organizationQueryKeys.computers("org-acme"),
			buildComputers()
		);

		render(
			<QueryClientProvider client={queryClient}>
				<HumanProfileDetailsPopover
					currentOwnerUserId="user-felix"
					entry={buildHumanEntry()}
					modelCatalog={null}
					onOpenDirectMessage={vi.fn()}
					organizationId="org-acme"
					orgSlug="acme"
					profileHref="/o/acme/people?profileId=human-monica"
					trigger={<button type="button">Open Monica</button>}
				/>
			</QueryClientProvider>
		);

		fireEvent.click(screen.getByRole("button", { name: "Open Monica" }));
		const dialogElement = screen.getByRole("dialog");
		const dialog = within(dialogElement);
		expect(dialogElement.className).toContain(
			"w-[min(22rem,calc(100vw-1.5rem))]"
		);
		expect(
			dialog.getByTestId("space-profile-icon-human-monica").className
		).toContain("size-12");
		expect(
			dialog.getByRole("button", { name: "Chat with Monica Cheng" }).className
		).toContain("h-8");
		expect(dialog.getByText("Here 7h ago")).toBeTruthy();
		expect(dialog.getByText("Computer connected")).toBeTruthy();
		expect(dialog.getByText("5 of 6")).toBeTruthy();
		const list = dialog.getByRole("list", { name: "Monica Cheng's Agents" });
		expect(
			list
				.closest('[data-slot="scroll-area-viewport"]')
				?.getAttribute("data-orientation")
		).toBe("horizontal");
		expect(
			dialog.getByRole("link", { name: "Open Monica Agent 6" })
		).toBeTruthy();
		expect(
			dialog.getByRole("link", { name: "Open Monica Agent 2" })
		).toBeTruthy();
		expect(
			dialog.queryByRole("link", { name: "Open Monica Agent 1" })
		).toBeNull();
		expect(dialog.getByText("View all")).toBeTruthy();
		expect(
			queryClient.getQueryState(
				organizationQueryKeys.agentRuntimeOverview("org-acme")
			)
		).toBeUndefined();
		fireEvent.click(
			dialog.getByRole("link", { name: "View Monica Cheng profile" })
		);
		return waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("omits the entire Agents footer when the person has no Agents", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-acme"),
			{ ...buildProfileDirectory(), agentProfiles: [] }
		);
		queryClient.setQueryData(
			organizationQueryKeys.computers("org-acme"),
			buildComputers()
		);

		render(
			<QueryClientProvider client={queryClient}>
				<HumanProfileDetailsPopover
					currentOwnerUserId="user-felix"
					entry={buildHumanEntry()}
					modelCatalog={null}
					organizationId="org-acme"
					orgSlug="acme"
					profileHref="/o/acme/people?profileId=human-monica"
					trigger={<button type="button">Open Monica</button>}
				/>
			</QueryClientProvider>
		);

		fireEvent.click(screen.getByRole("button", { name: "Open Monica" }));
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).queryByRole("heading", { name: "Agents" })
		).toBeNull();
		expect(dialog.querySelector(".border-t")).toBeNull();
	});

	it("keeps the last successful Computer connection while the member popover query refreshes", () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		queryClient.setQueryData(
			organizationQueryKeys.profileDirectory("org-acme"),
			buildProfileDirectory()
		);
		queryClient.setQueryData(
			organizationQueryKeys.computers("org-acme"),
			buildComputers()
		);
		render(
			<QueryClientProvider client={queryClient}>
				<HumanProfileDetailsPopover
					currentOwnerUserId="user-felix"
					entry={buildHumanEntry()}
					modelCatalog={null}
					organizationId="org-acme"
					orgSlug="acme"
					trigger={<button type="button">Open Monica</button>}
				/>
			</QueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: "Open Monica" }));
		expect(screen.getByText("Computer connected")).toBeTruthy();
		act(() => {
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.computers("org-acme"),
				refetchType: "none",
			});
		});
		expect(
			queryClient.getQueryState(organizationQueryKeys.computers("org-acme"))
				?.isInvalidated
		).toBe(true);
		expect(screen.getByText("Computer connected")).toBeTruthy();
		expect(screen.queryByText("Computer status unavailable")).toBeNull();
	});

	it("uses the same compact avatar and primary action for Agent details", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<AgentProfileDetailsContent
					chatHref="/o/acme/direct-messages/agent-codex"
					details={buildAgentDetails()}
					entry={buildAgentEntry()}
				/>
			</QueryClientProvider>
		);

		const avatar = screen.getByTestId(
			"agent-profile-controller-avatar-agent-codex"
		);
		expect(avatar.style.height).toBe("48px");
		expect(avatar.style.width).toBe("48px");
		const chatLink = screen.getByRole("link", {
			name: "Chat with Codex Design Reviewer",
		});
		expect(chatLink.className).toContain("h-8");
		expect(chatLink.className).not.toContain("min-h-10");
	});
});

describe("AgentProfileDetailsContent issue footer", () => {
	afterEach(cleanup);

	const reportMissingPlan: AgentProfileReplyRecoveryPlan = {
		body: "Codex is connected, but OpenMeld has no current local agent report from its computer.",
		kind: "prepare_agent_profile",
		primaryActionId: "check_status",
		primaryActionLabel: "Check status",
		profileId: "agent-codex",
		profileName: "Codex Design Reviewer",
		recoveryReasonCode: "agent_profile_binding.agent_controller_report_missing",
		secondaryLabel: "Needs setup on this computer",
		title: "Codex needs setup on this computer",
	};

	function renderIssue(
		plans: ReadonlyMap<string, AgentProfileReplyRecoveryPlan>
	) {
		return render(
			<QueryClientProvider client={new QueryClient()}>
				<SpaceAgentRecoveryProvider
					isAgentRecoveryPending={() => false}
					onAgentRecoveryAction={vi.fn(async () => undefined)}
					orgSlug="acme"
					plansByProfileId={plans}
				>
					<AgentProfileDetailsContent
						details={buildAgentDetails()}
						entry={{
							...buildAgentEntry(),
							availabilityBadgeLabel: "Setup needed",
							availabilityCategory: "unavailable",
						}}
					/>
				</SpaceAgentRecoveryProvider>
			</QueryClientProvider>
		);
	}

	it("shows the reason once, in the footer, next to the shared fix", () => {
		renderIssue(new Map([["agent-codex", reportMissingPlan]]));

		const footer = screen
			.getByText("Setup needed")
			.closest("[data-slot='agent-profile-issue-footer']");
		expect(footer).toBeTruthy();
		expect(screen.getAllByText("Setup needed")).toHaveLength(1);
		expect(
			within(footer as HTMLElement)
				.getByRole("link", { name: "Check status" })
				.getAttribute("href")
		).toBe("/o/acme/computers");
		expect(
			screen.queryByText("Connect a local agent before this profile can reply.")
		).toBeNull();
	});

	it("explains the next step when this viewer has no fix", () => {
		renderIssue(new Map());

		expect(screen.getByText("Setup needed")).toBeTruthy();
		expect(
			screen.getByText("Connect a local agent before this profile can reply.")
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Check status" })).toBeNull();
	});
});

function buildAgentDetails(): ProfileDetailsSnapshot {
	return {
		context: "space",
		profileId: "agent-codex",
		profileKind: "agent",
		profileName: "Codex Design Reviewer",
		sections: [
			{
				id: "profile",
				recoveryAction: null,
				rows: [
					{
						copy: null,
						id: "model",
						label: "Model",
						source: "agent_controller",
						value: "Codex · GPT-5.6 Sol · model default",
						valueKind: "text",
						visibility: "all_viewers",
					},
				],
				title: "Profile",
			},
		],
		viewerScope: "owner_self",
	};
}

function buildAgentEntry(): SpaceMemberDirectoryEntry {
	return {
		...buildHumanEntry(),
		agentControllerRef: "builtin:codex",
		availabilitySummary: "Connect a local agent before this profile can reply.",
		controllerDisplayName: "Codex",
		id: "agent-codex",
		ownerUserId: "user-felix",
		presenceLabel: "Connect",
		presenceStatus: "unavailable",
		profileId: "agent-codex",
		profileKind: "agent",
		profileName: "Codex Design Reviewer",
	};
}

function buildProfileDirectory(): OrganizationProfileDirectoryResponse {
	return {
		agentProfiles: [
			...Array.from({ length: 6 }, (_, index) => ({
				agentControllerRef: "builtin:codex",
				createdAt: `2026-09-0${index + 1}T00:00:00.000Z`,
				createdByUserId: "user-monica",
				creatorProfileId: "human-monica",
				isCenterAgent: false,
				isDefault: false as const,
				lastUsedAt: null,
				managedRole: null,
				organizationId: "org-acme",
				ownerName: "Monica Cheng",
				ownerUserId: "user-monica",
				profileHandle: `monica-agent-${index + 1}`,
				profileId: `agent-${index + 1}`,
				profileKind: "agent" as const,
				profileName: `Monica Agent ${index + 1}`,
				source: "test",
				status: "active" as const,
				updatedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
			})),
			{
				agentControllerRef: "hosted:center-agent",
				createdAt: "2026-09-05T00:00:00.000Z",
				createdByUserId: "user-monica",
				creatorProfileId: "human-monica",
				isCenterAgent: true,
				isDefault: false,
				lastUsedAt: null,
				managedRole: "center_agent",
				organizationId: "org-acme",
				ownerName: "Monica Cheng",
				ownerUserId: "user-monica",
				profileHandle: "center-agent",
				profileId: "center-agent",
				profileKind: "agent",
				profileName: "Center Agent",
				source: "test",
				status: "active",
				updatedAt: "2026-09-05T00:00:00.000Z",
			},
		],
		generatedAt: "2026-09-05T00:00:00.000Z",
		members: [],
		organizationId: "org-acme",
	};
}

function buildComputers(): OrganizationComputersResponse {
	return {
		computers: [
			{
				computerId: "computer-monica",
				deviceDisplayName: "Monica's MacBook Pro",
				deviceType: "laptop",
				lastSeenAtMs: Date.parse("2026-09-05T00:00:00.000Z"),
				localAgents: [],
				osVersion: "macOS 27.0",
				ownerUserId: "user-monica",
				platformFamily: "macOS",
				serviceState: "connected",
			},
		],
		generatedAt: "2026-09-05T00:00:00.000Z",
		organizationId: "org-acme",
	};
}

function buildHumanEntry(): SpaceMemberDirectoryEntry {
	return {
		addedByDisplayName: null,
		addedByProfileId: null,
		agentControllerConversationId: null,
		agentControllerPermissionMode: null,
		agentControllerRef: null,
		availabilityAction: null,
		availabilityBadgeLabel: null,
		availabilityCategory: null,
		availabilityIsRefreshing: false,
		availabilityPhase: null,
		availabilityReasonCode: null,
		availabilitySummary: null,
		availabilityTooltip: null,
		avatarUrl: null,
		controllerDisplayName: null,
		id: "human-monica",
		lastSeenAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
		lastSeenLabel: "Seen 7 hours ago",
		liveNow: false,
		manualParticipationOnly: false,
		mentionLabel: null,
		modelSelection: null,
		ownerDisplay: "Monica Cheng",
		ownerName: "Monica Cheng",
		ownerUserId: "user-monica",
		presenceLabel: "Seen 7 hours ago",
		presenceStatus: "offline",
		profileId: "human-monica",
		profileKind: "human",
		profileName: "Monica Cheng",
		runtimeDeviceDisplayName: null,
		searchText: "monica cheng",
		workingDirectory: null,
	};
}
