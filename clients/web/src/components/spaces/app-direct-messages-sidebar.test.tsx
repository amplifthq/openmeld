import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { AppDirectMessagesSidebar } from "./app-direct-messages-sidebar";

const {
	listAccountSpaceItemsMock,
	navigateMock,
	prefetchSpaceConversationIntentMock,
	preloadRouteMock,
	readSpaceMembersMock,
} = vi.hoisted(() => ({
	listAccountSpaceItemsMock: vi.fn(),
	navigateMock: vi.fn(),
	prefetchSpaceConversationIntentMock: vi.fn(),
	preloadRouteMock: vi.fn(),
	readSpaceMembersMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: () => navigateMock,
		useRouter: () => ({ preloadRoute: preloadRouteMock }),
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		activeOrganization: null,
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
		organizations: [],
	}),
}));

vi.mock("./use-space-conversation-intent-prefetch", () => ({
	useSpaceConversationIntentPrefetch: () => prefetchSpaceConversationIntentMock,
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: (...args: unknown[]) =>
		listAccountSpaceItemsMock(...args),
}));

vi.mock("#/query/spaces/members", () => ({
	spaceMembersQueryOptions: (input: {
		enabled: boolean;
		spaceId: string;
		openMeldProfileId: string;
	}) => ({
		enabled: input.enabled,
		queryFn: () => readSpaceMembersMock(input),
		queryKey: ["spaces", "members", input.spaceId, input.openMeldProfileId],
		retry: false,
	}),
}));

describe("AppDirectMessagesSidebar", () => {
	beforeEach(() => {
		listAccountSpaceItemsMock.mockReset();
		navigateMock.mockReset().mockResolvedValue(undefined);
		prefetchSpaceConversationIntentMock
			.mockReset()
			.mockResolvedValue(undefined);
		preloadRouteMock.mockReset().mockResolvedValue(undefined);
		readSpaceMembersMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows only current Direct Messages with the other participant identity", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-dm",
					spaceName: "Felix and Build Agent 2026-08-05",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 3,
					spaceId: "space-degraded-dm",
					spaceName: "Degraded DM",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 2,
					organizationId: "org-beta",
					spaceId: "space-other-org-dm",
					spaceName: "Other organization DM",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});
		readSpaceMembersMock.mockResolvedValue(
			createMembersSnapshot({
				peer: {
					agentControllerRef: "codex",
					profileId: "agt_peer",
					profileKind: "agent",
					profileName: "Build Agent",
				},
			})
		);

		const { container } = renderSidebar(
			<AppDirectMessagesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-dm"
			/>
		);

		const peerButton = await screen.findByRole("button", {
			name: "Build Agent",
		});
		expect(screen.queryByText("Felix and Build Agent 2026-08-05")).toBeNull();
		expect(screen.queryByText("Degraded DM")).toBeNull();
		expect(screen.queryByText("Other organization DM")).toBeNull();
		const agentProfileIcon = peerButton.querySelector<HTMLElement>(
			'[data-testid="space-profile-icon-agt_peer"]'
		);
		expect(agentProfileIcon).toBeTruthy();
		expect(agentProfileIcon?.className).toContain("size-6");
		expect(
			agentProfileIcon?.querySelector<HTMLElement>(
				'[data-testid="local-agent-logo-codex"]'
			)?.className
		).toContain("h-full");
		expect(
			peerButton.closest("[data-fluid-nav-value]")?.getAttribute("data-state")
		).toBe("active");
		await waitFor(() => {
			expect(
				container.querySelector('[data-slot="fluid-nav-menu-active-indicator"]')
			).toBeTruthy();
		});

		fireEvent.click(peerButton);

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-dm?profileId=human-1",
		});
	});

	it("uses the Space-specific joined profile when the current profile is not a member", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					joinedProfiles: [
						{
							lastJoinedAt: "2026-08-05T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-2",
							profileName: "Mira",
						},
					],
					openProfileId: "human-2",
					spaceId: "space-dm",
					spaceName: "Mira and Build Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});
		readSpaceMembersMock.mockResolvedValue(
			createMembersSnapshot({
				peer: {
					agentControllerRef: null,
					profileId: "agt_peer",
					profileKind: "agent",
					profileName: "Build Agent",
				},
				viewerProfileId: "human-2",
			})
		);

		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		fireEvent.click(await screen.findByRole("button", { name: "Build Agent" }));

		expect(readSpaceMembersMock).toHaveBeenCalledWith(
			expect.objectContaining({ openMeldProfileId: "human-2" })
		);
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-dm?profileId=human-2",
		});
	});

	it("prefetches a Direct Message immediately on keyboard intent", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-dm",
					spaceName: "Felix and Build Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});
		readSpaceMembersMock.mockResolvedValue(
			createMembersSnapshot({
				peer: {
					agentControllerRef: "codex",
					profileId: "agt_peer",
					profileKind: "agent",
					profileName: "Build Agent",
				},
			})
		);

		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		fireEvent.focus(await screen.findByRole("button", { name: "Build Agent" }));

		expect(preloadRouteMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-dm?profileId=human-1",
		});
		expect(prefetchSpaceConversationIntentMock).toHaveBeenCalledWith({
			spaceId: "space-dm",
			openMeldProfileId: "human-1",
		});
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("shows a clear empty state when there are no Direct Messages", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByText("No Direct Messages yet.")).toBeTruthy();
		expect(readSpaceMembersMock).not.toHaveBeenCalled();
	});

	it("keeps the last saved Direct Messages navigable when background refresh fails", async () => {
		const queryClient = createQueryClient();
		const savedSections = {
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-dm",
					spaceName: "Felix and Build Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		};
		const queryKey = accountSpaceQueryKeys.items("human-1", "account");
		queryClient.setQueryData(queryKey, savedSections);
		await queryClient.invalidateQueries({ queryKey, refetchType: "none" });
		listAccountSpaceItemsMock.mockRejectedValue(
			new Error("Direct Messages refresh failed")
		);
		readSpaceMembersMock.mockResolvedValue(
			createMembersSnapshot({
				peer: {
					agentControllerRef: "codex",
					profileId: "agt_peer",
					profileKind: "agent",
					profileName: "Build Agent",
				},
			})
		);

		renderSidebar(
			<AppDirectMessagesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-dm"
			/>,
			queryClient
		);

		await waitFor(() => {
			expect(queryClient.getQueryState(queryKey)?.status).toBe("error");
		});
		expect(
			screen.getByText(
				"Couldn't refresh Direct Messages. Showing the last saved list from this browser."
			)
		).toBeTruthy();
		const peerButton = await screen.findByRole("button", {
			name: "Build Agent",
		});
		fireEvent.click(peerButton);
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-dm?profileId=human-1",
		});
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});
});

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, retryDelay: 1 },
		},
	});
}

