import type { GetCenterAgentDesignationResponse } from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { AppDirectMessagesSidebar } from "./app-direct-messages-sidebar";

vi.mock("./direct-message-preview", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./direct-message-preview")>();
	return {
		...actual,
		spaceMessagePreviewQueryOptions: (
			input: Parameters<typeof actual.spaceMessagePreviewQueryOptions>[0]
		) => ({
			...actual.spaceMessagePreviewQueryOptions(input),
			initialData: null,
			queryFn: () => Promise.resolve(null),
		}),
	};
});

const { listAccountSpaceItemsMock, readProfileDirectoryMock, spaceUnreadById } =
	vi.hoisted(() => ({
		listAccountSpaceItemsMock: vi.fn(),
		readProfileDirectoryMock: vi.fn(),
		spaceUnreadById: new Map<
			string,
			{ latestUnreadOccurredAtMs: number; unreadCount: number }
		>(),
	}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: () => vi.fn(),
		Link: ({
			children,
			to,
			...props
		}: {
			children: ReactNode;
			to: string;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
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

vi.mock("./use-account-space-indicators", () => ({
	useSpaceInboxUnreadById: () => spaceUnreadById,
	useAccountSpaceIndicators: () => ({
		unreadBySpaceId: spaceUnreadById,
		activeWakeSummaryBySpaceId: new Map(),
		activeWakeSpaceIds: new Set(),
	}),
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
	}),
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: (...args: unknown[]) =>
		listAccountSpaceItemsMock(...args),
}));

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationProfileDirectory: (...args: unknown[]) =>
		readProfileDirectoryMock(...args),
}));

vi.mock("#/lib/organizations/center-agent", () => ({
	readCurrentCenterAgentDesignation: async () =>
		({
			organizationId: "org-acme",
			designation: null,
		}) satisfies GetCenterAgentDesignationResponse,
}));

describe("AppDirectMessagesSidebar", () => {
	beforeEach(() => {
		listAccountSpaceItemsMock.mockReset();
		readProfileDirectoryMock.mockReset();
		readProfileDirectoryMock.mockResolvedValue(createProfileDirectory());
		spaceUnreadById.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows only current Direct Messages with the other participant identity", async () => {
		spaceUnreadById.set("space-dm", {
			latestUnreadOccurredAtMs: 2000,
			unreadCount: 2,
		});
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
		const { container } = renderSidebar(
			<AppDirectMessagesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-dm"
			/>
		);

		const peerButton = await screen.findByRole("link", {
			name: "Build Agent, unread messages",
		});
		expect(
			peerButton.querySelector('[data-direct-message-unread-indicator="true"]')
		).toBeTruthy();
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

		expect(peerButton.getAttribute("href")).toBe(
			"/o/acme/chats/space-dm?profileId=human-1"
		);
		expect(readProfileDirectoryMock).toHaveBeenCalledTimes(1);
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
		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		const link = await screen.findByRole("link", { name: "Build Agent" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/chats/space-dm?profileId=human-2"
		);
	});

	it("uses the Router link for Direct Message navigation", async () => {
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
		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		const link = await screen.findByRole("link", { name: "Build Agent" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/chats/space-dm?profileId=human-1"
		);
	});

	it("reuses the Organization directory avatar for a human peer", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					directMessageProfileIds: ["human-1", "human-peer"],
					spaceId: "space-dm",
					spaceName: "Felix and Monica",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});
		readProfileDirectoryMock.mockResolvedValue({
			...createProfileDirectory(),
			agentProfiles: [],
			members: [
				{
					humanProfile: {
						profileId: "human-peer",
						profileName: "Monica",
						status: "active",
					},
					user: { image: "https://example.com/monica.png" },
				},
			],
		});

		renderSidebar(
			<AppDirectMessagesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Monica" });
		expect(link.querySelector("img")?.getAttribute("src")).toBe(
			"https://example.com/monica.png"
		);
	});

	it("reports an empty list to the parent Chats surface without an empty category", async () => {
		const onFirstChatChange = vi.fn();
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<AppDirectMessagesSidebar
				currentProfileId="human-1"
				currentSpaceId=""
				onFirstChatChange={onFirstChatChange}
			/>
		);

		await waitFor(() =>
			expect(onFirstChatChange).toHaveBeenLastCalledWith(null)
		);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.queryByText("Conversations will appear here.")).toBeNull();
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
		const peerButton = await screen.findByRole("link", {
			name: "Build Agent",
		});
		expect(peerButton.getAttribute("href")).toBe(
			"/o/acme/chats/space-dm?profileId=human-1"
		);
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
	directMessageProfileIds?: [string, string];
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
		directMessageProfileIds: input.directMessageProfileIds ?? [
			input.openProfileId ?? "human-1",
			"agt_peer",
		],
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

function createProfileDirectory() {
	return {
		agentProfiles: [
			{
				agentControllerRef: "codex",
				profileId: "agt_peer",
				profileKind: "agent",
				profileName: "Build Agent",
				status: "active",
			},
		],
		generatedAt: "2026-08-05T00:00:00.000Z",
		members: [],
		organizationId: "org-acme",
	};
}
