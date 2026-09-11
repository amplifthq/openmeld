import type { ListCenterAgentSessionsResponse } from "@openmeld/schemas";
import {
	ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS,
	upsertProfileSpaceHistoryResponseSchema,
} from "@openmeld/schemas";
import type {
	OrganizationProfileDirectoryResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	createWakeProgressItem,
	OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "@openmeld/space";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { OPENMELD_WELCOMING_SPACE_PURPOSE } from "#/lib/spaces/welcoming-space";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	setSpaceWakeProgressPresentationItems,
	spaceActiveWakeProgressSummaryQueryOptions,
} from "#/query/spaces/active-wake-progress";
import { ConversationsSidebar } from "./conversations-sidebar";
import {
	SpaceWakeProgressVisibleProjectionProvider,
	usePublishSpaceWakeProgressVisibleProjection,
} from "./space-wake-progress-visible-projection";

const ACTIVE_NAME_PATTERN_1 = /^Beta, (?=.*(?:Wake|working|waiting)).+/i;
const ACTIVE_NAME_PATTERN_2 = /^Alpha, .*Wake/;
const ACTIVE_NAME_PATTERN_3 = /^Alpha, (?=.*(?:Wake|working|waiting)).+/i;
const ACTIVE_NAME_PATTERN_4 = /^Alpha, .*waiting/i;
const ACTIVE_NAME_PATTERN_5 = /^Alpha, .*Wakes are active/;
const ACTIVE_NAME_PATTERN_6 = /^Working, unread messages, .*Wake/;

const OTHER_JOINED_PROFILE_TEXT = /Other joined profile/;
const BROWSE_SPACES_TEXT = /Browse Spaces/;

vi.mock("../app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			pinned: { sort: "priority", spaceIds: [] },
			spaces: { sort: "priority", spaceIds: [] },
			groups: [],
		},
		isPending: false,
		disabled: false,
		save: vi.fn(),
		saveAsync: vi.fn().mockResolvedValue(undefined),
	}),
}));

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

function WakeProgressProjectionPublisher(input: {
	items: readonly WakeProgressItem[];
}) {
	usePublishSpaceWakeProgressVisibleProjection(input.items);
	return null;
}

type AppOrganizationMock = {
	currentUserId: string;
	activeOrganization: OrganizationSummary | null;
	currentOrganization: OrganizationSummary;
	organizations: OrganizationSummary[];
};