function renderSidebar(
	element: ReactElement,
	queryClient = createQueryClient()
) {
	return render(
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{element}</TooltipProvider>
		</QueryClientProvider>
	);
}

function createAccountSpaceItem(input: {
	activeMemberCount: number;
	joinedProfiles?: Array<{
		lastJoinedAt: string;
		pinnedAt: string | null;
		profileId: string;
		profileName: string;
	}>;
	openProfileId?: string;
	organizationId?: string;
	spaceId: string;
	spaceName: string;
	spacePurpose: string;
}) {
	return {
		activeAgentCount: 1,
		activeHumanCount: 1,
		activeMemberCount: input.activeMemberCount,
		joinedProfiles: input.joinedProfiles ?? [
			{
				lastJoinedAt: "2026-08-05T00:00:00.000Z",
				pinnedAt: null,
				profileId: "human-1",
				profileName: "Felix",
			},
		],
		lastJoinedAt: "2026-08-05T00:00:00.000Z",
		openProfileId: input.openProfileId ?? "human-1",
		openProfileName: "Felix",
		organizationId: input.organizationId ?? "org-acme",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: input.spaceId,
		spaceName: input.spaceName,
		spacePurpose: input.spacePurpose,
		visibility: "private" as const,
	};
}

function createMembersSnapshot(input: {
	peer: {
		agentControllerRef: string | null;
		profileId: string;
		profileKind: "agent";
		profileName: string;
	};
	viewerProfileId?: string;
}) {
	const viewerProfileId = input.viewerProfileId ?? "human-1";
	return {
		agents: [
			{
				...input.peer,
				status: "active",
			},
		],
		generatedAt: "2026-08-05T00:00:00.000Z",
		humans: [
			{
				avatarUrl: null,
				profileId: viewerProfileId,
				profileKind: "human",
				profileName: "Felix",
				status: "active",
			},
		],
		spaceId: "space-dm",
		summary: {
			agentCount: 1,
			humanCount: 1,
			liveNowCount: 0,
			totalCount: 2,
		},
	};
}