function getSidebarGroupLabel(name: string): HTMLElement {
	const matches = Array.from(
		new Set(
			screen
				.getAllByRole("heading", { level: 2, name })
				.map((element) =>
					element.closest<HTMLElement>('[data-slot="sidebar-group-label"]')
				)
				.filter((element): element is HTMLElement => element !== null)
		)
	);
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one sidebar group label named ${name}.`);
	}
	return matches[0] as HTMLElement;
}

const {
	appOrganizationMock,
	getAccountSpaceActiveWakeSummaryMock,
	getCurrentSpaceInboxSummaryMock,
	getActiveWakeProgressMock,
	listAccountSpaceItemsMock,
	navigateMock,
	setAccountSpaceItemPinnedMock,
} = vi.hoisted(() => ({
	appOrganizationMock: {
		currentUserId: "user-1",
		activeOrganization: null,
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
		organizations: [
			{
				id: "org-personal",
				isPersonal: true,
				name: "Mira",
				slug: "mira",
			},
			{
				id: "org-acme",
				isPersonal: false,
				name: "Acme",
				slug: "acme",
			},
		],
	} as AppOrganizationMock,
	getAccountSpaceActiveWakeSummaryMock: vi.fn(),
	getCurrentSpaceInboxSummaryMock: vi.fn(),
	getActiveWakeProgressMock: vi.fn(),
	listAccountSpaceItemsMock: vi.fn(),
	navigateMock: vi.fn(),
	setAccountSpaceItemPinnedMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			resetScroll: _resetScroll,
			...props
		}: {
			children: ReactNode;
			to: string;
			resetScroll?: boolean;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		useNavigate: () => navigateMock,
		useRouterState: ({
			select,
		}: {
			select: (state: { location: { searchStr: string } }) => unknown;
		}) => select({ location: { searchStr: "" } }),
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => appOrganizationMock,
	useCurrentOrganizationSlug: () =>
		appOrganizationMock.currentOrganization.slug,
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: (
		...args: Parameters<typeof listAccountSpaceItemsMock>
	) => listAccountSpaceItemsMock(...args),
	setAccountSpaceItemPinned: (
		...args: Parameters<typeof setAccountSpaceItemPinnedMock>
	) => setAccountSpaceItemPinnedMock(...args),
}));

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentSpaceInboxSummary: (
		...args: Parameters<typeof getCurrentSpaceInboxSummaryMock>
	) => getCurrentSpaceInboxSummaryMock(...args),
}));

vi.mock("#/lib/spaces/account-space-active-wake", () => ({
	getAccountSpaceActiveWakeSummary: (
		...args: Parameters<typeof getAccountSpaceActiveWakeSummaryMock>
	) => getAccountSpaceActiveWakeSummaryMock(...args),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		getActiveWakeProgress: (...args: unknown[]) =>
			getActiveWakeProgressMock(...args),
	}),
}));

vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human-1" },
	}),
}));
vi.mock("./new-chat-dialog", () => ({ NewChatDialog: () => null }));
vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationProfileDirectory: () =>
		Promise.resolve({
			organizationId: appOrganizationMock.currentOrganization.id,
			generatedAt: "2026-09-10T00:00:00.000Z",
			members: [],
			agentProfiles: [],
		} satisfies OrganizationProfileDirectoryResponse),
}));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createCenterAgentApi: () => ({
		listSessions: () =>
			Promise.resolve({
				organizationId: appOrganizationMock.currentOrganization.id,
				generatedAt: "2026-09-10T00:00:00.000Z",
				sessions: [],
				nextCursor: null,
			} satisfies ListCenterAgentSessionsResponse),
	}),
}));

describe("ConversationsSidebar", () => {
	it("[S01] uses the unopened Space snapshot and removes its marker when its tasks finish", async () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);
		const working = createWakeProgressItem({
			clientMessageId: "client-beta",
			dispatchId: "dispatch-beta",
			phase: "running",
			sourceSignalId: "signal-beta",
			targetLabel: "Reviewer",
			targetProfileId: "agent-beta",
			updatedAtMs: Date.now(),
		});
		const response = {
			items: [
				working,
				{
					...working,
					dispatchId: "dispatch-question",
					targetLabel: "Planner",
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: null,
						interactionId: "question-beta",
						kind: "question" as const,
						request: null,
						requestedAtMs: Date.now(),
					},
				},
			],
			pageInfo: { hasMore: false, limit: 50 },
			query: { spaceId: "space-beta", targetProfileId: null },
		};
		getActiveWakeProgressMock.mockResolvedValue(response);
		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);
		expect(
			await screen.findByRole("img", {
				name: "Planner needs your input; Reviewer is working",
			})
		).toBeTruthy();
		expect(getActiveWakeProgressMock).toHaveBeenCalledWith(
			expect.objectContaining({ spaceId: "space-beta" })
		);
		getActiveWakeProgressMock.mockResolvedValue({ ...response, items: [] });
		await act(async () => {
			await queryClient.invalidateQueries({
				queryKey: spaceActiveWakeProgressSummaryQueryOptions({
					enabled: true,
					openMeldProfileId: "human-1",
					spaceId: "space-beta",
				}).queryKey,
			});
		});
		expect(await screen.findByRole("link", { name: "Beta" })).toBeTruthy();
		expect(
			screen.queryByRole("link", {
				name: ACTIVE_NAME_PATTERN_1,
			})
		).toBeNull();
	});

	beforeEach(() => {
		// Row-action tests exercise a user's explicitly expanded sidebar.
		for (const organization of ["org-acme", "org-personal"]) {
			localStorage.setItem(
				`openmeld:space-sidebar-disclosure:human-1:${organization}`,
				JSON.stringify({ pinned: true, spaces: true })
			);
		}
		appOrganizationMock.activeOrganization = {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		};
		appOrganizationMock.currentOrganization = {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		};
		listAccountSpaceItemsMock.mockReset();
		getActiveWakeProgressMock
			.mockReset()
			.mockRejectedValue(new Error("Snapshot unavailable"));
		getAccountSpaceActiveWakeSummaryMock.mockReset().mockResolvedValue({
			generatedAtMs: 0,
			items: [],
		});
		getCurrentSpaceInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "org-acme",
			spaces: [],
		});
		navigateMock.mockReset();
		navigateMock.mockResolvedValue(undefined);
		setAccountSpaceItemPinnedMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		localStorage.clear();
		focusManager.setFocused(undefined);
	});

	it("[S02] shows the indexed message time without subscribing to per-Space previews", async () => {
		const timestamp = Date.parse("2026-09-06T17:00:00.000Z");
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				{
					...createAccountSpaceItem({
						spaceId: "space-alpha",
						spaceName: "Alpha",
					}),
					messagePreview: {
						signalId: "message-alpha",
						profileId: "human-1",
						timestamp,
						text: "Ready for review.",
					},
				},
			],
		});
		const queryClient = createSidebarQueryClient();
		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />,
			queryClient
		);
		const row = await screen.findByRole("link", { name: "Alpha" });
		expect(row.querySelector("time")?.getAttribute("datetime")).toBe(
			new Date(timestamp).toISOString()
		);
		expect(
			queryClient
				.getQueryCache()
				.getAll()
				.filter((query) => query.queryKey.includes("incoming-preview"))
		).toHaveLength(0);
	});

	it("[S03] moves unpinned Spaces with unread messages first and shows a static accessible indicator", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 2000,
					spaceId: "space-beta",
					unreadCount: 2,
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const beta = await screen.findByRole("link", {
			name: "Beta, unread messages",
		});
		const alpha = screen.getByRole("link", { name: "Alpha" });

		expect(beta.compareDocumentPosition(alpha)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			getConversationRow(beta).querySelector(
				"[data-conversation-unread-indicator]"
			)
		).toBeTruthy();
		expect(beta.className).not.toContain("animate-");
	});

	it("[S04] keeps the shared pinned order stable when an older pin is unread", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
			spaceItems: [],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-beta",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const alpha = await screen.findByRole("link", { name: "Alpha" });
		const beta = screen.getByRole("link", {
			name: "Beta, unread messages",
		});
		expect(alpha.compareDocumentPosition(beta)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("[S05] keeps unread recency ahead of newly joined Spaces", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-28T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-30T00:00:00.000Z"),
					spaceId: "space-z-existing",
					spaceName: "Existing",
					messageTimestamp: 5000,
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-a-new",
					spaceName: "Launch Room",
					messageTimestamp: 1000,
				}),
			],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 5000,
					spaceId: "space-z-existing",
					unreadCount: 2,
				},
				{
					latestUnreadOccurredAtMs: 1000,
					spaceId: "space-a-new",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const newSpace = await screen.findByRole("link", {
			name: "Launch Room, unread messages",
		});
		const existingSpace = screen.getByRole("link", {
			name: "Existing, unread messages",
		});
		expect(newSpace.compareDocumentPosition(existingSpace)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
		expect(
			newSpace
				.querySelector("[data-conversation-title]")
				?.classList.contains("font-semibold")
		).toBe(true);
		expect(newSpace.classList.contains("text-primary")).toBe(false);
		expect(
			getConversationRow(newSpace).querySelector(
				'[data-conversation-unread-indicator="true"]'
			)
		).toBeTruthy();
	});

	it("[S06] keeps pin order when a Space has never been opened", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-30T00:00:00.000Z"),
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-pinned-first",
					spaceName: "Pinned First",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned-new",
					spaceName: "Pinned New",
				}),
			],
			spaceItems: [],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const pinnedNew = await screen.findByRole("link", {
			name: "Pinned New",
		});
		const pinnedFirst = screen.getByRole("link", { name: "Pinned First" });
		expect(pinnedNew.compareDocumentPosition(pinnedFirst)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
	});

	it("[S07] preserves pin and unread ordering when the open owner records lastSeenTs", async () => {
		const initialSections = {
			pinnedItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-pinned-first",
					spaceName: "Pinned First",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned-new",
					spaceName: "Pinned New",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-regular-new",
					spaceName: "Regular New",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					spaceId: "space-regular-unread",
					spaceName: "Regular Unread",
				}),
			],
		};
		listAccountSpaceItemsMock.mockResolvedValue(initialSections);
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 5000,
					spaceId: "space-regular-unread",
					unreadCount: 1,
				},
			],
		});
		const queryClient = createSidebarQueryClient();

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />,
			queryClient
		);
		const pinnedNew = await screen.findByRole("link", {
			name: "Pinned New",
		});
		const pinnedFirst = screen.getByRole("link", { name: "Pinned First" });
		const regularNew = screen.getByRole("link", {
			name: "Regular New",
		});
		const regularUnread = screen.getByRole("link", {
			name: "Regular Unread, unread messages",
		});
		expect(pinnedNew.compareDocumentPosition(pinnedFirst)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
		expect(regularNew.compareDocumentPosition(regularUnread)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);

		const seenAt = Date.parse("2026-04-30T00:00:00.000Z");
		act(() => {
			queryClient.setQueryData(
				accountSpaceQueryKeys.items("human-1", "account"),
				{
					pinnedItems: initialSections.pinnedItems.map((item) => ({
						...item,
						lastSeenTs: seenAt,
					})),
					spaceItems: initialSections.spaceItems.map((item) => ({
						...item,
						lastSeenTs: seenAt,
					})),
				}
			);
		});

		await waitFor(() => {
			expect(
				screen
					.getByRole("link", { name: "Pinned First" })
					.compareDocumentPosition(
						screen.getByRole("link", { name: "Pinned New" })
					)
			).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
			expect(
				screen
					.getByRole("link", {
						name: "Regular Unread, unread messages",
					})
					.compareDocumentPosition(
						screen.getByRole("link", { name: "Regular New" })
					)
			).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		});
	});

	it("[S08] does not mark a previously seen Space as new when its join timestamp advances", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-20T00:00:00.000Z"),
					spaceId: "space-seen-before",
					spaceName: "Previously Seen",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Previously Seen" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: "Previously Seen",
			})
		).toBeNull();
	});

	it("[S09] keeps an unseen Space available through render, hover, and focus", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-first-unseen",
					spaceName: "First Unseen",
				}),
			],
		});
		const view = renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const firstUnseen = await screen.findByRole("link", {
			name: "First Unseen",
		});
		fireEvent.pointerEnter(firstUnseen);
		fireEvent.focus(firstUnseen);
		view.rerender(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(screen.getByRole("link", { name: "First Unseen" })).toBeTruthy();
	});

	it("[S10] shows a newly joined Space as soon as the window regains focus", async () => {
		focusManager.setFocused(false);
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
				],
			})
			.mockResolvedValue({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
					createAccountSpaceItem({
						lastJoinedAt: "2026-04-29T00:00:00.000Z",
						lastSeenTs: null,
						spaceId: "space-new-on-focus",
						spaceName: "Focus Room",
					}),
				],
			});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		await screen.findByRole("link", { name: "Existing" });
		expect(screen.queryByText("Focus Room")).toBeNull();

		act(() => focusManager.setFocused(true));

		expect(
			await screen.findByRole("link", {
				name: "Focus Room",
			})
		).toBeTruthy();
	});

	it("[S11] keeps cached Spaces visible when a foreground refresh fails", async () => {
		focusManager.setFocused(false);
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
				],
			})
			.mockRejectedValueOnce(
				Object.assign(new Error("temporary refresh failure"), {
					code: "gateway.invalid_response",
				})
			);
		const queryClient = createSidebarQueryClient();

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />,
			queryClient
		);
		await screen.findByRole("link", { name: "Existing" });

		act(() => focusManager.setFocused(true));
		await waitFor(() => {
			expect(
				queryClient.getQueryState(
					accountSpaceQueryKeys.items("human-1", "account")
				)?.status
			).toBe("error");
		});

		expect(screen.getByRole("link", { name: "Existing" })).toBeTruthy();
		expect(
			screen.queryByText("OpenMeld could not load your spaces.")
		).toBeNull();
	});

	it("[S12] hides the pinned section when no Spaces are pinned", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.queryByRole("heading", { level: 2, name: "Pinned" })
		).toBeNull();
	});

	it("[S13] hides legacy welcoming spaces from the sidebar", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-welcome-pinned",
					spaceName: "Welcome Pinned",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T00:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-welcome-regular",
					spaceName: "Welcome Regular",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const pinnedSpace = await screen.findByRole("link", {
			name: "Pinned Alpha",
		});
		expect(screen.queryByText("Welcome Pinned")).toBeNull();
		expect(screen.queryByText("Welcome Regular")).toBeNull();
		expect(screen.queryByText("Welcoming")).toBeNull();
		const pinnedHeading = getSidebarGroupLabel("Pinned");
		const spacesHeading = getSidebarGroupLabel("Spaces");

		expect(pinnedHeading.compareDocumentPosition(spacesHeading)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(pinnedHeading.compareDocumentPosition(pinnedSpace)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			spacesHeading.compareDocumentPosition(
				screen.getByRole("link", { name: "Regular Beta" })
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("[S14] keeps DMs out of the Spaces group while showing them once in shared navigation", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-dm-pinned",
					spaceName: "Felix and Center Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 3,
					spaceId: "space-dm-degraded",
					spaceName: "Felix and Center Agent plus Ada",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-ordinary-two-person",
					spaceName: "Ordinary Pair",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await screen.findByRole("link", {
			name: "Felix and Center Agent plus Ada",
		});
		const spaces = within(screen.getByRole("region", { name: "Spaces" }));
		expect(
			spaces.queryByRole("link", { name: "Felix and Center Agent" })
		).toBeNull();
		expect(
			spaces.getByRole("link", { name: "Felix and Center Agent plus Ada" })
		).toBeTruthy();
		expect(spaces.getByRole("link", { name: "Ordinary Pair" })).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Pinned" })).getByRole("link", {
				name: "Felix and Center Agent",
			})
		).toBeTruthy();
		expect(
			screen.getAllByRole("link", { name: "Felix and Center Agent" })
		).toHaveLength(1);
	});

	it("[S15] keeps a channel icon when member previews are not available", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		for (const spaceName of ["Pinned Alpha", "Regular Beta"]) {
			const row = await screen.findByRole("link", { name: spaceName });
			expect(row?.querySelector('svg[aria-label="Space"]')).toBeTruthy();
		}
	});

	it("[S16] filters account-scoped spaces to the current organization before grouping", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-personal-pinned",
					spaceName: "Personal Pinned",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					spaceId: "space-personal-welcome",
					spaceName: "Personal Welcome",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					organizationId: "org-beta",
					spaceId: "space-beta",
					spaceName: "Beta Project",
				}),
				createAccountSpaceItem({
					organizationId: "org-acme",
					spaceId: "space-acme",
					spaceName: "Acme Project",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Acme Project" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Personal Pinned" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Personal Welcome" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Beta Project" })).toBeNull();
		expect(
			screen.queryByRole("heading", { level: 2, name: "Pinned" })
		).toBeNull();
		expect(screen.queryByText("Welcoming")).toBeNull();
	});

	it("[S17] hides personal legacy welcoming spaces in the personal context", async () => {
		appOrganizationMock.activeOrganization = null;
		appOrganizationMock.currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Mira",
			slug: "mira",
		};
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					spaceId: "space-personal-welcome",
					spaceName: "Mira Welcome",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					organizationId: "org-acme",
					spaceId: "space-acme",
					spaceName: "Acme Project",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await waitFor(() => {
			expect(listAccountSpaceItemsMock).toHaveBeenCalled();
		});
		expect(screen.queryByRole("link", { name: "Mira Welcome" })).toBeNull();
		expect(screen.queryByText("Welcoming")).toBeNull();
		expect(screen.queryByRole("link", { name: "Acme Project" })).toBeNull();
	});

	it("[S18] renders the Spaces title without repeating the OpenMeld brand", () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		const { container } = renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		const sidebarHeader = container.querySelector(
			'[data-slot="sidebar-header"]'
		);

		expect(sidebarHeader).toBeNull();
		expect(screen.getByRole("link", { name: "Spaces" })).toBeTruthy();
		expect(screen.queryByText("Chatroom for agents & humans")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "OpenMeld Spaces" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
	});

	it("[S19] keeps the Web profile out of Space navigation metadata", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "Mira",
						},
					],
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(screen.queryByText("Joined as Mira")).toBeNull();
		expect(screen.queryByText("Joined as Codex")).toBeNull();
		expect(screen.queryByText("1 other profile also joined")).toBeNull();
	});

	it("[S20] reclaims the timestamp area when a space item is narrow", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });
		expect(
			link
				.querySelector('[data-sidebar="menu-heading"]')
				?.classList.contains("min-w-0")
		).toBe(true);
		expect(
			link
				.querySelector("[data-conversation-title]")
				?.classList.contains("truncate")
		).toBe(true);
		expect(link.style.getPropertyValue("--row-gutter")).toBe("8px");
		expect(screen.getByRole("button", { name: "Pin Alpha" })).toBeTruthy();
		// The browser geometry check exercises the actual narrow-width allocation (S20/S32).
		expect(
			getConversationRow(link).querySelector("[data-conversation-activity]")
		).toBeNull();
	});

	it("[S21] shows active Agent names only from the Working orb tooltip", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now() + 12_566,
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-beta"
			/>
		);

		const link = await screen.findByRole("link", {
			name: ACTIVE_NAME_PATTERN_2,
		});
		const status = within(getConversationRow(link)).getByRole("img", {
			name: "Clico Codex has an active Wake",
		});
		expect(status.closest("a")?.getAttribute("href")).toBe(
			link.getAttribute("href")
		);
		expect(
			document.querySelectorAll('[data-conversation-activity="active"]')
		).toHaveLength(1);
		expect(
			screen.queryByRole("tooltip", { name: "Clico Codex has an active Wake" })
		).toBeNull();
		hoverActivity(status);
		expect(
			(await screen.findByText("Clico Codex has an active Wake"))
				.closest('[data-slot="tooltip-content"]')
				?.hasAttribute("data-open")
		).toBe(true);
		expect(
			screen
				.getByRole("link", { name: "Beta" })
				.querySelector("[data-conversation-activity]")
		).toBeNull();
		expect(screen.getByRole("button", { name: "Pin Alpha" })).toBeTruthy();
	});

	it("[S22] lists every named Agent in the Working orb tooltip", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
						{
							activeWakeCount: 1,
							profileId: "agt_felix",
							profileName: "Felix Codex",
						},
					],
					activeWakeCount: 2,
					spaceId: "space-alpha",
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const workingStatus = await screen.findByRole("img", {
			name: "Clico Codex and Felix Codex have an active Wake",
		});
		hoverActivity(workingStatus);
		await waitFor(() => {
			expect(
				screen.getByText("Clico Codex and Felix Codex have an active Wake")
			).toBeTruthy();
		});
	});

	it("[S23] uses the frozen target name when current Working progress only has a raw Agent id", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_deleted",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});
		const queryClient = createSidebarQueryClient();
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "@agt_deleted",
					targetProfileId: "agt_deleted",
					updatedAtMs: Date.now(),
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: ACTIVE_NAME_PATTERN_3,
			})
		).toBeTruthy();
		expect(
			screen.getByRole("img", {
				name: "Clico Codex is working",
			})
		).toBeTruthy();
		expect(
			document.querySelector('[data-conversation-activity="active"]')
		).toBeTruthy();
	});

	it("[S24] shows that the current Agent is waiting when its current task is occupied", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});
		const queryClient = createSidebarQueryClient();
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Clico Codex",
					targetProfileId: "agt_clico",
					updatedAtMs: Date.now(),
					waitReasonCode: "runtime.agent_controller_conversation.occupied",
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: ACTIVE_NAME_PATTERN_4,
			})
		).toBeTruthy();
		expect(
			screen.getByRole("img", {
				name: "Waiting for Clico Codex’s current task",
			})
		).toBeTruthy();
		expect(
			document.querySelector('[data-conversation-activity="waiting"]')
		).toBeTruthy();
		expect(
			document.querySelector('[data-conversation-activity="active"]')
		).toBeNull();
	});

	it("[S25] keeps the current Space orb aligned with a recovered Core active Wake summary", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockRejectedValue(
			new Error("account active Wake summary unavailable")
		);
		const queryClient = createSidebarQueryClient();
		const currentSpaceSummaryOptions =
			spaceActiveWakeProgressSummaryQueryOptions({
				enabled: false,
				openMeldProfileId: "human-1",
				spaceId: "space-alpha",
			});
		queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: Date.now(),
				}),
			],
			query: {
				spaceId: "space-alpha",
				targetProfileId: null,
			},
		});

		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: ACTIVE_NAME_PATTERN_3,
			})
		).toBeTruthy();
		expect(
			screen.getByRole("img", {
				name: "Runner is working",
			})
		).toBeTruthy();
	});

	it.each([
		"failed",
		"stopped",
	] as const)("[S25-terminal] does not keep the current Space orb when newer shared progress is %s", async (terminalPhase) => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{ activeWakeCount: 1, spaceId: "space-alpha" },
				{ activeWakeCount: 1, spaceId: "space-beta" },
			],
		});
		const queryClient = createSidebarQueryClient();
		const nowMs = Date.now();
		const currentSpaceSummaryOptions =
			spaceActiveWakeProgressSummaryQueryOptions({
				enabled: false,
				openMeldProfileId: "human-1",
				spaceId: "space-alpha",
			});
		queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: nowMs,
				}),
			],
			query: {
				spaceId: "space-alpha",
				targetProfileId: null,
			},
		});
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: terminalPhase,
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: nowMs + 1,
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: ACTIVE_NAME_PATTERN_1,
			})
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-conversation-activity="active"]')
		).toHaveLength(1);
	});

	it("[S26] clears the current Space orb when a final reply resolves the visible projection", async () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);
		const runningItems = [
			createWakeProgressItem({
				clientMessageId: "client-message-alpha",
				dispatchId: "dispatch-alpha",
				phase: "running",
				sourceSignalId: "signal-alpha",
				targetLabel: "Runner",
				targetProfileId: "agent-alpha",
				updatedAtMs: Date.now(),
			}),
		];
		const view = renderSidebar(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={runningItems} />
				<ConversationsSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: ACTIVE_NAME_PATTERN_3,
			})
		).toBeTruthy();

		view.rerender(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={[]} />
				<ConversationsSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>
		);

		expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: ACTIVE_NAME_PATTERN_1,
			})
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-conversation-activity="active"]')
		).toHaveLength(1);
	});

	it("[S27] uses an already-final projection on the first Space shell paint", () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);

		renderSidebar(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={[]} />
				<ConversationsSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>,
			queryClient
		);

		expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: ACTIVE_NAME_PATTERN_1,
			})
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-conversation-activity="active"]')
		).toHaveLength(1);
	});

	it("[S28] does not render a working orb from an expired cached summary", async () => {
		const client = createSidebarQueryClient();
		const spaces = {
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({ spaceId: "space-alpha", spaceName: "Alpha" }),
			],
		};
		const stale = {
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 1, spaceId: "space-alpha" }],
		};
		listAccountSpaceItemsMock.mockResolvedValue(spaces);
		client.setQueryData(
			accountSpaceQueryKeys.items("human-1", "account"),
			spaces
		);
		client.setQueryData(accountSpaceQueryKeys.activeWakeSummary("human-1"), {
			browserRequestStartedAtMonotonicMs: 9999,
			summary: stale,
		});
		const clock = vi
			.spyOn(performance, "now")
			.mockReturnValue(10_000 + ACCOUNT_SPACE_ACTIVE_WAKE_SUMMARY_MAX_AGE_MS);
		let finish: () => void = () => undefined;
		const refresh = new Promise<void>((resolve) => {
			finish = resolve;
		});
		getAccountSpaceActiveWakeSummaryMock.mockImplementation(async () => {
			await refresh;
			return { generatedAtMs: Date.now(), items: [] };
		});
		try {
			renderSidebar(
				<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />,
				client
			);
			// Positive timestamps, a real expired TTL, and a still-pending refresh:
			// an immediate empty network response cannot make this assertion pass.
			expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
			expect(
				document.querySelector('[data-conversation-activity="active"]')
			).toBeNull();
			expect(
				client.getQueryData(accountSpaceQueryKeys.activeWakeSummary("human-1"))
			).toMatchObject({ summary: stale });
			await act(async () => {
				finish();
				await refresh;
			});
		} finally {
			clock.mockRestore();
		}
	});

	it("[S29] keeps the orb visible while hover or focus reveals the pin beside it", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 2, spaceId: "space-alpha" }],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", {
			name: ACTIVE_NAME_PATTERN_5,
		});
		const status = within(getConversationRow(link)).getByRole("img", {
			name: "2 Wakes are active",
		});
		const pin = screen.getByRole("button", { name: "Unpin Alpha" });
		expect(status.querySelector("canvas")).toBeTruthy();
		fireEvent.mouseEnter(link);
		expect(status.isConnected).toBe(true);
		fireEvent.focus(pin);
		expect(status.isConnected).toBe(true);
		expect(pin.closest('[data-sidebar="menu-actions"]')).toBeTruthy();
		// Pointer visibility and collision are asserted by the companion browser geometry check.
	});

	it("[S30] waits for initial activity evidence instead of showing a temporary idle ordering", async () => {
		let release: () => void = () => undefined;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		getAccountSpaceActiveWakeSummaryMock.mockImplementation(async () => {
			await pending;
			return { generatedAtMs: Date.now(), items: [] };
		});
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					spaceId: "stable-pin",
					spaceName: "Stable pin",
					pinnedAt: "2026-09-10T00:00:00.000Z",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-loading",
					spaceName: "Waiting for activity",
				}),
			],
		});
		const client = createSidebarQueryClient();
		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />,
			client
		);
		await waitFor(() =>
			expect(getAccountSpaceActiveWakeSummaryMock).toHaveBeenCalled()
		);
		await waitFor(() =>
			expect(
				client.getQueryState(accountSpaceQueryKeys.items("human-1", "account"))
					?.status
			).toBe("success")
		);
		expect(
			screen.queryByRole("link", { name: "Waiting for activity" })
		).toBeNull();
		expect(screen.getByRole("link", { name: "Stable pin" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Conversation view" }));
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "Recent" })
		);
		expect(
			await screen.findByRole("link", { name: "Waiting for activity" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Conversation view" }));
		fireEvent.click(
			await screen.findByRole("menuitemradio", { name: "Grouped" })
		);
		expect(
			screen.queryByRole("link", { name: "Waiting for activity" })
		).toBeNull();
		await act(async () => {
			release();
			await pending;
		});
		expect(
			await screen.findByRole("link", { name: "Waiting for activity" })
		).toBeTruthy();
	});

	it("[S31] keeps active Wake status visible ahead of unread while retaining unread semantics", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-working",
					spaceName: "Working",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-unread",
					spaceName: "Unread",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-idle",
					spaceName: "Idle",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 1, spaceId: "space-working" }],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-working",
					unreadCount: 1,
				},
				{
					latestUnreadOccurredAtMs: 2000,
					spaceId: "space-unread",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const working = await screen.findByRole("link", {
			name: ACTIVE_NAME_PATTERN_6,
		});
		const unread = screen.getByRole("link", {
			name: "Unread, unread messages",
		});
		const idle = screen.getByRole("link", { name: "Idle" });
		expect(
			getConversationRow(working).querySelector("[data-conversation-activity]")
		).toBeTruthy();
		expect(
			getConversationRow(working).querySelector(
				"[data-conversation-unread-indicator]"
			)
		).toBeNull();
		expect(
			getConversationRow(unread).querySelector("[data-conversation-activity]")
		).toBeNull();
		expect(
			getConversationRow(unread).querySelector(
				"[data-conversation-unread-indicator]"
			)
		).toBeTruthy();
		expect(
			getConversationRow(idle).querySelector("[data-conversation-activity]")
		).toBeNull();
		expect(
			getConversationRow(idle).querySelector(
				"[data-conversation-unread-indicator]"
			)
		).toBeNull();
		for (const name of ["Working", "Unread", "Idle"]) {
			expect(
				screen.getByRole("button", { name: `Unpin ${name}` })
			).toBeTruthy();
		}
		fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
		expect(await screen.findByText("2 unread")).toBeTruthy();
	});

	it("[S32] reserves the pinned action gutter only when revealed", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });
		expect(link.style.getPropertyValue("--row-gutter")).toBe("8px");
		expect(
			Number.parseFloat(link.style.getPropertyValue("--row-gutter-hover"))
		).toBeGreaterThan(8);
		expect(screen.getByRole("button", { name: "Unpin Alpha" })).toBeTruthy();
		// S32's hover geometry is verified at real browser widths, not inferred from jsdom.
	});

	it("[S33] shows the full space name quickly on row hover", async () => {
		const longSpaceName = "CLI Dogfood 20260506 000022";
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "OpenMeld Canary Web Codex 20260506 000022",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "OpenMeld Test",
						},
					],
					openProfileId: "human-1",
					openProfileName: "OpenMeld Test",
					spaceId: "space-alpha",
					spaceName: longSpaceName,
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: longSpaceName });
		expect(screen.queryByRole("tooltip", { name: longSpaceName })).toBeNull();
		fireEvent.pointerEnter(link);
		fireEvent.mouseEnter(link);
		await waitFor(
			() =>
				expect(
					Array.from(
						document.querySelectorAll(
							'[data-slot="tooltip-content"][data-open]'
						)
					).some((tooltip) => tooltip.textContent?.includes(longSpaceName))
				).toBe(true),
			{ timeout: 500 }
		);
		expect(screen.queryByText("Joined as OpenMeld Test")).toBeNull();
		expect(screen.queryByText(OTHER_JOINED_PROFILE_TEXT)).toBeNull();
	});

	it("[S34] opens a space with the current Web profile even when the index open profile is an agent", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "Mira",
						},
					],
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });
		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("[S35] opens an agent-only Space with the current Human Web viewer", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
					],
					lastSeenTs: null,
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("[S36] uses the Router link for Space navigation", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("[S37] renders the current space with the fluid sidebar selection surface", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});

		const { container } = renderSidebar(
			<ConversationsSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>
		);

		const activeLink = await screen.findByRole("link", { name: "Alpha" });
		const activeRow = activeLink.closest("[data-fluid-nav-value]");

		expect(activeRow?.getAttribute("data-state")).toBe("active");
		fireEvent.focus(activeLink);
		await waitFor(() => {
			expect(
				container.querySelector('[data-slot="fluid-nav-menu-active-indicator"]')
			).toBeTruthy();
		});
	});

	it("[S38] removes the redundant discovery section outside a conversation", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await screen.findByText("No conversations yet.");
		expect(
			screen.queryByRole("button", { name: BROWSE_SPACES_TEXT })
		).toBeNull();
		expect(screen.queryByText("Explore")).toBeNull();
	});

	it("[S39] offers creation from the Spaces section in a personal organization", async () => {
		appOrganizationMock.currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Mira",
			slug: "mira",
		};
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const createButton = await screen.findByRole("button", {
			name: "Add Space or group",
		});
		fireEvent.click(createButton);
		fireEvent.click(
			await screen.findByText("New Space", { selector: "button" })
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/o/mira/new-space" });
		expect(screen.queryByText("Open your Spaces")).toBeNull();
		expect(screen.queryByText("Find public Spaces")).toBeNull();
	});

	it("[S40] places the create-space action in the Spaces section after pinned spaces", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		const { container } = renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Pinned Alpha" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Add Space or group" })
		).toBeTruthy();
		expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull();
		expect(
			getSidebarGroupLabel("Pinned").compareDocumentPosition(
				getSidebarGroupLabel("Spaces")
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("[S41] optimistically moves a space into the pinned section", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		setAccountSpaceItemPinnedMock.mockReturnValue(
			new Promise(() => {
				// Keep the mutation pending so the optimistic cache state is visible.
			})
		);

		renderSidebar(
			<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		fireEvent.click(await screen.findByLabelText("Pin Alpha"));

		await waitFor(() => {
			expect(getSidebarGroupLabel("Pinned")).toBeTruthy();
		});
		expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();
		expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
			pinnedAt: expect.any(String),
			profileIds: ["human-1"],
			spaceId: "space-alpha",
		});
	});

	it("[S42] keeps the optimistic pinned state while the Space Index overlay is pending", async () => {
		focusManager.setFocused(false);
		const overlayStartedAtMs = Date.now();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(overlayStartedAtMs);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
			// Expected for a pending projection in this regression test.
		});
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		setAccountSpaceItemPinnedMock.mockResolvedValue([
			upsertProfileSpaceHistoryResponseSchema.parse({
				item: {
					profileId: "human-1",
					gatewayHost: "gateway.openmeld.invalid",
					spaceId: "space-alpha",
					spaceName: "Alpha",
					creatorProfileId: null,
					creatorKind: null,
					spaceCreatedAt: null,
					spaceUpdatedAt: null,
					lastJoinedAt: "2026-09-10T00:00:00.000Z",
					lastSeenTs: null,
					pinnedAt: "2026-09-10T00:00:00.000Z",
					status: "active",
					createdAt: "2026-09-10T00:00:00.000Z",
					updatedAt: "2026-09-10T00:00:00.000Z",
				},
				spaceIndexOverlay: {
					repairAttempted: true,
					status: "pending",
					updated: false,
				},
			}),
		]);

		try {
			renderSidebar(
				<ConversationsSidebar currentProfileId="human-1" currentSpaceId="" />
			);

			fireEvent.click(await screen.findByLabelText("Pin Alpha"));

			await waitFor(() => {
				expect(getSidebarGroupLabel("Pinned")).toBeTruthy();
			});
			expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();
			await waitFor(() => {
				expect(warnSpy).toHaveBeenCalledWith(
					"Pinned space update is waiting for Space Index.",
					{
						spaceId: "space-alpha",
						statuses: ["pending"],
					}
				);
			});

			act(() => focusManager.setFocused(true));
			await waitFor(() => {
				expect(listAccountSpaceItemsMock).toHaveBeenCalledTimes(2);
			});
			expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();

			nowSpy.mockReturnValue(overlayStartedAtMs + 60_001);
			act(() => focusManager.setFocused(false));
			act(() => focusManager.setFocused(true));
			await waitFor(() => {
				expect(listAccountSpaceItemsMock).toHaveBeenCalledTimes(3);
			});
			expect(screen.getByLabelText("Pin Alpha")).toBeTruthy();
		} finally {
			nowSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});

function hoverActivity(status: HTMLElement) {
	const trigger = status.closest("a");
	if (!trigger) {
		throw new Error("Activity must link to its canonical conversation");
	}
	fireEvent.pointerEnter(trigger);
	fireEvent.mouseEnter(trigger);
}

function getConversationRow(link: HTMLElement): HTMLElement {
	const row = link.closest("li");
	if (!row) {
		throw new Error("Conversation link must belong to a sidebar row");
	}
	return row;
}

function createSidebarQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function seedCurrentSpaceWakeRace(queryClient: QueryClient): void {
	const accountSpaces = {
		pinnedItems: [
			createAccountSpaceItem({
				pinnedAt: "2026-04-29T01:00:00.000Z",
				spaceId: "space-alpha",
				spaceName: "Alpha",
			}),
			createAccountSpaceItem({
				pinnedAt: "2026-04-29T02:00:00.000Z",
				spaceId: "space-beta",
				spaceName: "Beta",
			}),
		],
		spaceItems: [],
	};
	const accountWakeSummary = {
		generatedAtMs: Date.now(),
		items: [
			{ activeWakeCount: 1, spaceId: "space-alpha" },
			{ activeWakeCount: 1, spaceId: "space-beta" },
		],
	};
	listAccountSpaceItemsMock.mockResolvedValue(accountSpaces);
	getAccountSpaceActiveWakeSummaryMock.mockResolvedValue(accountWakeSummary);
	queryClient.setQueryData(
		accountSpaceQueryKeys.items("human-1", "account"),
		accountSpaces
	);
	queryClient.setQueryData(accountSpaceQueryKeys.activeWakeSummary("human-1"), {
		browserRequestStartedAtMonotonicMs: performance.now(),
		summary: accountWakeSummary,
	});
	const currentSpaceSummaryOptions = spaceActiveWakeProgressSummaryQueryOptions(
		{
			enabled: false,
			openMeldProfileId: "human-1",
			spaceId: "space-alpha",
		}
	);
	queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
		items: [
			createWakeProgressItem({
				clientMessageId: "client-message-alpha",
				dispatchId: "dispatch-alpha",
				phase: "running",
				sourceSignalId: "signal-alpha",
				targetLabel: "Runner",
				targetProfileId: "agent-alpha",
				updatedAtMs: Date.now(),
			}),
		],
		query: {
			spaceId: "space-alpha",
			targetProfileId: null,
		},
	});
}

function renderSidebar(
	element: ReactElement,
	queryClient = createSidebarQueryClient()
) {
	const wrap = (ui: ReactElement) => (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>
	);
	const view = render(wrap(element));
	return {
		...view,
		rerender: (ui: ReactElement) => view.rerender(wrap(ui)),
	};
}

function createAccountSpaceItem(input: {
	joinedProfiles?: Array<{
		lastJoinedAt: string;
		pinnedAt: string | null;
		profileId: string;
		profileName: string;
	}>;
	lastJoinedAt?: string;
	lastSeenTs?: number | null;
	messageTimestamp?: number;
	openProfileId?: string;
	openProfileName?: string;
	organizationId?: string;
	pinnedAt?: string | null;
	spaceId: string;
	spaceName: string;
	spacePurpose?: string | null;
	activeMemberCount?: number | null;
}): AccountSpaceItem {
	const pinnedAt = input.pinnedAt ?? null;
	const openProfileId = input.openProfileId ?? "human-1";
	const openProfileName = input.openProfileName ?? "Mira";
	const lastJoinedAt = input.lastJoinedAt ?? "2026-04-29T00:00:00.000Z";
	return {
		messagePreview:
			input.messageTimestamp === undefined
				? undefined
				: {
						signalId: `message-${input.spaceId}`,
						profileId: openProfileId,
						timestamp: input.messageTimestamp,
						text: "Unread message",
					},
		joinedProfiles: input.joinedProfiles ?? [
			{
				lastJoinedAt,
				pinnedAt,
				profileId: openProfileId,
				profileName: openProfileName,
			},
		],
		lastJoinedAt,
		lastSeenTs:
			input.lastSeenTs === undefined
				? Date.parse("2026-04-30T00:00:00.000Z")
				: input.lastSeenTs,
		openProfileId,
		openProfileName,
		organizationId: input.organizationId ?? "org-acme",
		pinnedAt,
		pinnedProfileIds: pinnedAt ? [openProfileId] : [],
		spaceId: input.spaceId,
		spaceName: input.spaceName,
		spacePurpose: input.spacePurpose ?? null,
		activeAgentCount: null,
		activeHumanCount: null,
		activeMemberCount: input.activeMemberCount ?? null,
		visibility: "private",
	};
}
